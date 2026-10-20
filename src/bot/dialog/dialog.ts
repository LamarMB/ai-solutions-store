import { createHash } from "node:crypto";
import {
  addressText,
  doctorsText,
  rubles,
  prepText,
  pricesText,
  routeText,
} from "@/bot/clinic/knowledge";
import type { Clinic } from "@/bot/clinic/types";
import {
  MEDICAL_AREA_TITLES,
  RED_FLAG_TITLES,
} from "@/bot/conversation/medical-labels";
import { normalizeText } from "@/bot/dialog/rule-interpreter";
import { redactContacts } from "@/consultant/privacy";
import {
  ActionSchema,
  INITIAL_STATE,
  type Action,
  type BotEvent,
  type Button,
  type ConsentPort,
  type RequestPort,
  type DialogState,
  type Effect,
  type InfoTopic,
  type Interpretation,
  type Reply,
  REQUEST_TEXT_MAX,
  type ShareSummary,
  type TextInterpreter,
} from "@/bot/dialog/types";
import type { ScheduleProvider } from "@/bot/schedule/schedule";
import { formatDayShort, isDate, isTime } from "@/bot/schedule/time";
import type { Booking } from "@/bot/storage/types";

export type DialogContext = {
  peerId: number;
  clinic: Clinic;
  schedule: ScheduleProvider;
  interpreter: TextInterpreter;
  /** Сегодняшняя дата клиники «ГГГГ-ММ-ДД» — для «сегодня/завтра». */
  today: string;
  /** Согласия на передачу сведений врачу; нет — передача не предлагается. */
  consents?: ConsentPort;
  /** Обращения к администратору с согласием; нет — зовём без передачи текста. */
  requests?: RequestPort;
  /** Настроен VK Mini App клиники: в меню — «Открыть приложение». */
  appAvailable?: boolean;
};

export type DialogResult = {
  state: DialogState;
  replies: Reply[];
  effects?: Effect[];
};

/** Время на одной странице выбора: вместе с навигацией — не больше 10 кнопок. */
export const TIMES_PER_PAGE = 6;
/** Ответ модели длиннее — обрезается: короткие ответы удобнее в мессенджере. */
export const ANSWER_MAX = 700;

const MENU: Button = { label: "В меню", action: { a: "menu" } };

/** Главная кнопка: VK Mini App (open_app) или запись через бота, если приложения нет. */
const APP_BUTTON: Button = {
  label: "Открыть приложение",
  action: { a: "app" },
  color: "primary",
};
const BOOK_BUTTON: Button = {
  label: "Записаться на приём",
  action: { a: "book" },
  color: "primary",
};
const mainButton = (ctx: DialogContext) =>
  ctx.appAvailable ? APP_BUTTON : BOOK_BUTTON;
const ADMIN_MENU_BUTTON: Button = {
  label: "Администратор",
  action: { a: "admin" },
};
const CALL_PLAIN: Button = {
  label: "Позвать без описания",
  action: { a: "hoff" },
};
const BACK: Button = { label: "Назад", action: { a: "back" } };

export const MEDICAL_REFUSAL =
  "Я не ставлю диагнозы, не толкую анализы и не назначаю лечение — это может сделать только врач на приёме. " +
  "Могу помочь подобрать специалиста и записаться. При угрозе жизни звоните 103 или 112.\n" +
  "Пожалуйста, не присылайте медицинские документы, анализы и фото: бот их не принимает.";

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    rows.push(items.slice(i, i + size));
  return rows;
};

/**
 * Один шаг диалога: состояние + событие → новое состояние, ответы и эффекты.
 * Не знает о ВКонтакте и OpenAI: канал передаёт события и показывает ответы,
 * интерпретатор разбирает текст. Запись создаётся только кнопкой «Подтвердить».
 */
export async function handleEvent(
  state: DialogState,
  event: BotEvent,
  ctx: DialogContext,
): Promise<DialogResult> {
  if (event.type === "start") return greet(ctx);
  if (event.type === "resume") {
    return state.step === "menu"
      ? greet(ctx)
      : show(state, ctx, ["Продолжим с того же места."]);
  }

  if (event.type === "action") {
    const parsed = ActionSchema.safeParse(event.payload);
    if (!parsed.success) return stale(state, ctx);
    return handleAction(state, parsed.data, ctx);
  }

  const text = normalizeText(event.text);
  if (!text) return show(state, ctx);
  if (text === "назад") return handleAction(state, { a: "back" }, ctx);

  // Текст, совпадающий с кнопкой текущего шага, работает как нажатие — без модели.
  const option = matchOption(state, text, ctx);
  if (option) return handleAction(state, option, ctx);

  const meaning = await ctx.interpreter.interpret(event.text, {
    peerId: ctx.peerId,
    today: ctx.today,
    step: state.step,
  });
  return handleMeaning(state, meaning, ctx);
}

