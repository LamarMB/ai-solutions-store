import { describe, expect, it } from "vitest";
import { createBot } from "@/bot/bot";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import type { Clinic, ClinicSource, Doctor } from "@/bot/clinic/types";
import {
  sanitizeDecision,
  type ConversationModel,
} from "@/bot/conversation/model";
import {
  requestedSpecialty,
  specialtyForArea,
} from "@/bot/conversation/specialties";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";
import type { Reply } from "@/bot/dialog/types";
import { conversationInstructions } from "@/bot/llm/openai-conversation";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import { SqliteStore } from "@/bot/storage/sqlite";

/**
 * Подбор направления по справочнику клиники (P0-4): никаких направлений
 * демонстрационной клиники в коде. Специалист есть — предлагаем его; нет или
 * все врачи отключены — честно говорим и зовём администратора; жалоба о
 * разном — пациент выбирает сам. Данные вымышленные.
 */

const NOW = new Date("2026-10-19T06:00:00Z");
const PEER = 7;

const doctor = (over: Partial<Doctor> & Pick<Doctor, "id" | "specialtyId">) =>
  ({
    name: "Ирина Смирнова",
    about: "Принимает взрослых пациентов.",
    slotMinutes: 30,
    hours: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday: weekday as 1 | 2 | 3 | 4 | 5,
      from: "09:00",
      to: "15:00",
    })),
    ...over,
  }) satisfies Doctor;

const CARDIO = { id: "sp-cardio", title: "Кардиолог", toWhom: "к кардиологу" };
const withCardiologist = (active = true): Clinic => ({
  ...fictionalClinic,
  specialties: [...fictionalClinic.specialties, CARDIO],
  doctors: [
    ...fictionalClinic.doctors,
    doctor({ id: "cardio-1", specialtyId: CARDIO.id, active }),
  ],
});

/** Клиника-клиент со своими id направлений (как после создания в панели). */
const ownIds: Clinic = {
  ...fictionalClinic,
  name: "Клиника «Пример»",
  specialties: [
    {
      id: "sp-a1",
      title: "Врач общей практики (терапевт)",
      toWhom: "к терапевту",
    },
    { id: "sp-b2", title: "Детский стоматолог", toWhom: "к стоматологу" },
    { id: "sp-c3", title: "Флеболог", toWhom: "к флебологу" },
  ],
  services: [],
  doctors: [
    doctor({ id: "d1", specialtyId: "sp-a1", name: "Павел Орлов" }),
    doctor({ id: "d2", specialtyId: "sp-b2", name: "Мария Белова" }),
    doctor({ id: "d3", specialtyId: "sp-c3", name: "Олег Егоров" }),
  ],
};

function setup(
  source: ClinicSource,
  { demo = true, model }: { demo?: boolean; model?: ConversationModel } = {},
) {
  const store = new SqliteStore(":memory:");
  const bot = createBot({
    clinic: source,
    schedule: new ClinicSchedule(source, store, () => NOW),
    sessions: store,
    interpreter: new RuleInterpreter(source),
    model,
    demo,
    now: () => NOW,
  });
  const say = (text: string) => bot.handle(PEER, { type: "text", text });
  const press = (last: Reply[], label: string) => {
    const button = last
      .flatMap((r) => r.buttons.flat())
      .find((b) => b.label === label);
    if (!button) throw new Error(`Нет кнопки «${label}»`);
    return bot.handle(PEER, { type: "action", payload: button.action });
  };
  return { say, press, store };
}

const text = (replies: Reply[]) => replies.map((r) => r.text).join("\n");
const labels = (replies: Reply[]) =>
  replies.flatMap((r) => r.buttons.flat()).map((b) => b.label);
const actions = (replies: Reply[]) =>
  replies.flatMap((r) => r.buttons.flat()).map((b) => b.action);

/** Модель, которая «ошибается»: на просьбу о кардиологе записывает к терапевту. */
const wrongModel = (clinic: Clinic): ConversationModel => ({
  decide: async () =>
    sanitizeDecision(
      {
        action: "start_booking",
        reply: "Записываю к терапевту.",
        question: null,
        complaint_area: null,
        complaint_summary: null,
        trauma: null,
        duration: null,
        red_flags: [],
        red_flags_denied: false,
        specialty_id: "therapist",
        doctor_id: null,
        date: null,
        time: null,
        info_topic: null,
        urgency: "none",
        new_topic: false,
      },
      clinic,
    ),
});

