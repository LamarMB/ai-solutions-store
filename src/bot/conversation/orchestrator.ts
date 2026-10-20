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
  type RedFlag,
} from "@/bot/conversation/safety";
import {
  MAX_MESSAGE_CHARS,
  OFFTOPIC_MUTE_MS,
  OFFTOPIC_REPLIES_BEFORE_MUTE,
  TOO_LONG_TEXT,
  type StatKey,
} from "@/bot/conversation/guard";
import { classifyScope, OUT_OF_SCOPE_TEXT } from "@/bot/conversation/scope";
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
  composedRequest,
  greet,
  handleEvent as handleFlowEvent,
  handleMeaning,
  matchOption,
  nearestSlot,
  show,
  startBooking,
  startHandoff,
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
  /** Текущий момент — для паузы после повторного оффтопа. */
  now?: Date;
  /** false — без уточняющих вопросов о симптомах (BOT_MEDICAL_QUESTIONS). */
  medicalQuestions?: boolean;
};

export type TurnResult = {
  session: Session;
  replies: Reply[];
  effects: Effect[];
  /** Счётчики хода (без текста): отклонённые запросы, обращения к модели. */
  stats: StatKey[];
};

export const THANKS_TEXT =
  "Пожалуйста! Если понадобится помощь с записью или вопросом о клинике — пишите.";

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