export function handleMeaning(
  state: DialogState,
  meaning: Interpretation,
  ctx: DialogContext,
): DialogResult {
  switch (meaning.intent) {
    case "medical":
      return show(state, ctx, [MEDICAL_REFUSAL]);
    case "greeting":
      return greet(ctx);
    case "menu":
      return show({ step: "menu" }, ctx);
    case "book":
      return startBooking(meaning, ctx);
    case "my_bookings":
      return show({ step: "bookings" }, ctx);
    case "admin":
      return startHandoff(ctx);
    case "question": {
      const answer = meaning.topic
        ? infoText(meaning.topic, ctx.clinic)
        : meaning.answer?.trim().slice(0, ANSWER_MAX);
      if (answer) return show(state, ctx, [answer]);
      break;
    }
    case "yes":
      if (state.step === "confirm")
        return handleAction(state, { a: "ok" }, ctx);
      if (state.step === "cancel")
        return handleAction(state, { a: "cxok" }, ctx);
      if (state.step === "handoff")
        return handleAction(state, { a: "hoff" }, ctx);
      // «Да» не считается согласием на передачу текста: только кнопка или её подпись.
      break;
    case "no":
      if (["confirm", "cancel", "handoff"].includes(state.step))
        return handleAction(state, { a: "back" }, ctx);
      break;
  }
  return show(state, ctx, [
    "Не совсем понял. Могу подобрать специалиста, записать на приём, рассказать о ценах, врачах и адресе или позвать администратора. Напишите, что нужно, или выберите кнопку.",
  ]);
}

/**
 * Переход к записи по подсказкам из текста. Каждая подсказка проверяется по
 * расписанию; неподходящие отбрасываются. До записи — всегда шаг подтверждения.
 */
export function startBooking(
  meaning: Interpretation,
  ctx: DialogContext,
  notes: string[] = [],
): DialogResult {
  const { schedule } = ctx;
  const specialtyId =
    (meaning.doctorId && schedule.getDoctor(meaning.doctorId)?.specialtyId) ||
    meaning.specialtyId;
  const specialty = schedule
    .listSpecialties()
    .find((s) => s.id === specialtyId);
  if (!specialty) return show({ step: "specialty" }, ctx, notes);
  // Единственный врач направления выбирается сразу.
  const doctors = schedule.listDoctors(specialty.id);
  const doctor = meaning.doctorId
    ? schedule.getDoctor(meaning.doctorId)
    : doctors.length === 1
      ? doctors[0]
      : undefined;
  if (!doctor)
    return show({ step: "doctor", specialtyId: specialty.id }, ctx, notes);

  const base = { specialtyId: specialty.id, doctorId: doctor.id };
  const date = meaning.date && isDate(meaning.date) ? meaning.date : undefined;
  if (!date || !schedule.listAvailableDays(doctor.id).includes(date)) {
    return show({ step: "day", ...base }, ctx, [
      ...notes,
      ...(date
        ? [`${doctor.name}: на ${formatDayShort(date)} свободного времени нет.`]
        : []),
    ]);
  }
  const time = meaning.time && isTime(meaning.time) ? meaning.time : undefined;
  if (time && schedule.listFreeSlots(doctor.id, date).includes(time)) {
    return show({ step: "confirm", ...base, date, time }, ctx, notes);
  }
  return show({ step: "time", ...base, date, page: 0 }, ctx, [
    ...notes,
    ...(time ? [`Время ${time} недоступно. Выберите другое.`] : []),
  ]);
}

