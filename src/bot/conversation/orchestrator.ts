import {
  addTurn,
  emptyConversation,
  newSession,
  withoutComplaint,
  type Conversation,
  type Session,
} from "@/bot/conversation/memory";
import type {
  ConversationModel,
  ModelDecision,
} from "@/bot/conversation/model";
import {
  detectDuration,
  detectRedFlags,
  detectTrauma,
  EMERGENCY_REMINDER,
  EMERGENCY_TEXT,
  isMedicalAdviceRequest,
  MEDICAL_ADVICE_REFUSAL,
  normalizeForRules,
  SOON_TEXT,
  urgencyOf,
} from "@/bot/conversation/safety";
import {
  AREA_SPECIALTY,
  complaintSummary,
  detectComplaint,
  detectMissingSpecialty,
  QUESTION_PLAN,
  questionText,
  type QuestionKey,
} from "@/bot/conversation/triage";
import {
  greet,
  handleEvent as handleFlowEvent,
  handleMeaning,
  matchOption,
  nearestSlot,
  show,
  startBooking,
  type DialogContext,
  type DialogResult,
} from "@/bot/dialog/dialog";
import { hasStem, normalizeText } from "@/bot/dialog/rule-interpreter";
import {
  ActionSchema,
  type BotEvent,
  type Button,
  type DialogState,
  type Effect,
  type Interpretation,
  type Reply,
} from "@/bot/dialog/types";
import { redactContacts } from "@/consultant/privacy";

export type TurnContext = DialogContext & {
  /** Разговорная модель; без неё бот работает по правилам и кнопкам. */
  model?: ConversationModel;
};

export type TurnResult = {
  session: Session;
  replies: Reply[];
  effects: Effect[];
};

/** Команды сброса разговора и удаления его истории. */
export const RESET_WORDS = [
  "сброс",
  "/reset",
  "начать заново",
  "начать сначала",
  "забудь",
  "очистить историю",
  "очисти историю",
  "удалить историю",
];

export const RESET_TEXT =
  "История разговора удалена. Начнём заново — расскажите, что нужно, или выберите действие.";

const ADMIN_BUTTON: Button = {
  label: "Позвать администратора",
  action: { a: "admin" },
};
const MENU_BUTTON: Button = { label: "В меню", action: { a: "menu" } };

const YES_RE = /^(?:да|ага|угу|был[аио]?|есть|конечно|верно)(?![а-я])/;
const NO_RE =
  /^(?:нет|неа|нету|не было|не падал\S*|не ударял\S*|ничего такого|ничего|такого нет)(?![а-я])/;
const MILD_RE =
  /(?:просто|иногда|немного|слегка|чуть|терпимо|несильно|не\s+сильно|ноет|побаливает)/;

/** Результат шага с обновлённой памятью разговора. */
type Step = DialogResult & { conv: Conversation };
const step = (conv: Conversation, result: DialogResult): Step => ({
  ...result,
  conv,
});

/**
 * Один ход разговора. Порядок:
 * 1) кнопки и короткие ответы на шагах записи — без модели;
 * 2) правила безопасности по тексту (модель не может их отменить);
 * 3) решение модели — проверяется и выполняется сервисами расписания;
 * 4) без модели или при ошибке — те же сценарии по правилам.
 * Запись создаётся только кнопкой «Подтвердить» или «да» на шаге подтверждения.
 */
export async function handleTurn(
  session: Session,
  event: BotEvent,
  ctx: TurnContext,
): Promise<TurnResult> {
  switch (event.type) {
    case "start":
      return finish(step(newSession().conv, greet(ctx)));
    case "resume":
      return finish(
        step(session.conv, await handleFlowEvent(session.flow, event, ctx)),
      );
    case "action":
      return finish(await handleAction(session, event.payload, ctx));
    case "text":
      return finish(await handleText(session, event.text, ctx));
  }
}

