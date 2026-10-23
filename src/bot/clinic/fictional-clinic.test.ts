import { describe, expect, it } from "vitest";
import { fictionalClinic } from "@/bot/clinic/fictional-clinic";
import { isTime, toMinutes } from "@/bot/schedule/time";

describe("вымышленная клиника", () => {
  it("явно помечена как вымышленная", () => {
    expect(fictionalClinic.name).toMatch(/Тестовая клиника/);
    expect(fictionalClinic.address).toMatch(/вымышленный/);
  });

  it("врачи ссылаются на существующие направления, id уникальны", () => {
    const specialties = new Set(fictionalClinic.specialties.map((s) => s.id));
    const ids = fictionalClinic.doctors.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const doctor of fictionalClinic.doctors) {
      expect(specialties.has(doctor.specialtyId), doctor.id).toBe(true);
    }
    for (const specialty of specialties) {
      expect(
        fictionalClinic.doctors.some((d) => d.specialtyId === specialty),
        specialty,
      ).toBe(true);
    }
  });

  it("часы приёма корректны", () => {
    for (const doctor of fictionalClinic.doctors) {
      expect(doctor.hours.length, doctor.id).toBeGreaterThan(0);
      for (const h of doctor.hours) {
        expect(isTime(h.from) && isTime(h.to), doctor.id).toBe(true);
        expect(toMinutes(h.to) - toMinutes(h.from)).toBeGreaterThanOrEqual(
          doctor.slotMinutes,
        );
      }
    }
  });
});
