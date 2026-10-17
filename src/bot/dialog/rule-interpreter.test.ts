import { describe, expect, it } from "vitest";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { RuleInterpreter } from "@/bot/dialog/rule-interpreter";

const rules = new RuleInterpreter(fictionalClinic);
const ctx = { peerId: 1, today: "2026-10-19", step: "menu" as const };
const read = (text: string) => rules.interpret(text, ctx);

describe("правила разбора текста", () => {
  it.each([
    [
      "Хочу записаться к стоматологу",
      { intent: "book", specialtyId: "dentist" },
    ],
    [
      "Запишите к Анне Тестовой завтра в 10:30",
      {
        intent: "book",
        doctorId: "testova",
        specialtyId: "therapist",
        date: "2026-10-20",
        time: "10:30",
      },
    ],
    [
      "Нужен приём ЛОРа сегодня",
      { intent: "book", specialtyId: "ent", date: "2026-10-19" },
    ],
    ["Сколько стоит приём терапевта?", { intent: "question", topic: "prices" }],
    ["Где вы находитесь?", { intent: "question", topic: "address" }],
    ["Как до вас добраться?", { intent: "question", topic: "route" }],
    ["Что взять с собой на приём?", { intent: "question", topic: "prep" }],
    ["Хочу отменить запись", { intent: "my_bookings" }],
    ["Позовите живого человека", { intent: "admin" }],
    ["У ребёнка температура, что дать?", { intent: "medical" }],
    ["Посмотрите мои анализы", { intent: "medical" }],
    ["да", { intent: "yes" }],
    ["Нет", { intent: "no" }],
    ["Здравствуйте", { intent: "greeting" }],
    ["расскажите анекдот", { intent: "other" }],
  ])("%s", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });
});