async function handleAction(
  session: Session,
  payload: unknown,
  ctx: TurnContext,
): Promise<Step> {
  const parsed = ActionSchema.safeParse(payload);
  let conv = session.conv;
  if (parsed.success) {
    const action = parsed.data;
    switch (action.a) {
      case "reset":
        return reset(ctx);
      case "ans":
        // Ответ кнопкой на вопрос о жалобе — только на заданный сейчас вопрос.
        if (conv.pending !== action.q || !conv.complaint)
          return step(conv, show(session.flow, ctx, ["Эта кнопка устарела."]));
        if (action.q === "red_flags" && action.v === "yes")
          return emergency(conv);
        conv = applyAnswer(conv, action.q, action.v);
        if (urgencyOf(conv) === "emergency") return emergency(conv);
        return continueComplaint(session.flow, conv, ctx);
      case "near":
        return step(conv, offerNearest(action.s, undefined, ctx));
      case "spec":
        conv = { ...conv, specialtyId: action.s, pending: undefined };
        break;
      default:
        conv = { ...conv, pending: undefined };
    }
  }
  return step(
    conv,
    await handleFlowEvent(session.flow, { type: "action", payload }, ctx),
  );
}

async function handleText(
  session: Session,
  raw: string,
  ctx: TurnContext,
): Promise<Step> {
  const { flow } = session;
  const text = normalizeText(raw);
  const safeText = redactContacts(raw).text;
  let conv = addTurn(session.conv, "patient", safeText);
  if (!text) return step(conv, show(flow, ctx));
  if (RESET_WORDS.includes(text)) return reset(ctx);

  // Подпись кнопки текущего шага работает как нажатие — без модели.
  const option =
    text === "назад" ? { a: "back" } : matchOption(flow, text, ctx);
  if (option) return handleAction({ flow, conv }, option, ctx);
  // «Да/нет» на шагах подтверждения — тоже без модели.
  if (
    ["confirm", "cancel", "handoff"].includes(flow.step) &&
    (YES_RE.test(text) || NO_RE.test(text) || text === "подтверждаю")
  ) {
    return step(
      conv,
      await handleFlowEvent(flow, { type: "text", text: raw }, ctx),
    );
  }

  // 1. Правила безопасности — до модели и независимо от неё.
  const wasEmergency = session.conv.urgency === "emergency";
  const flags = detectRedFlags(raw);
  if (
    session.conv.pending === "red_flags" &&
    flags.length === 0 &&
    YES_RE.test(text)
  )
    return emergency(conv);
  conv = applyRules(conv, raw, text, flags.length > 0);
  if (conv.urgency === "emergency" && (!wasEmergency || flags.length > 0))
    return emergency(conv);
  const adviceRequest = isMedicalAdviceRequest(raw);

  // 2. Модель ведёт разговор; её решение уже проверено по справочнику.
  const decision = ctx.model
    ? await ctx.model.decide({
        peerId: ctx.peerId,
        today: ctx.today,
        text: safeText,
        flow,
        conv,
      })
    : undefined;
  if (decision)
    return execute(
      flow,
      conv,
      decision,
      { adviceRequest, wasEmergency, raw },
      ctx,
    );

  // 3. Без модели — правила.
  return fallback(flow, conv, raw, text, adviceRequest, ctx);
}

/** Факты по правилам: новая жалоба, ответы на последний вопрос, травма, срок, признаки. */
function applyRules(
  conv: Conversation,
  raw: string,
  text: string,
  hasFlags: boolean,
): Conversation {
  let next = { ...conv };
  const found = detectComplaint(raw);
  // Новая жалоба — только если область названа прямо: «без травмы» или
  // «отёка нет» в ответ на вопрос не меняют тему.
  const changes =
    found &&
    (!next.complaint || (found.explicit && next.complaint.area !== found.area));
  if (found && changes) {
    // Прежние факты к новой жалобе не относятся.
    if (next.complaint) next = withoutComplaint(next);
    next.complaint = { area: found.area, summary: complaintSummary(raw) };
  }
  const trauma = detectTrauma(raw);
  if (next.pending === "trauma" && !trauma) {
    if (YES_RE.test(text)) next.trauma = "yes";
    else if (NO_RE.test(text)) next.trauma = "no";
  }
  if (next.pending === "red_flags" && !hasFlags) {
    if (NO_RE.test(text) || MILD_RE.test(normalizeForRules(raw)))
      next.redFlagsDenied = true;
  }
  next.trauma = trauma ?? next.trauma;
  next.duration = detectDuration(raw) ?? next.duration;
  if (hasFlags)
    next.redFlags = [...new Set([...next.redFlags, ...detectRedFlags(raw)])];
  next.urgency = keepEmergency(next);
  return next;
}