describe.each([
  ["demo", true],
  ["live", false],
] as const)("подбор направления по справочнику (%s)", (_mode, demo) => {
  it("кардиолог есть в справочнике — бот не говорит, что его нет, и показывает врачей", async () => {
    const t = setup(withCardiologist(), { demo });
    const r = await t.say("Нужен кардиолог");
    expect(text(r)).not.toMatch(/нет кардиолога|нет такого специалиста/);
    // Единственный врач направления выбирается сразу — дальше выбор дня.
    expect(text(r)).toMatch(/Ирина Смирнова/);
    expect(labels(r)).toContain("пн, 19 окт");

    const booking = await t.say("запишите к кардиологу");
    expect(text(booking)).toMatch(/Ирина Смирнова/);
  });

  it("кардиолога нет — честный ответ, администратор, никакой записи к нему", async () => {
    const t = setup(fictionalClinic, { demo });
    const r = await t.say("запишите к кардиологу на завтра");
    expect(text(r)).toMatch(/нет кардиолога\. Администратор подскажет/);
    expect(labels(r)).toEqual([
      "Выбрать направление",
      "Позвать администратора",
      "В меню",
    ]);
    // Ни выбора врача, ни времени, ни записи «вместо» кардиолога.
    expect(
      actions(r).some((a) => ["doc", "time", "near", "ok"].includes(a.a)),
    ).toBe(false);

    // Модель тоже не может записать к другому специалисту вместо него.
    const m = setup(fictionalClinic, {
      demo,
      model: wrongModel(fictionalClinic),
    });
    const viaModel = await m.say("хочу к кардиологу");
    expect(text(viaModel)).toMatch(/нет кардиолога/);
    expect(text(viaModel)).not.toMatch(/Записываю к терапевту/);
  });

  it("направление есть, но все врачи отключены — записи нет, администратор", async () => {
    const t = setup(withCardiologist(false), { demo });
    const r = await t.say("Нужен кардиолог");
    expect(text(r)).toMatch(
      /сейчас нельзя записаться к кардиологу — нет принимающих врачей\. Администратор подскажет/,
    );
    expect(labels(r)).toContain("Позвать администратора");
    // В выборе направлений его нет.
    const choose = await t.press(r, "Выбрать направление");
    expect(labels(choose)).not.toContain("Кардиолог");

    // Жалоба, направление которой без врачей: бот не предлагает его.
    const noDentists: Clinic = {
      ...fictionalClinic,
      doctors: fictionalClinic.doctors.map((d) =>
        d.specialtyId === "dentist" ? { ...d, active: false } : d,
      ),
    };
    const g = setup(noDentists, { demo });
    const tooth = await g.say("болит зуб");
    expect(text(tooth)).toMatch(
      /Подходящего направления в справочнике клиники я не нашёл\. Диагнозы я не ставлю/,
    );
    expect(text(tooth)).not.toMatch(/стоматолог/i);
    expect(labels(tooth)).toContain("Позвать администратора");
  });

  it("жалоба о разном — без выбора специалиста за пациента и без диагноза", async () => {
    const t = setup(fictionalClinic, { demo });
    const r = await t.say("болит зуб и колено");
    expect(text(r)).toMatch(
      /несколько разных жалоб\. Диагнозы я не ставлю и не могу сказать, какой специалист нужен/,
    );
    expect(text(r)).not.toMatch(/Могу предложить запись/);
    expect(labels(r)).toEqual([
      "Стоматолог",
      "Травматолог-ортопед",
      "Позвать администратора",
      "В меню",
    ]);
    // Пациент выбрал сам — дальше обычная запись.
    const chosen = await t.press(r, "Травматолог-ортопед");
    expect(text(chosen)).toMatch(/Игорь Макетов/);

    // «Просто запишите» по неоднозначной жалобе — тоже выбор, не догадка бота.
    const g = setup(fictionalClinic, { demo });
    await g.say("болит колено и горло");
    const again = await g.say("просто запишите");
    expect(text(again)).toMatch(/несколько разных жалоб/);
  });

  it("справочник обновился — бот сразу использует новые данные", async () => {
    let clinic: Clinic = fictionalClinic;
    const t = setup(() => clinic, { demo });
    expect(text(await t.say("Нужен кардиолог"))).toMatch(/нет кардиолога/);
    clinic = withCardiologist();
    const r = await t.say("Нужен кардиолог");
    expect(text(r)).not.toMatch(/нет кардиолога/);
    expect(text(r)).toMatch(/Ирина Смирнова/);
    // Врача отключили — снова без записи (другой текст: повтор бот пропускает).
    clinic = withCardiologist(false);
    expect(text(await t.say("запишите к кардиологу"))).toMatch(
      /нет принимающих врачей/,
    );
  });

  it("свои id направлений клиники: подбор по названиям справочника", async () => {
    const t = setup(ownIds, { demo });
    // Общее недомогание: сначала вопросы по плану, затем предложение терапевта.
    expect(text(await t.say("температура и слабость"))).toMatch(
      /Как давно это беспокоит/,
    );
    const r = await t.say("три дня");
    expect(text(r)).toMatch(/Есть ли что-то из этого/);
    const s = await t.press(r, "Нет, такого нет");
    expect(text(s)).toMatch(/запись к терапевту для очной оценки/);
    expect(text(s)).toMatch(/Павел Орлов/);

    const f = setup(ownIds, { demo });
    expect(text(await f.say("нужен флеболог"))).toMatch(/Олег Егоров/);
    expect(text(await f.say("запишите к зубному"))).toMatch(/Мария Белова/);
    // ЛОР в этой клинике нет — не придумываем.
    expect(text(await f.say("нужен лор"))).toMatch(
      /нет оториноларинголога \(ЛОР\)/,
    );
  });
});