function handleAction(
  state: DialogState,
  action: Action,
  ctx: DialogContext,
): DialogResult {
  const { schedule } = ctx;
  switch (action.a) {
    case "menu":
      return show({ step: "menu" }, ctx);
    case "book":
      return show({ step: "specialty" }, ctx);
    case "my":
      return show({ step: "bookings" }, ctx);
    case "back":
      return show(previous(state), ctx);
    case "info":
      return show(state.step === "handoff" ? { step: "menu" } : state, ctx, [
        infoText(action.k, ctx.clinic),
      ]);
    case "admin":
      return startHandoff(ctx);
    case "app":
      // Кнопка приложения пришла как обычная (клиент без open_app или симулятор).
      return show({ step: "specialty" }, ctx, [
        "Приложение клиники открывается кнопкой во ВКонтакте. Здесь можно записаться через бота:",
      ]);
    case "hoff":
      if (!["handoff", "handoff_compose"].includes(state.step))
        return stale(state, ctx);
      return {
        state: { step: "menu" },
        effects: [{ type: "handoff" }],
        replies: [
          {
            text:
              "Позвал администратора клиники — он ответит в этом диалоге. " +
              "Через нашу систему никакой текст не передавался: напишите ему здесь, что нужно. " +
              "Пока администратор отвечает, бот не вмешивается.",
            buttons: [[{ label: "Вернуться к боту", action: { a: "bot" } }]],
          },
        ],
      };
    case "hedit":
      if (state.step !== "handoff_consent") return stale(state, ctx);
      return show({ step: "handoff_compose" }, ctx);
    case "hno":
      if (state.step !== "handoff_consent") return stale(state, ctx);
      return show({ step: "handoff" }, ctx, [
        "Хорошо, через нашу систему этот текст не передаём. " +
          "Администратора можно позвать и без описания — тогда напишите ему в этом диалоге сами, что нужно.",
      ]);
    case "hok": {
      // Согласие — только на показанный текст из сохранённого шага.
      if (
        state.step !== "handoff_consent" ||
        !ctx.requests ||
        action.h !== draftTag(state.draft)
      )
        return stale(state, ctx);
      const { id } = ctx.requests.create(ctx.peerId, state.draft);
      return {
        state: { step: "menu" },
        effects: [{ type: "handoff", requestId: id }],
        replies: [
          {
            text:
              `Передал администратору клиники обращение №${id} — только показанный текст. ` +
              "Он ответит в этом диалоге; пока он отвечает, бот не вмешивается.\n" +
              "Передумали — нажмите «Отозвать передачу» или напишите «отозвать передачу»: " +
              "текст станет недоступен в панели клиники. Если сотрудник уже прочитал его, это не отменить.",
            buttons: [
              [
                {
                  label: `Отозвать передачу №${id}`,
                  action: { a: "hrv", r: id },
                },
              ],
              [{ label: "Вернуться к боту", action: { a: "bot" } }],
            ],
          },
        ],
      };
    }
    case "hrv": {
      const revoked = ctx.requests?.revoke(ctx.peerId, action.r) ?? [];
      return show(state.step === "menu" ? state : { step: "menu" }, ctx, [
        revoked.length > 0
          ? `Передача обращения №${action.r} отозвана: текст удалён из панели клиники. ` +
            "Если сотрудник уже прочитал его, это не отменить. Переписку в сообщениях сообщества это не затрагивает."
          : "Действующей передачи по этому обращению нет.",
      ]);
    }
    case "bot":
      return show({ step: "menu" }, ctx, ["Снова на связи бот."]);

    // Ответы на вопросы о жалобе, ближайшее время и сброс обрабатывает
    // разговорный слой (conversation/orchestrator); здесь они устарели.
    case "ans":
    case "near":
    case "reset":
      return stale(state, ctx);

    case "spec":
      if (
        state.step !== "specialty" ||
        !schedule.listSpecialties().some((s) => s.id === action.s)
      )
        return stale(state, ctx);
      return show({ step: "doctor", specialtyId: action.s }, ctx);

    case "doc":
      if (
        state.step !== "doctor" ||
        !schedule.listDoctors(state.specialtyId).some((d) => d.id === action.d)
      )
        return stale(state, ctx);
      return show(
        { step: "day", specialtyId: state.specialtyId, doctorId: action.d },
        ctx,
      );

    case "day":
      if (
        state.step !== "day" ||
        !schedule.listAvailableDays(state.doctorId).includes(action.dt)
      )
        return stale(state, ctx);
      return show({ ...state, step: "time", date: action.dt, page: 0 }, ctx);

    case "more": {
      if (state.step !== "time") return stale(state, ctx);
      const pages = Math.ceil(
        schedule.listFreeSlots(state.doctorId, state.date).length /
          TIMES_PER_PAGE,
      );
      return show(
        { ...state, page: pages > 0 ? (state.page + 1) % pages : 0 },
        ctx,
      );
    }

    case "time":
      if (
        state.step !== "time" ||
        !schedule.listFreeSlots(state.doctorId, state.date).includes(action.t)
      )
        return stale(state, ctx);
      return show(
        {
          step: "confirm",
          specialtyId: state.specialtyId,
          doctorId: state.doctorId,
          date: state.date,
          time: action.t,
        },
        ctx,
      );

    case "ok":
      if (state.step !== "confirm") return stale(state, ctx);
      return confirm(state, ctx);

    case "cx": {
      if (state.step !== "bookings") return stale(state, ctx);
      const booking = schedule
        .listBookings(ctx.peerId)
        .find((b) => b.id === action.b);
      if (!booking) return stale({ step: "bookings" }, ctx);
      return show({ step: "cancel", bookingId: booking.id }, ctx);
    }

    // Предложение передачи открывает разговорный слой (из памяти разговора).
    case "shr":
      return stale(state, ctx);

    case "shrok": {
      if (state.step !== "share" || !ctx.consents) return stale(state, ctx);
      const shared = ctx.consents.share(
        ctx.peerId,
        state.bookingId,
        state.summary,
      );
      return show({ step: "menu" }, ctx, [
        shared
          ? `Описание жалобы передано врачу записи №${state.bookingId}. ` +
            "Отозвать согласие можно в «Мои записи» — сведения сразу удалятся."
          : "Запись не найдена или уже отменена — ничего не передано.",
      ]);
    }

    case "shrno":
      return show({ step: "menu" }, ctx, [
        "Хорошо, врачу ничего не передаём. Описание жалобы удалено из памяти бота.",
      ]);

    case "rv": {
      const revoked = ctx.consents?.revoke(ctx.peerId, action.b) ?? false;
      return show({ step: "bookings" }, ctx, [
        revoked
          ? `Согласие по записи №${action.b} отозвано, переданные врачу сведения удалены.`
          : "Действующего согласия по этой записи нет.",
      ]);
    }

    case "cxok": {
      if (state.step !== "cancel") return stale(state, ctx);
      const cancelled = schedule.cancel(ctx.peerId, state.bookingId);
      // Отменённая запись — согласие на передачу сведений врачу прекращается.
      if (cancelled) ctx.consents?.revoke(ctx.peerId, state.bookingId);
      return show({ step: "bookings" }, ctx, [
        cancelled
          ? `Запись №${state.bookingId} отменена.`
          : "Эта запись уже отменена или не найдена.",
      ]);
    }
  }
}