function applyAnswer(
  conv: Conversation,
  key: QuestionKey,
  value: "yes" | "no",
): Conversation {
  const next: Conversation = { ...conv, pending: undefined };
  if (key === "trauma") next.trauma = value;
  if (key === "red_flags" && value === "no") next.redFlagsDenied = true;
  next.urgency = keepEmergency(next);
  return next;
}

/** Срочность не понижается в рамках одной жалобы — даже если её подняла модель. */
const keepEmergency = (conv: Conversation) =>
  conv.urgency === "emergency" ? "emergency" : urgencyOf(conv);

/** Модель может добавить факты и повысить срочность, но не отменить правила. */
function mergeDecision(conv: Conversation, d: ModelDecision): Conversation {
  let next = { ...conv };
  if (
    d.newTopic &&
    next.complaint &&
    d.complaint?.area !== next.complaint.area
  ) {
    next = withoutComplaint(next);
  }
  if (d.complaint && !next.complaint) {
    next.complaint = {
      area: d.complaint.area,
      summary: d.complaint.summary || "жалоба",
    };
  }
  next.trauma ??= d.trauma;
  next.duration ??= d.duration;
  next.redFlags = [...new Set([...next.redFlags, ...d.redFlags])];
  if (
    d.redFlagsDenied &&
    next.pending === "red_flags" &&
    d.redFlags.length === 0
  )
    next.redFlagsDenied = true;
  if (d.specialtyId) next.specialtyId = d.specialtyId;
  next.urgency = d.urgency === "emergency" ? "emergency" : keepEmergency(next);
  return next;
}

