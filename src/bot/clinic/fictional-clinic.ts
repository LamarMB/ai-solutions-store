import type { Clinic } from "@/bot/clinic/types";

/**
 * Вымышленная клиника для демонстрационного прототипа. Все имена, адрес и
 * расписание выдуманы; совпадения с реальными людьми и организациями случайны.
 */
export const fictionalClinic = {
  name: "Тестовая клиника «Демо-Мед»",
  address: "г. Примерный, ул. Вымышленная, д. 1 (адрес вымышленный)",
  timeZone: "Europe/Moscow",
  specialties: [
    { id: "therapist", title: "Терапевт" },
    { id: "dentist", title: "Стоматолог" },
    { id: "pediatrician", title: "Педиатр" },
    { id: "ent", title: "Оториноларинголог (ЛОР)" },
  ],
  doctors: [
    {
      id: "testova",
      name: "Анна Тестова",
      specialtyId: "therapist",
      slotMinutes: 30,
      hours: [
        { weekday: 1, from: "09:00", to: "13:00" },
        { weekday: 3, from: "09:00", to: "13:00" },
        { weekday: 5, from: "14:00", to: "18:00" },
      ],
    },
    {
      id: "primerov",
      name: "Павел Примеров",
      specialtyId: "therapist",
      slotMinutes: 30,
      hours: [
        { weekday: 2, from: "10:00", to: "16:00" },
        { weekday: 4, from: "10:00", to: "16:00" },
        { weekday: 6, from: "10:00", to: "13:00" },
      ],
    },
    {
      id: "demonstrova",
      name: "Мария Демонстрова",
      specialtyId: "dentist",
      slotMinutes: 60,
      hours: [
        { weekday: 1, from: "10:00", to: "17:00" },
        { weekday: 2, from: "10:00", to: "17:00" },
        { weekday: 4, from: "12:00", to: "19:00" },
      ],
    },
    {
      id: "vymyslov",
      name: "Олег Вымыслов",
      specialtyId: "pediatrician",
      slotMinutes: 30,
      hours: [
        { weekday: 1, from: "08:00", to: "12:00" },
        { weekday: 3, from: "14:00", to: "18:00" },
        { weekday: 5, from: "08:00", to: "12:00" },
      ],
    },
    {
      id: "obraztsova",
      name: "Елена Образцова",
      specialtyId: "ent",
      slotMinutes: 30,
      hours: [
        { weekday: 2, from: "15:00", to: "19:00" },
        { weekday: 5, from: "09:00", to: "12:00" },
      ],
    },
  ],
} as const satisfies Clinic;