function confirm(
  state: Extract<DialogState, { step: "confirm" }>,
  ctx: DialogContext,
): DialogResult {
  const result = ctx.schedule.book(
    ctx.peerId,
    state.doctorId,
    state.date,
    state.time,
  );
  const back = {
    step: "time",
    specialtyId: state.specialtyId,
    doctorId: state.doctorId,
    date: state.date,
    page: 0,
  } as const;
  switch (result.status) {
    case "ok":
      // Запись уже сохранена; всё, что ниже, — необязательно.
      return {
        state: { step: "menu" },
        effects: [{ type: "booked", bookingId: result.booking.id }],
        replies: [
          {
            text:
              `Запись №${result.booking.id} подтверждена (тестовое расписание).\n` +
              describeBooking(result.booking, ctx) +
              "\n\nБольше ничего делать не нужно — диалог можно закрыть.\n" +
              "Если хотите (необязательно): памятка к визиту, как добраться, ваши записи.",
            buttons: [
              [
                { label: "Памятка к визиту", action: { a: "info", k: "prep" } },
                { label: "Как добраться", action: { a: "info", k: "route" } },
              ],
              [{ label: "Мои записи", action: { a: "my" } }, MENU],
            ],
          },
        ],
      };
    case "taken":
      return show(back, ctx, [
        "Это время только что заняли. Выберите, пожалуйста, другое.",
      ]);
    case "unavailable":
      return show(
        {
          step: "day",
          specialtyId: state.specialtyId,
          doctorId: state.doctorId,
        },
        ctx,
        ["Это время больше недоступно. Выберите другой день или время."],
      );
    case "limit":
      return show({ step: "bookings" }, ctx, [
        "У вас уже максимальное число активных записей. Отмените одну из них, чтобы записаться снова.",
      ]);
  }
}

/**
 * Честное предупреждение: сообщения сообществу ВКонтакте видят руководители
 * сообщества в интерфейсе ВКонтакте — панель клиники это не ограничивает.
 */