async function execute(
  flow: DialogState,
  before: Conversation,
  decision: ModelDecision,
  {
    adviceRequest,
    wasEmergency,
    raw,
  }: { adviceRequest: boolean; wasEmergency: boolean; raw: string },
  ctx: TurnContext,
): Promise<Step> {
  const conv = mergeDecision(before, decision);
  if (
    decision.action === "urgent_care_guidance" ||
    (conv.urgency === "emergency" && !wasEmergency)
  ) {
    return emergency(conv);
  }

  const notes = decision.reply ? [decision.reply] : [];
  if (adviceRequest || decision.action === "decline_medical_advice") {
    return conv.complaint
      ? continueComplaint(flow, conv, ctx, { prefix: [MEDICAL_ADVICE_REFUSAL] })
      : step(conv, show(flow, ctx, [MEDICAL_ADVICE_REFUSAL]));
  }
  const reminder = conv.urgency === "emergency" ? [EMERGENCY_REMINDER] : [];
  const hints = withFlowContext(
    {
      intent: "book",
      specialtyId: decision.specialtyId,
      doctorId: decision.doctorId,
      date: decision.date,
      time: decision.time,
    },
    flow,
    conv,
  );

  switch (decision.action) {
    case "ask_clarification":
      if (conv.complaint)
        return continueComplaint(flow, conv, ctx, {
          question: { key: decision.question, text: decision.reply },
        });
      return step(
        conv,
        show(
          flow,
          ctx,
          notes.length > 0 ? notes : ["Уточните, пожалуйста, чем могу помочь."],
        ),
      );

    case "suggest_specialty":
      if (conv.complaint)
        return continueComplaint(flow, conv, ctx, {
          suggestion: notes,
          specialtyId: decision.specialtyId,
        });
      return step(conv, suggestSpecialty(hints.specialtyId, conv, ctx, notes));

    case "list_doctors":
      if (!hints.specialtyId)
        return step(conv, show({ step: "specialty" }, ctx, notes));
      return step(
        conv,
        show({ step: "doctor", specialtyId: hints.specialtyId }, ctx, [
          ...reminder,
          ...notes,
        ]),
      );

    case "list_available_slots":
    case "start_booking":
      return step(conv, startBooking(hints, ctx, [...reminder, ...notes]));

    case "nearest_slot":
      if (!hints.specialtyId)
        return step(conv, show({ step: "specialty" }, ctx, notes));
      return step(
        conv,
        offerNearest(hints.specialtyId, hints.doctorId, ctx, [
          ...reminder,
          ...notes,
        ]),
      );

    case "answer_clinic_question":
      return step(
        conv,
        handleMeaning(
          flow,
          {
            intent: "question",
            topic: decision.infoTopic,
            answer: decision.infoTopic
              ? undefined
              : decision.reply || undefined,
          },
          ctx,
        ),
      );

    case "show_bookings":
      return step(conv, show({ step: "bookings" }, ctx, notes));

    case "handoff_to_admin":
      return step(conv, show({ step: "handoff" }, ctx, notes));

    case "specialist_unavailable":
      // Модель ошиблась, а направление в клинике есть — показываем его врачей.
      if (decision.specialtyId)
        return step(
          conv,
          show({ step: "doctor", specialtyId: decision.specialtyId }, ctx),
        );
      return step(conv, unavailable(detectMissingSpecialty(raw), ctx));

    case "small_talk":
      return step(conv, show(flow, ctx, notes));
  }
}

/** Без модели: сценарии жалобы, записи и справки по правилам. */
async function fallback(
  flow: DialogState,
  conv: Conversation,
  raw: string,
  text: string,
  adviceRequest: boolean,
  ctx: TurnContext,
): Promise<Step> {
  if (adviceRequest) {
    return conv.complaint
      ? continueComplaint(flow, conv, ctx, { prefix: [MEDICAL_ADVICE_REFUSAL] })
      : step(conv, show(flow, ctx, [MEDICAL_ADVICE_REFUSAL]));
  }
  const missing = detectMissingSpecialty(raw);
  if (missing) return step(conv, unavailable(missing, ctx));

  const meaning = await ctx.interpreter.interpret(raw, {
    peerId: ctx.peerId,
    today: ctx.today,
    step: flow.step,
  });
  const area = detectComplaint(raw)?.explicit;
  const nearest = hasStem(text, ["ближайш"]);
  // «Да» на «Давайте посмотрим свободное время» — ближайшее время направления.
  if (flow.step === "doctor" && YES_RE.test(text))
    return step(conv, offerNearest(flow.specialtyId, undefined, ctx));
  const explicitBooking =
    meaning.intent === "book" &&
    Boolean(meaning.specialtyId || meaning.doctorId) &&
    !area;
  if (explicitBooking) {
    // Просьба записаться к конкретному специалисту — без расспросов о симптомах.
    const next = conv.complaint ? withoutComplaint(conv) : conv;
    return step(next, bookFromText(meaning, text, flow, next, ctx));
  }
  if (nearest || (meaning.intent === "book" && !area)) {
    if (conv.complaint && !nearest && !meaning.date && !meaning.time) {
      // «Просто запишите» во время расспросов — сразу к подходящему специалисту.
      const specialtyId =
        conv.specialtyId ?? AREA_SPECIALTY[conv.complaint.area];
      const next = { ...conv, pending: undefined, specialtyId };
      return step(next, suggestSpecialty(specialtyId, next, ctx, []));
    }
    return step(conv, bookFromText(meaning, text, flow, conv, ctx));
  }
  if (
    conv.complaint &&
    (area ||
      conv.pending ||
      meaning.intent === "other" ||
      meaning.intent === "medical")
  ) {
    return continueComplaint(flow, conv, ctx);
  }
  return step(conv, handleMeaning(flow, meaning, ctx));
}