/** Команда отзыва передачи обращений администратору через нашу систему. */
export const REVOKE_RE =
  /^(отозвать|отзыв|отозвать (передачу|обращение|согласие|разрешение)|отзываю (согласие|разрешение))$/;

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
type Step = DialogResult & { conv: Conversation; stats?: StatKey[] };
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
      return finish(step(newSession().conv, greet(ctx)), ctx);
    case "resume":
      return finish(
        step(session.conv, await handleFlowEvent(session.flow, event, ctx)),
        ctx,
      );
    case "action":
      return finish(await handleAction(session, event.payload, ctx), ctx);
    case "text":
      return finish(await handleText(session, event.text, ctx), ctx);
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
      case "shr":
        // Предпросмотр передачи врачу — из памяти разговора, не из кнопки.
        if (!conv.shareOffer || !ctx.consents)
          return step(
            conv,
            show(session.flow, ctx, [
              "Предложение устарело: описания жалобы для передачи нет.",
            ]),
          );
        return step(conv, show({ step: "share", ...conv.shareOffer }, ctx));
      case "shrok":
      case "shrno":
        // После решения пациента предложение больше не хранится.
        conv = { ...conv, shareOffer: undefined, pending: undefined };
        break;
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
  if (!text) return step(session.conv, show(flow, ctx));
  // Сэкономленный вызов модели считается, только если модель подключена.
  const saved = (key: StatKey): StatKey[] =>
    ctx.model ? [key, "model_requests_saved"] : [key];

  // Длинное сообщение в модель не уходит; тревожные признаки всё равно проверяются.
  if (raw.length > MAX_MESSAGE_CHARS) {
    if (urgencyOf({ redFlags: detectRedFlags(raw) }) === "emergency")
      return emergency(session.conv);
    return {
      state: flow,
      conv: session.conv,
      replies: [{ text: TOO_LONG_TEXT, buttons: [] }],
      stats: saved("too_long_rejected"),
    };
  }
  if (RESET_WORDS.includes(text)) return reset(ctx);
  if (REVOKE_RE.test(text) && ctx.requests)
    return step(
      addTurn(session.conv, "patient", text),
      revokeRequests(flow, ctx),
    );

  // Подпись кнопки текущего шага работает как нажатие — без модели.
  const withTurn = (t: string) =>
    addTurn(session.conv, "patient", redactContacts(t).text);
  const option =
    text === "назад" ? { a: "back" } : matchOption(flow, text, ctx);
  if (option) return handleAction({ flow, conv: withTurn(raw) }, option, ctx);
  // Что передать администратору: сообщение пациента — черновик обращения.
  // Тревожные признаки и здесь проверяются первыми. Модель не участвует.
  if (flow.step === "handoff_compose") {
    if (urgencyOf({ redFlags: detectRedFlags(raw) }) === "emergency")
      return emergency(withTurn(raw));
    const composed = composedRequest(raw);
    if (composed === "too_long")
      return step(
        session.conv,
        show(flow, ctx, [
          "Слишком длинно для обращения — напишите коротко, до 500 знаков.",
        ]),
      );
    if (composed)
      return step(
        withTurn(raw),
        show({ step: "handoff_consent", ...composed }, ctx),
      );
  }
  // «Да/нет» на шагах подтверждения — тоже без модели.
  if (
    ["confirm", "cancel", "handoff"].includes(flow.step) &&
    (YES_RE.test(text) || NO_RE.test(text) || text === "подтверждаю")
  ) {
    return step(
      withTurn(raw),
      await handleFlowEvent(flow, { type: "text", text: raw }, ctx),
    );
  }

  // 1. Правила безопасности — по всему тексту, до фильтра темы и модели:
  //    тревожный признак внутри постороннего текста не теряется.
  const wasEmergency = session.conv.urgency === "emergency";
  const flags = detectRedFlags(raw);
  if (
    session.conv.pending === "red_flags" &&
    flags.length === 0 &&
    YES_RE.test(text)
  )
    return emergency(withTurn(raw));

  // 2. Фильтр темы — до модели. Оффтоп и смена роли отклоняются без API.
  const verdict = classifyScope(raw, {
    clinic: ctx.clinic,
    pending: session.conv.pending !== undefined,
    inDialog: flow.step !== "menu" || session.conv.complaint !== undefined,
  });
  if (flags.length === 0) {
    if (verdict.kind === "rejected") {
      return offTopic(
        session,
        verdict.reason === "role_change"
          ? saved("role_change_rejected")
          : saved("offtopic_rejected"),
        ctx,
      );
    }
    if (verdict.kind === "greeting")
      return {
        ...step(session.conv, greet(ctx)),
        stats: saved("smalltalk_local"),
      };
    if (verdict.kind === "thanks")
      return {
        ...step(session.conv, show(flow, ctx, [THANKS_TEXT])),
        stats: saved("smalltalk_local"),
      };
  }
  // Дальше идёт только разрешённая часть сообщения.
  const allowed = verdict.kind === "allowed" ? verdict.text : raw;
  const allowedNorm = normalizeText(allowed);
  const safeText = redactContacts(allowed).text;
  let conv: Conversation = {
    ...addTurn(session.conv, "patient", safeText),
    offtopicStreak: 0,
    mutedUntil: undefined,
  };
  conv = applyRules(conv, allowed, allowedNorm, flags);
  if (conv.urgency === "emergency" && (!wasEmergency || flags.length > 0))
    return emergency(conv);
  const adviceRequest = isMedicalAdviceRequest(allowed);

  // 3. Модель ведёт разговор; её решение уже проверено по справочнику.
  if (ctx.model) {
    const decision = await ctx.model.decide({
      peerId: ctx.peerId,
      today: ctx.today,
      text: safeText,
      flow,
      conv,
    });
    const result = decision
      ? await execute(
          { flow, conv: session.conv },
          conv,
          decision,
          { adviceRequest, wasEmergency, raw: allowed },
          ctx,
        )
      : await fallback(flow, conv, allowed, allowedNorm, adviceRequest, ctx);
    return { ...result, stats: [...(result.stats ?? []), "model_requests"] };
  }

  // 4. Без модели — правила.
  return fallback(flow, conv, allowed, allowedNorm, adviceRequest, ctx);
}

/**
 * Посторонняя тема: точный шаблон без модели. После нескольких повторов подряд
 * бот на время перестаёт отвечать на оффтоп — медицинские вопросы работают.
 * Текст постороннего сообщения в историю не записывается.
 */
function offTopic(session: Session, stats: StatKey[], ctx: TurnContext): Step {
  const now = (ctx.now ?? new Date()).getTime();
  const conv: Conversation = { ...session.conv };
  if (conv.mutedUntil && Date.parse(conv.mutedUntil) > now) {
    const silenced: StatKey[] = stats.includes("model_requests_saved")
      ? ["offtopic_silenced", "model_requests_saved"]
      : ["offtopic_silenced"];
    return { state: session.flow, conv, replies: [], stats: silenced };
  }
  if (conv.mutedUntil) {
    // Пауза закончилась — счёт начинается заново.
    conv.mutedUntil = undefined;
    conv.offtopicStreak = 0;
  }
  conv.offtopicStreak += 1;
  if (conv.offtopicStreak >= OFFTOPIC_REPLIES_BEFORE_MUTE)
    conv.mutedUntil = new Date(now + OFFTOPIC_MUTE_MS).toISOString();
  return {
    state: session.flow,
    conv,
    replies: [
      {
        text: OUT_OF_SCOPE_TEXT,
        buttons: show({ step: "menu" }, ctx).replies[0].buttons,
      },
    ],
    stats,
  };
}