export const PRIVACY_NOTICE =
  "Важно: переписку в сообщениях сообщества могут читать администраторы сообщества ВКонтакте. " +
  "Не пишите подробностей о здоровье, которые не готовы им показать, — для записи достаточно пары слов.";

export function greet(ctx: DialogContext): DialogResult {
  return show({ step: "menu" }, ctx, [
    `Здравствуйте! Я помощник клиники: ${ctx.clinic.name} (демо, данные вымышленные).\n` +
      "Напишите, что нужно, — подберу врача, запишу, отвечу на вопросы. Диагнозы не ставлю и лечение не назначаю.\n" +
      PRIVACY_NOTICE,
  ]);
}

function stale(state: DialogState, ctx: DialogContext): DialogResult {
  return show(state, ctx, ["Эта кнопка устарела. Вот актуальные варианты."]);
}

export function infoText(topic: InfoTopic, clinic: Clinic): string {
  switch (topic) {
    case "prices":
      return pricesText(clinic);
    case "doctors":
      return doctorsText(clinic);
    case "address":
      return addressText(clinic);
    case "prep":
      return prepText(clinic);
    case "route":
      return routeText(clinic);
  }
}

/** Шаг назад по сценарию. */
function previous(state: DialogState): DialogState {
  switch (state.step) {
    case "specialty":
    case "bookings":
    case "menu":
    case "handoff":
    case "handoff_compose":
    case "handoff_consent":
    case "share":
      return { step: "menu" };
    case "doctor":
      return { step: "specialty" };
    case "day":
      return { step: "doctor", specialtyId: state.specialtyId };
    case "time":
      return {
        step: "day",
        specialtyId: state.specialtyId,
        doctorId: state.doctorId,
      };
    case "confirm":
      return {
        step: "time",
        specialtyId: state.specialtyId,
        doctorId: state.doctorId,
        date: state.date,
        page: 0,
      };
    case "cancel":
      return { step: "bookings" };
  }
}

/** Ближайший свободный слот врача (или любого врача направления). */
export function nearestSlot(
  schedule: ScheduleProvider,
  specialtyId: string,
  doctorId?: string,
): { doctorId: string; date: string; time: string } | undefined {
  const doctors = doctorId
    ? schedule.listDoctors(specialtyId).filter((d) => d.id === doctorId)
    : schedule.listDoctors(specialtyId);
  let best: { doctorId: string; date: string; time: string } | undefined;
  for (const doctor of doctors) {
    const date = schedule.listAvailableDays(doctor.id)[0];
    const time = date && schedule.listFreeSlots(doctor.id, date)[0];
    if (!date || !time) continue;
    if (!best || `${date} ${time}` < `${best.date} ${best.time}`)
      best = { doctorId: doctor.id, date, time };
  }
  return best;
}