function bookFromText(
  meaning: Interpretation,
  text: string,
  flow: DialogState,
  conv: Conversation,
  ctx: TurnContext,
): DialogResult {
  const nearest = hasStem(text, ["ближайш"]);
  // Контекст переносится, только если пациент уточняет время: «давай на завтра».
  // Просто «записаться» начинает выбор направления заново.
  const hints =
    nearest || meaning.date || meaning.time
      ? withFlowContext(meaning, flow, conv)
      : meaning;
  const reminder = conv.urgency === "emergency" ? [EMERGENCY_REMINDER] : [];
  if (nearest && hints.specialtyId) {
    return offerNearest(hints.specialtyId, hints.doctorId, ctx, reminder);
  }
  return startBooking(hints, ctx, reminder);
}

/** Подсказки записи дополняются выбранным ранее: «давай на завтра» — к тому же врачу. */
function withFlowContext(
  meaning: Interpretation,
  flow: DialogState,
  conv: Conversation,
): Interpretation {
  const result = { ...meaning };
  if (!result.specialtyId && !result.doctorId) {
    const flowSpecialty = "specialtyId" in flow ? flow.specialtyId : undefined;
    result.specialtyId =
      flowSpecialty ??
      conv.specialtyId ??
      (conv.complaint && AREA_SPECIALTY[conv.complaint.area]);
    if ("doctorId" in flow && result.specialtyId === flowSpecialty)
      result.doctorId = flow.doctorId;
  }
  if (result.time && !result.date && "date" in flow) result.date = flow.date;
  return result;
}

/**
 * Разговор о жалобе: следующий незаданный вопрос из плана или предложение
 * специалиста. Модель может сформулировать вопрос сама, но не может задать
 * уже заданный или отвеченный — тогда задаётся следующий по плану.
 */
function continueComplaint(
  flow: DialogState,
  conv: Conversation,
  ctx: TurnContext,
  options: {
    prefix?: string[];
    suggestion?: string[];
    question?: { key?: QuestionKey; text: string };
    specialtyId?: string;
  } = {},
): Step {
  const complaint = conv.complaint!;
  const prefix = options.prefix ?? [];
  const answered = (key: QuestionKey) =>
    conv.asked.includes(key) ||
    (key === "trauma" && conv.trauma !== undefined) ||
    (key === "duration" && conv.duration !== undefined) ||
    (key === "red_flags" && conv.redFlagsDenied);
  // После экстренных признаков расспросы не продолжаются.
  const open =
    conv.urgency === "emergency"
      ? []
      : QUESTION_PLAN[complaint.area].filter((k) => !answered(k));

  if (open.length > 0) {
    const asked = options.question;
    const key = asked?.key && open.includes(asked.key) ? asked.key : open[0];
    const question =
      asked?.key === key && asked.text
        ? asked.text
        : questionText(key, complaint.area);
    return {
      state: flow,
      conv: { ...conv, pending: key, asked: [...conv.asked, key] },
      replies: [
        {
          text: [...prefix, question].join("\n\n"),
          buttons: answerButtons(key),
        },
      ],
    };
  }

  const fallbackSpecialty = AREA_SPECIALTY[complaint.area];
  const specialtyId =
    options.specialtyId &&
    ctx.schedule.listSpecialties().some((s) => s.id === options.specialtyId)
      ? options.specialtyId
      : fallbackSpecialty;
  const next: Conversation = { ...conv, pending: undefined, specialtyId };
  return step(
    next,
    suggestSpecialty(specialtyId, next, ctx, [
      ...prefix,
      ...(options.suggestion ?? []),
    ]),
  );
}