describe("безопасность сохраняется", () => {
  it("экстренные признаки важнее поиска специалиста", async () => {
    const t = setup(fictionalClinic);
    const r = await t.say(
      "нужен кардиолог, сильная боль в груди и трудно дышать",
    );
    expect(text(r)).toMatch(/103|112/);
    expect(text(r)).not.toMatch(/нет кардиолога/);
  });

  it("просьба о лечении — отказ, даже если специалист назван", async () => {
    const t = setup(withCardiologist());
    const r = await t.say("кардиолог, какое лекарство пить от давления?");
    expect(text(r)).not.toMatch(/принимайте|таблетк|мг/i);
    expect(text(r)).toMatch(/не (?:назначаю|могу)|лечени|врач/i);
  });
});

describe("справочник вместо направлений демо-клиники", () => {
  it("направление области — по названию или id начальных данных, только с врачами", () => {
    expect(specialtyForArea(fictionalClinic, "joint")?.id).toBe("orthopedist");
    expect(specialtyForArea(ownIds, "general")?.id).toBe("sp-a1");
    expect(specialtyForArea(ownIds, "dental")?.id).toBe("sp-b2");
    expect(specialtyForArea(ownIds, "ent")).toBeUndefined();
  });

  it("названный специалист: есть, без врачей, нет; лишних совпадений нет", () => {
    const cardio = withCardiologist();
    expect(requestedSpecialty("нужен кардиолог", cardio)).toMatchObject({
      status: "available",
      specialty: { id: "sp-cardio" },
    });
    expect(
      requestedSpecialty("нужен кардиолог", withCardiologist(false)),
    ).toMatchObject({ status: "inactive" });
    expect(requestedSpecialty("есть гинеколог?", fictionalClinic)).toEqual({
      status: "absent",
      genitive: "гинеколога",
    });
    // «Психотерапевт» — не терапевт; обычный вопрос — не просьба о специалисте.
    expect(requestedSpecialty("нужен психотерапевт", fictionalClinic)).toEqual({
      status: "absent",
      genitive: "психиатра",
    });
    expect(requestedSpecialty("сколько стоит приём?", ownIds)).toBeUndefined();
  });

  it("инструкции модели: направления по жалобам — из справочника", () => {
    const own = conversationInstructions(ownIds, false);
    expect(own).toContain(
      "Направления клиники по жалобам: суставы, спина, последствия травм — направления нет в клинике; зубы — sp-b2; ухо, горло, нос — направления нет в клинике; дети — направления нет в клинике; общее недомогание, температура, простуда — sp-a1.",
    );
    expect(own).not.toMatch(/orthopedist|pediatrician|therapist/);
    expect(conversationInstructions(fictionalClinic)).toContain(
      "суставы, спина, последствия травм — orthopedist",
    );
  });
});