/** Показывает шаг; если данных для него больше нет — ближайший осмысленный шаг. */
export function show(
  state: DialogState,
  ctx: DialogContext,
  notes: string[] = [],
): DialogResult {
  const { schedule } = ctx;
  const prefix = notes.length > 0 ? `${notes.join("\n")}\n\n` : "";
  const reply = (text: string, buttons: Button[][]): DialogResult => ({
    state,
    replies: [{ text: prefix + text, buttons }],
  });

  switch (state.step) {
    case "menu":
      // Три действия: приложение (главное), записи, администратор. Остальное —
      // текстом: «какие врачи есть?», «сколько стоит?», «где клиника?».
      return reply(
        ctx.appAvailable
          ? "«Открыть приложение» — врачи, цены и запись на приём. Или напишите, что нужно."
          : "Чем могу помочь? Напишите, что нужно, или выберите действие.",
        [
          [mainButton(ctx)],
          [{ label: "Мои записи", action: { a: "my" } }, ADMIN_MENU_BUTTON],
        ],
      );

    case "specialty":
      return reply("Выберите направление:", [
        ...chunk(
          schedule.listSpecialties().map((s) => ({
            label: s.title,
            action: { a: "spec", s: s.id } as Action,
          })),
          2,
        ),
        [MENU],
      ]);

    case "doctor": {
      const specialty = schedule
        .listSpecialties()
        .find((s) => s.id === state.specialtyId);
      if (!specialty) return show({ step: "specialty" }, ctx, notes);
      const doctors = schedule.listDoctors(specialty.id);
      const lines = doctors.map((d) => {
        const slot = nearestSlot(schedule, specialty.id, d.id);
        return `• ${d.name} — ${slot ? `ближайшее время: ${formatDayShort(slot.date)}, ${slot.time}` : "в ближайшие две недели мест нет"}`;
      });
      return reply(
        `${specialty.title}:\n${lines.join("\n")}\n\nВыберите врача или ближайшее время:`,
        [
          ...doctors.map((d) => [
            { label: d.name, action: { a: "doc", d: d.id } as Action },
          ]),
          [
            {
              label: "Ближайшее время",
              action: { a: "near", s: specialty.id },
              color: "primary",
            },
          ],
          [BACK, MENU],
        ],
      );
    }

    case "day": {
      const doctor = schedule.getDoctor(state.doctorId);
      if (!doctor)
        return show(
          { step: "doctor", specialtyId: state.specialtyId },
          ctx,
          notes,
        );
      const days = schedule.listAvailableDays(doctor.id);
      if (days.length === 0) {
        return reply(
          `${doctor.name}: в ближайшие две недели свободного времени нет. Выберите другого врача.`,
          [[BACK, MENU]],
        );
      }
      return reply(`${doctor.name}. Выберите день:`, [
        ...chunk(
          days.map((dt) => ({
            label: formatDayShort(dt),
            action: { a: "day", dt } as Action,
          })),
          2,
        ),
        [BACK, MENU],
      ]);
    }

    case "time": {
      const doctor = schedule.getDoctor(state.doctorId);
      const slots = doctor ? schedule.listFreeSlots(doctor.id, state.date) : [];
      if (!doctor || slots.length === 0) {
        return show(
          {
            step: "day",
            specialtyId: state.specialtyId,
            doctorId: state.doctorId,
          },
          ctx,
          [...notes, "На этот день свободного времени больше нет."],
        );
      }
      const pages = Math.ceil(slots.length / TIMES_PER_PAGE);
      const page = Math.min(state.page, pages - 1);
      const visible = slots.slice(
        page * TIMES_PER_PAGE,
        (page + 1) * TIMES_PER_PAGE,
      );
      return {
        state: { ...state, page },
        replies: [
          {
            text:
              prefix +
              `${doctor.name}, ${formatDayShort(state.date)}. Выберите время:`,
            buttons: [
              ...chunk(
                visible.map((t) => ({
                  label: t,
                  action: { a: "time", t } as Action,
                })),
                3,
              ),
              ...(pages > 1
                ? [
                    [
                      {
                        label: page + 1 < pages ? "Ещё время" : "К началу дня",
                        action: { a: "more" } as Action,
                      },
                    ],
                  ]
                : []),
              [BACK, MENU],
            ],
          },
        ],
      };
    }

    case "confirm": {
      const doctor = schedule.getDoctor(state.doctorId);
      if (!doctor) return show({ step: "specialty" }, ctx, notes);
      return reply(
        "Проверьте запись:\n" +
          describeBooking(
            { doctorId: doctor.id, date: state.date, time: state.time },
            ctx,
          ) +
          "\n\nПодтвердить?",
        [
          [{ label: "Подтвердить", action: { a: "ok" }, color: "positive" }],
          [
            { label: "Другое время", action: { a: "back" } },
            { label: "Отмена", action: { a: "menu" }, color: "negative" },
          ],
        ],
      );
    }

    case "bookings": {
      const bookings = schedule.listBookings(ctx.peerId);
      if (bookings.length === 0) {
        return reply("Активных записей нет.", [[mainButton(ctx), MENU]]);
      }
      const shared = ctx.consents?.sharedBookingIds(ctx.peerId) ?? new Set();
      return reply(
        (ctx.appAvailable
          ? "Перенести время можно в приложении: «Открыть приложение» → «Записи» → «Перенести».\n\n"
          : "") +
          "Ваши записи:\n" +
          bookings
            .map(
              (b) =>
                `№${b.id}: ${formatDayShort(b.date)}, ${b.time} — ${doctorLabel(b.doctorId, ctx)}` +
                (shared.has(b.id)
                  ? "\n   врачу передано описание жалобы (можно отозвать)"
                  : ""),
            )
            .join("\n"),
        [
          // Отзыв согласия — в одном ряду с отменой: лимит рядов ВКонтакте.
          ...bookings.map((b): Button[] => [
            {
              label: `Отменить №${b.id}`,
              action: { a: "cx", b: b.id },
              color: "negative",
            },
            ...(shared.has(b.id)
              ? [
                  {
                    label: `Отозвать сведения №${b.id}`,
                    action: { a: "rv", b: b.id } as Action,
                  },
                ]
              : []),
          ]),
          [
            ctx.appAvailable
              ? { ...APP_BUTTON, color: undefined }
              : { label: "Записаться ещё", action: { a: "book" } },
            MENU,
          ],
        ],
      );
    }

    case "cancel": {
      const booking = schedule
        .listBookings(ctx.peerId)
        .find((b) => b.id === state.bookingId);
      if (!booking) return show({ step: "bookings" }, ctx, notes);
      return reply(
        `Отменить запись №${booking.id}?\n` + describeBooking(booking, ctx),
        [
          [
            {
              label: "Да, отменить",
              action: { a: "cxok" },
              color: "negative",
            },
            { label: "Нет", action: { a: "back" } },
          ],
        ],
      );
    }

    case "share":
      return reply(sharePreview(state.bookingId, state.summary), [
        [
          { label: "Передать врачу", action: { a: "shrok" }, color: "primary" },
          { label: "Не передавать", action: { a: "shrno" } },
        ],
      ]);

    case "handoff_compose":
      return reply(HANDOFF_COMPOSE_TEXT, [[CALL_PLAIN], [MENU]]);

    case "handoff_consent":
      return reply(requestPreview(state.draft, state.redacted), [
        [
          {
            label: "Разрешаю передачу",
            action: { a: "hok", h: draftTag(state.draft) },
            color: "positive",
          },
        ],
        [
          { label: "Не разрешаю", action: { a: "hno" } },
          { label: "Изменить текст", action: { a: "hedit" } },
        ],
      ]);

    case "handoff":
      return reply(HANDOFF_QUESTION, [
        [
          {
            label: "Да, позвать",
            action: { a: "hoff" },
            color: "primary",
          },
          { label: "Нет", action: { a: "back" } },
        ],
      ]);
  }
}