/** Факты по правилам: новая жалоба, ответы на последний вопрос, травма, срок, признаки. */
function applyRules(
  conv: Conversation,
  raw: string,
  text: string,
  flags: RedFlag[],
): Conversation {
  const hasFlags = flags.length > 0;
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
  if (hasFlags) next.redFlags = [...new Set([...next.redFlags, ...flags])];
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
  { flow, conv: original }: Session,
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

  if (decision.action === "out_of_scope") {
    // Модель отклонила тему: ответ — тот же шаблон, текст сообщения не хранится.
    return offTopic({ flow, conv: original }, ["model_out_of_scope"], ctx);
  }
  // Короткая реплика по ходу разговора; длинный «ответ на всё» не показывается.
  const replyAllowed =
    decision.action !== "small_talk" || decision.reply.length <= 200;
  const notes = decision.reply && replyAllowed ? [decision.reply] : [];
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
      // Текст обращения — слова пациента, не формулировка модели.
      return step(conv, startHandoff(ctx, raw));

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
  if (meaning.intent === "admin") return step(conv, startHandoff(ctx, raw));
  return step(conv, handleMeaning(flow, meaning, ctx));
}

/** Отзыв всех действующих передач собеседника (команда «отозвать передачу»). */
function revokeRequests(flow: DialogState, ctx: TurnContext): DialogResult {
  const revoked = ctx.requests?.revoke(ctx.peerId) ?? [];
  return show(flow, ctx, [
    revoked.length > 0
      ? `Передача ${revoked.length > 1 ? "обращений" : "обращения"} ${revoked.map((id) => `№${id}`).join(", ")} отозвана: ` +
        "текст удалён из панели клиники. Если сотрудник уже прочитал его, это не отменить. " +
        "Переписку в сообщениях сообщества это не затрагивает."
      : "Действующих передач обращений нет.",
  ]);
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
  // После экстренных признаков расспросы не продолжаются; в режиме без
  // медицинских вопросов (BOT_MEDICAL_QUESTIONS=false) их нет совсем.
  const open =
    conv.urgency === "emergency" || ctx.medicalQuestions === false
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

/**
 * Запоминает ответ бота; после записи забывает жалобу. Если жалоба была и
 * передача сведений настроена, к подтверждению записи добавляется
 * необязательная кнопка — без неё (и без нажатия «Передать врачу») ничего
 * не передаётся.
 */
function finish(result: Step, ctx: TurnContext): TurnResult {
  let conv = result.conv;
  let replies = result.replies;
  const booked = result.effects?.find((e) => e.type === "booked");
  if (booked) {
    const offer =
      ctx.consents && conv.complaint && conv.urgency !== "emergency"
        ? {
            bookingId: booked.bookingId,
            summary: {
              area: conv.complaint.area,
              summary: conv.complaint.summary.slice(0, 160),
              ...(conv.trauma ? { trauma: conv.trauma } : {}),
              ...(conv.duration ? { duration: conv.duration } : {}),
              redFlags: conv.redFlags,
              redFlagsDenied: conv.redFlagsDenied,
            },
          }
        : undefined;
    conv = { ...withoutComplaint(conv), shareOffer: offer };
    if (offer && replies.length > 0) {
      const [first, ...rest] = replies;
      replies = [
        {
          text:
            first.text +
            "\n\nЕщё можно (необязательно) передать врачу краткое описание жалобы — сначала покажу, что именно уйдёт.",
          buttons: [
            [{ label: "Передать врачу описание", action: { a: "shr" } }],
            ...first.buttons,
          ],
        },
        ...rest,
      ];
    }
  }
  for (const reply of replies) conv = addTurn(conv, "bot", reply.text);
  return {
    session: { flow: result.state, conv },
    replies,
    effects: (result.effects ?? []).filter((e) => e.type !== "booked"),
    stats: result.stats ?? [],
  };
}
