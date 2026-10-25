import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { ClinicSchedule } from "@/bot/schedule/schedule";
import {
  addDays,
  formatDayShort,
  localDateTime,
  weekday,
} from "@/bot/schedule/time";
import { SqliteStore } from "@/bot/storage/sqlite";

// Понедельник, 19 октября 2026, 09:00 по Москве.
const MONDAY_9AM = new Date("2026-10-19T06:00:00Z");
const MONDAY = "2026-10-19";

function setup(now = MONDAY_9AM) {
  const store = new SqliteStore(":memory:");
  const schedule = new ClinicSchedule(fictionalClinic, store, () => now);
  return { store, schedule };
}

describe("время клиники", () => {
  it("локальные дата и время по часовому поясу клиники", () => {
    expect(localDateTime(MONDAY_9AM, "Europe/Moscow")).toEqual({
      date: MONDAY,
      time: "09:00",
    });
  });

  it("календарь: день недели, сдвиг дат, короткая подпись", () => {
    expect(weekday(MONDAY)).toBe(1);
    expect(weekday("2026-10-25")).toBe(7);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(formatDayShort(MONDAY)).toBe("пн, 19 окт");
  });
});

describe("расписание", () => {
  it("слоты по часам приёма, без прошедшего времени и с запасом в час", () => {
    const { schedule } = setup();
    // Анна Тестова: пн 09:00–13:00 по 30 минут; сейчас 09:00 → с 10:00.
    expect(schedule.listFreeSlots("testova", MONDAY)).toEqual([
      "10:00",
      "10:30",
      "11:00",
      "11:30",
      "12:00",
      "12:30",
    ]);
    // Во вторник она не принимает.
    expect(schedule.listFreeSlots("testova", "2026-10-20")).toEqual([]);
  });

  it("дни — только рабочие и в пределах горизонта записи", () => {
    const { schedule } = setup();
    const days = schedule.listAvailableDays("testova");
    expect(days).toEqual([
      "2026-10-19",
      "2026-10-21",
      "2026-10-23",
      "2026-10-26",
      "2026-10-28",
      "2026-10-30",
    ]);
    expect(schedule.listFreeSlots("testova", "2026-11-02")).toEqual([]);
  });

  it("неизвестный врач и некорректные даты — пустой результат", () => {
    const { schedule } = setup();
    expect(schedule.listFreeSlots("nobody", MONDAY)).toEqual([]);
    expect(schedule.listFreeSlots("testova", "2026-13-40")).toEqual([]);
    expect(schedule.listAvailableDays("nobody")).toEqual([]);
  });

  it("запись занимает слот, отмена освобождает", () => {
    const { schedule } = setup();
    const result = schedule.book(1, "testova", MONDAY, "10:00");
    expect(result.status).toBe("ok");
    expect(schedule.listFreeSlots("testova", MONDAY)).not.toContain("10:00");
    expect(schedule.listBookings(1)).toHaveLength(1);

    const id = result.status === "ok" ? result.booking.id : 0;
    expect(schedule.cancel(1, id)).toBe(true);
    expect(schedule.cancel(1, id)).toBe(false);
    expect(schedule.listFreeSlots("testova", MONDAY)).toContain("10:00");
    expect(schedule.listBookings(1)).toEqual([]);
  });

  it("двойное бронирование невозможно: второй получает «занято»", () => {
    const { schedule } = setup();
    expect(schedule.book(1, "testova", MONDAY, "10:00").status).toBe("ok");
    expect(schedule.book(2, "testova", MONDAY, "10:00")).toEqual({
      status: "taken",
    });
    expect(schedule.book(1, "testova", MONDAY, "10:00")).toEqual({
      status: "taken",
    });
  });

  it("защита на уровне базы: уникальный индекс по активному слоту", () => {
    const { store } = setup();
    const booking = {
      peerId: 1,
      doctorId: "testova",
      date: MONDAY,
      time: "10:00",
      createdAt: MONDAY_9AM.toISOString(),
    };
    expect(store.insert(booking).status).toBe("ok");
    expect(store.insert({ ...booking, peerId: 2 })).toEqual({
      status: "conflict",
    });
  });

  it("нельзя записаться вне расписания, в прошлое и дальше горизонта", () => {
    const { schedule } = setup();
    for (const [date, time] of [
      [MONDAY, "09:00"], // меньше часа до приёма
      [MONDAY, "10:15"], // не начало слота
      [MONDAY, "13:00"], // после окончания приёма
      ["2026-10-20", "10:00"], // нерабочий день врача
      ["2026-10-12", "10:00"], // прошлое
      ["2026-11-02", "10:00"], // за горизонтом в две недели
      [MONDAY, "25:00"],
    ]) {
      expect(
        schedule.book(1, "testova", date, time),
        `${date} ${time}`,
      ).toEqual({ status: "unavailable" });
    }
    expect(schedule.book(1, "nobody", MONDAY, "10:00").status).toBe(
      "unavailable",
    );
  });

  it("не больше трёх активных записей у собеседника", () => {
    const { schedule } = setup();
    for (const time of ["10:00", "10:30", "11:00"]) {
      expect(schedule.book(1, "testova", MONDAY, time).status).toBe("ok");
    }
    expect(schedule.book(1, "testova", MONDAY, "11:30")).toEqual({
      status: "limit",
    });
    expect(schedule.book(2, "testova", MONDAY, "11:30").status).toBe("ok");
  });

  it("чужую запись отменить нельзя", () => {
    const { schedule } = setup();
    const result = schedule.book(1, "testova", MONDAY, "10:00");
    const id = result.status === "ok" ? result.booking.id : 0;
    expect(schedule.cancel(2, id)).toBe(false);
    expect(schedule.listBookings(1)).toHaveLength(1);
  });

  it("прошедшие приёмы не показываются среди активных", () => {
    const store = new SqliteStore(":memory:");
    let now = MONDAY_9AM;
    const schedule = new ClinicSchedule(fictionalClinic, store, () => now);
    expect(schedule.book(1, "testova", MONDAY, "10:00").status).toBe("ok");
    now = new Date("2026-10-19T08:00:00Z"); // 11:00 по Москве
    expect(schedule.listBookings(1)).toEqual([]);
  });
});

describe("SQLite-хранилище", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("записи сохраняются после перезапуска", () => {
    dir = mkdtempSync(join(tmpdir(), "bot-"));
    const path = join(dir, "nested", "bot.sqlite");
    const first = new SqliteStore(path);
    const schedule = new ClinicSchedule(
      fictionalClinic,
      first,
      () => MONDAY_9AM,
    );
    expect(schedule.book(7, "testova", MONDAY, "10:30").status).toBe("ok");
    first.save(7, { step: "menu" }, MONDAY_9AM.toISOString());
    first.close();

    const second = new SqliteStore(path);
    const reopened = new ClinicSchedule(
      fictionalClinic,
      second,
      () => MONDAY_9AM,
    );
    expect(reopened.listBookings(7).map((b) => b.time)).toEqual(["10:30"]);
    expect(reopened.listFreeSlots("testova", MONDAY)).not.toContain("10:30");
    expect(second.load(7)?.state).toEqual({ step: "menu" });
    second.close();
  });
});