/**
 * Предупреждение перед передачей администратору. Честно: администратор
 * отвечает в сообщениях сообщества ВКонтакте и видит там всю переписку
 * диалога, включая сообщения боту, — наша панель этого не ограничивает.
 */
export const HANDOFF_QUESTION =
  "Позвать администратора клиники? Он ответит в этом диалоге, бот на это время замолчит.\n" +
  "Важно: администратор увидит всю переписку этого диалога ВКонтакте, включая то, что вы писали боту о самочувствии.";

/**
 * Начало обращения к администратору. С передачей текста через нашу систему
 * (есть ключ шифрования) — просим написать, что передать, или сразу показываем
 * предпросмотр, если пациент уже написал суть; без — прежний вопрос.
 */
export function startHandoff(ctx: DialogContext, raw?: string): DialogResult {
  if (!ctx.requests) return show({ step: "handoff" }, ctx);
  const draft = raw ? requestDraft(raw) : undefined;
  return draft
    ? show({ step: "handoff_consent", ...draft }, ctx)
    : show({ step: "handoff_compose" }, ctx);
}

/** Слова просьбы позвать человека — без них остаётся суть обращения. */
const CALL_WORDS =
  /^(позов\S*|позвать|позвоните|пригласи\S*|соедини\S*|переключи\S*|нужен|нужна|нужно|хочу|хотел\S*|можно|мне|с|со|к|поговорить|связаться|свяжите|администратор\S*|админ\S*|оператор\S*|человек\S*|сотрудник\S*|живой|живым|менеджер\S*|пожалуйста|здравствуйте|добрый|день|вечер|утро|привет|а|и)$/;

/**
 * Текст обращения: сообщение пациента дословно (телефоны и почта убираются),
 * если в нём есть что-то кроме просьбы позвать администратора. Резюме не
 * составляется: так в тексте нет ничего, чего пациент не писал.
 */
export function requestDraft(
  raw: string,
): { draft: string; redacted: boolean } | undefined {
  const words = normalizeText(raw)
    .split(/[^a-zа-я0-9:.-]+/)
    .filter(Boolean);
  if (words.filter((w) => !CALL_WORDS.test(w)).length < 2) return undefined;
  const { text, redacted } = redactContacts(raw.replace(/\s+/g, " ").trim());
  if (text.length === 0 || text.length > REQUEST_TEXT_MAX) return undefined;
  return { draft: text, redacted };
}

/** Метка показанного текста в кнопке согласия (не секрет, только привязка). */
export const draftTag = (draft: string) =>
  createHash("sha256").update(draft, "utf8").digest("hex").slice(0, 12);