function answerButtons(key: QuestionKey): Button[][] {
  switch (key) {
    case "trauma":
      return [
        [
          { label: "Была травма", action: { a: "ans", q: "trauma", v: "yes" } },
          { label: "Без травмы", action: { a: "ans", q: "trauma", v: "no" } },
        ],
        [ADMIN_BUTTON],
      ];
    case "red_flags":
      return [
        [
          {
            label: "Нет, такого нет",
            action: { a: "ans", q: "red_flags", v: "no" },
          },
          {
            label: "Да, есть",
            action: { a: "ans", q: "red_flags", v: "yes" },
            color: "negative",
          },
        ],
        [ADMIN_BUTTON],
      ];
    case "duration":
      return [[ADMIN_BUTTON]];
  }
}

function suggestSpecialty(
  specialtyId: string | undefined,
  conv: Conversation,
  ctx: TurnContext,
  notes: string[],
): DialogResult {
  const specialty = ctx.schedule
    .listSpecialties()
    .find((s) => s.id === specialtyId);
  if (!specialty) return unavailable(undefined, ctx);
  if (conv.urgency === "emergency") {
    // После экстренных признаков бот сам запись не предлагает.
    return {
      state: { step: "menu" },
      replies: [
        {
          text: [
            ...notes,
            EMERGENCY_REMINDER,
            `Если позже понадобится плановый приём ${specialty.toWhom}, напишите — помогу записаться.`,
          ].join("\n\n"),
          buttons: [[ADMIN_BUTTON], [MENU_BUTTON]],
        },
      ],
    };
  }
  const intro =
    notes.length > 0
      ? notes
      : [
          `Понял вас. Могу предложить запись ${specialty.toWhom} для очной оценки. Давайте посмотрим свободное время.`,
        ];
  const soon = conv.urgency === "soon" ? [SOON_TEXT] : [];
  return show({ step: "doctor", specialtyId: specialty.id }, ctx, [
    ...intro,
    ...soon,
  ]);
}

/** Ближайший свободный слот врача или направления — на подтверждение. */
function offerNearest(
  specialtyId: string,
  doctorId: string | undefined,
  ctx: TurnContext,
  notes: string[] = [],
): DialogResult {
  const slot = nearestSlot(ctx.schedule, specialtyId, doctorId);
  if (!slot) {
    return show({ step: "doctor", specialtyId }, ctx, [
      ...notes,
      "В ближайшие две недели свободного времени нет.",
    ]);
  }
  return show({ step: "confirm", specialtyId, ...slot }, ctx, [
    ...notes,
    "Нашёл ближайшее свободное время.",
  ]);
}

function unavailable(who: string | undefined, ctx: TurnContext): DialogResult {
  const clinic = ctx.clinic.name;
  return {
    state: { step: "menu" },
    replies: [
      {
        text:
          `${clinic}: нет ${who ?? "такого специалиста"}. ` +
          "Могу позвать администратора — он подскажет, куда обратиться, — или записать к терапевту на первичный приём.",
        buttons: [
          [
            {
              label: "Записаться к терапевту",
              action: { a: "near", s: "therapist" },
            },
          ],
          [ADMIN_BUTTON, MENU_BUTTON],
        ],
      },
    ],
  };
}

function emergency(conv: Conversation): Step {
  return {
    conv: { ...conv, urgency: "emergency", pending: undefined },
    state: { step: "menu" },
    replies: [
      { text: EMERGENCY_TEXT, buttons: [[ADMIN_BUTTON], [MENU_BUTTON]] },
    ],
  };
}

function reset(ctx: TurnContext): Step {
  return step(emptyConversation(), show({ step: "menu" }, ctx, [RESET_TEXT]));
}

/** Запоминает ответ бота; после записи забывает жалобу. */
function finish(result: Step): TurnResult {
  let conv = result.conv;
  if (result.effects?.some((e) => e.type === "booked"))
    conv = withoutComplaint(conv);
  for (const reply of result.replies) conv = addTurn(conv, "bot", reply.text);
  return {
    session: { flow: result.state, conv },
    replies: result.replies,
    effects: (result.effects ?? []).filter((e) => e.type !== "booked"),
  };
}
