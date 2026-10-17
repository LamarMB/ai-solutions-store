import type { Clinic } from "@/bot/clinic/types";
import { normalizeText } from "@/bot/dialog/rule-interpreter";
import {
  ActionSchema,
  INITIAL_STATE,
  type Action,
  type BotEvent,
  type Button,
  type DialogState,
  type Reply,
  type TextInterpreter,
} from "@/bot/dialog/types";
import type { ScheduleProvider } from "@/bot/schedule/schedule";
import { formatDayShort } from "@/bot/schedule/time";
import type { Booking } from "@/bot/storage/types";

export type DialogContext = {
  peerId: number;
  clinic: Clinic;
  schedule: ScheduleProvider;
  interpreter: TextInterpreter;
};

export type DialogResult = { state: DialogState; replies: Reply[] };

/** Время на одной странице выбора: вместе с навигацией — не больше 10 кнопок. */
export const TIMES_PER_PAGE = 6;

const MENU: Button = { label: "В меню", action: { a: "menu" } };
const BACK: Button = { label: "Назад", action: { a: "back" } };

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    rows.push(items.slice(i, i + size));
  return rows;
};

/**
 * Один шаг диалога: состояние + событие → новое состояние и ответы.
 * Не знает о ВКонтакте и LLM: канал передаёт события и показывает ответы.
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
  if (text === "назад") return handleAction(state, { a: "back" }, ctx);

  const intent = await ctx.interpreter.interpret(event.text);
  if (intent === "medical") return medical(state, ctx);

  // Текст, совпадающий с кнопкой текущего шага, работает как нажатие.
  const option = matchOption(state, text, ctx);
  if (option) return handleAction(state, option, ctx);

  switch (intent) {
    case "start":
      return greet(ctx);
    case "menu":
      return show({ step: "menu" }, ctx);
    case "book":
      return show({ step: "specialty" }, ctx);
    case "my_bookings":
      return show({ step: "bookings" }, ctx);
    case "admin":
      return show(state, ctx, [
        "Передача диалога администратору появится в следующей версии прототипа. Пока вы можете записаться или посмотреть свои записи самостоятельно.",
      ]);
    case "yes":
      if (state.step === "confirm" || state.step === "cancel") {
        return handleAction(
          state,
          { a: state.step === "confirm" ? "ok" : "cxok" },
          ctx,
        );
      }
      break;
    case "no":
      if (state.step === "confirm" || state.step === "cancel") {
        return handleAction(state, { a: "back" }, ctx);
      }
      break;
  }
  return show(state, ctx, [
    "Я пока умею записывать на приём и показывать ваши записи. Выберите действие кнопкой.",
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

    case "cxok": {
      if (state.step !== "cancel") return stale(state, ctx);
      const cancelled = schedule.cancel(ctx.peerId, state.bookingId);
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
      return {
        state: { step: "menu" },
        replies: [
          {
            text:
              `Запись №${result.booking.id} подтверждена (тестовое расписание).\n` +
              describeBooking(result.booking, ctx) +
              "\n\nБольше ничего делать не нужно — диалог можно закрыть. Отменить запись можно в разделе «Мои записи».",
            buttons: [[{ label: "Мои записи", action: { a: "my" } }, MENU]],
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

function greet(ctx: DialogContext): DialogResult {
  return show({ step: "menu" }, ctx, [
    `Здравствуйте! Это демонстрационный бот: ${ctx.clinic.name}.\n` +
      "Врачи и расписание вымышленные, запись — тестовая.\n" +
      "Пожалуйста, не отправляйте медицинские данные: жалобы, диагнозы, документы.",
  ]);
}

function medical(state: DialogState, ctx: DialogContext): DialogResult {
  return show(state, ctx, [
    "Я не даю медицинских советов, не ставлю диагнозы и не назначаю лечение. " +
      "С вопросами о здоровье обратитесь к врачу — на приём можно записаться здесь. " +
      "При угрозе жизни звоните 103 или 112.\n" +
      "Пожалуйста, не присылайте описание жалоб: в прототипе такие данные не собираются.",
  ]);
}

function stale(state: DialogState, ctx: DialogContext): DialogResult {
  return show(state, ctx, ["Эта кнопка устарела. Вот актуальные варианты."]);
}

/** Шаг назад по сценарию. */
function previous(state: DialogState): DialogState {
  switch (state.step) {
    case "specialty":
    case "bookings":
    case "menu":
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

/** Показывает шаг; если данных для него больше нет — ближайший осмысленный шаг. */
function show(
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
      return reply("Чем могу помочь?", [
        [
          {
            label: "Записаться на приём",
            action: { a: "book" },
            color: "primary",
          },
          { label: "Мои записи", action: { a: "my" } },
        ],
      ]);

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
      return reply(`${specialty.title}. Выберите врача:`, [
        ...schedule
          .listDoctors(specialty.id)
          .map((d) => [
            { label: d.name, action: { a: "doc", d: d.id } as Action },
          ]),
        [BACK, MENU],
      ]);
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
        return reply("Активных записей нет.", [
          [
            {
              label: "Записаться на приём",
              action: { a: "book" },
              color: "primary",
            },
            MENU,
          ],
        ]);
      }
      return reply(
        "Ваши записи:\n" +
          bookings
            .map(
              (b) =>
                `№${b.id}: ${formatDayShort(b.date)}, ${b.time} — ${doctorLabel(b.doctorId, ctx)}`,
            )
            .join("\n"),
        [
          ...bookings.map((b) => [
            {
              label: `Отменить №${b.id}`,
              action: { a: "cx", b: b.id } as Action,
              color: "negative" as const,
            },
          ]),
          [{ label: "Записаться ещё", action: { a: "book" } }, MENU],
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
            { label: "Да, отменить", action: { a: "cxok" }, color: "negative" },
            { label: "Нет", action: { a: "back" } },
          ],
        ],
      );
    }
  }
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
  return [
    `Врач: ${doctorLabel(booking.doctorId, ctx)}`,
    `Дата и время: ${formatDayShort(booking.date)}, ${booking.time}`,
    `Адрес: ${ctx.clinic.address}`,
  ].join("\n");
}

/** Текст, совпадающий с подписью кнопки текущего шага (без учёта регистра). */
function matchOption(
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