/** Текст, который пациент написал на шаге «что передать»: дословно, без контактов. */
export function composedRequest(
  raw: string,
): { draft: string; redacted: boolean } | "too_long" | undefined {
  const { text, redacted } = redactContacts(raw.replace(/\s+/g, " ").trim());
  if (!text) return undefined;
  if (text.length > REQUEST_TEXT_MAX) return "too_long";
  return { draft: text, redacted };
}

export const HANDOFF_COMPOSE_TEXT =
  "Администратор клиники ответит в этом диалоге.\n" +
  "Напишите одним сообщением, что нужно решить, — например: «Хочу перенести запись на пятницу после 16:00». " +
  "Перед отправкой покажу текст и спрошу разрешения: без него через нашу систему ничего не передаётся. " +
  "Подробности о здоровье для этого не нужны.\n" +
  "Важно: администраторы сообщества ВКонтакте могут видеть всю переписку этого диалога — независимо от вашего разрешения.";

/** Предпросмотр: ровно тот текст, который будет сохранён и показан сотруднику. */
export function requestPreview(draft: string, redacted: boolean): string {
  return [
    "Передать администратору клиники через нашу систему этот текст — дословно, как вы написали:",
    `«${draft}»`,
    ...(redacted
      ? ["Телефоны и адреса почты из текста убраны — их передавать не нужно."]
      : []),
    "В панели клиники его увидят только сотрудники с ролью «Администратор» — чтобы решить ваш вопрос. " +
      "Хранится до 30 дней; отозвать можно в любой момент командой «отозвать передачу». " +
      "Это разрешение касается только нашей системы: переписку этого диалога администраторы сообщества ВКонтакте видят и без него.",
  ].join("\n\n");
}

/** Что именно уйдёт врачу — показывается до согласия, дословно. */
export function sharePreview(bookingId: number, s: ShareSummary): string {
  const lines = [
    `Область: ${MEDICAL_AREA_TITLES[s.area]}`,
    `Как вы описали: «${s.summary}»`,
    ...(s.trauma ? [`Травма: ${s.trauma === "yes" ? "была" : "не было"}`] : []),
    ...(s.duration ? [`Как давно: ${s.duration}`] : []),
    ...(s.redFlags.length > 0
      ? [
          `Тревожные признаки: ${s.redFlags.map((f) => RED_FLAG_TITLES[f]).join(", ")}`,
        ]
      : s.redFlagsDenied
        ? ["Тревожные признаки: отметили, что их нет"]
        : []),
  ];
  return [
    `Передать врачу записи №${bookingId} краткое описание жалобы? Это необязательно: на запись не влияет.`,
    "Будет передано только это:",
    lines.map((l) => `• ${l}`).join("\n"),
    "Получатель — только врач этой записи, цель — подготовка к приёму. " +
      "Сведения хранятся зашифрованно и удаляются через неделю после приёма, при отмене записи или по вашему отзыву в «Мои записи». " +
      "Переписка целиком врачу не передаётся.",
  ].join("\n\n");
}

function doctorLabel(doctorId: string, ctx: DialogContext): string {
  const doctor = ctx.schedule.getDoctor(doctorId);
  if (!doctor) return "врач не найден";
  const specialty = ctx.clinic.specialties.find(
    (s) => s.id === doctor.specialtyId,
  );
  return `${doctor.name}${specialty ? ` (${specialty.title})` : ""}`;
}

function describeBooking(
  booking: Pick<Booking, "doctorId" | "date" | "time">,
  ctx: DialogContext,
): string {
  const price = ctx.schedule.getDoctor(booking.doctorId)?.priceRub;
  return [
    `Врач: ${doctorLabel(booking.doctorId, ctx)}`,
    `Дата и время: ${formatDayShort(booking.date)}, ${booking.time}`,
    ...(price !== undefined ? [`Стоимость приёма: ${rubles(price)}`] : []),
    `Адрес: ${ctx.clinic.address}`,
  ].join("\n");
}

/** Текст, совпадающий с подписью кнопки текущего шага (без учёта регистра). */
export function matchOption(
  state: DialogState,
  text: string,
  ctx: DialogContext,
): Action | undefined {
  const reply = show(state, ctx).replies[0];
  for (const row of reply.buttons) {
    for (const button of row) {
      if (normalizeText(button.label) === text) return button.action;
    }
  }
  return undefined;
}

export { INITIAL_STATE };
