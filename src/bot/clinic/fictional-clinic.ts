import type { Clinic } from "@/bot/clinic/types";

/**
 * Вымышленная клиника для демонстрационного прототипа. Все имена, адрес и
 * расписание выдуманы; совпадения с реальными людьми и организациями случайны.
 */
export const fictionalClinic = {
  name: "Тестовая клиника «Демо-Мед»",
  address: "г. Примерный, ул. Вымышленная, д. 1 (адрес вымышленный)",
  route:
    "Адрес вымышленный: это демонстрационная клиника. В настоящем боте здесь будет схема проезда, ближайшая остановка и парковка.",
  workingHours: "пн–сб с 08:00 до 19:00, вс — выходной",
  services: [
    { title: "Приём терапевта", specialtyId: "therapist", priceRub: 2000 },
    {
      title: "Повторный приём терапевта",
      specialtyId: "therapist",
      priceRub: 1600,
    },
    {
      title: "Консультация стоматолога",
      specialtyId: "dentist",
      priceRub: 1500,
    },
    {
      title: "Профессиональная гигиена полости рта",
      specialtyId: "dentist",
      priceRub: 4500,
    },
    { title: "Приём педиатра", specialtyId: "pediatrician", priceRub: 1900 },
    {
      title: "Приём оториноларинголога (ЛОР)",
      specialtyId: "ent",
      priceRub: 2100,
    },
    {
      title: "Приём травматолога-ортопеда",
      specialtyId: "orthopedist",
      priceRub: 2300,
    },
  ],
  visitTips: [
    "Приходите за 10 минут до приёма, чтобы оформить карту в регистратуре.",
    "Возьмите паспорт; для ребёнка — свидетельство о рождении и документ родителя.",
    "Если планы изменились, отмените запись в разделе «Мои записи» — время освободится для других.",
  ],
  timeZone: "Europe/Moscow",
  specialties: [
    { id: "therapist", title: "Терапевт", toWhom: "к терапевту" },
    { id: "dentist", title: "Стоматолог", toWhom: "к стоматологу" },
    { id: "pediatrician", title: "Педиатр", toWhom: "к педиатру" },
    {
      id: "ent",
      title: "Оториноларинголог (ЛОР)",
      toWhom: "к ЛОРу (оториноларингологу)",
    },
    {
      id: "orthopedist",
      title: "Травматолог-ортопед",
      toWhom: "к травматологу-ортопеду",
    },
  ],
  doctors: [
    {
      id: "testova",
      about: "Терапевт, принимает взрослых пациентов.",
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
      about: "Терапевт, принимает взрослых пациентов, в том числе в субботу.",
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
      about: "Стоматолог-терапевт: консультации и гигиена полости рта.",
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
      about: "Педиатр, принимает детей от рождения до 18 лет.",
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
      about: "Оториноларинголог (ЛОР), принимает взрослых и детей.",
      name: "Елена Образцова",
      specialtyId: "ent",
      slotMinutes: 30,
      hours: [
        { weekday: 2, from: "15:00", to: "19:00" },
        { weekday: 5, from: "09:00", to: "12:00" },
      ],
    },
    {
      id: "maketov",
      about:
        "Травматолог-ортопед: суставы, позвоночник, последствия травм; принимает взрослых.",
      name: "Игорь Макетов",
      specialtyId: "orthopedist",
      slotMinutes: 30,
      hours: [
        { weekday: 1, from: "14:00", to: "18:00" },
        { weekday: 2, from: "09:00", to: "13:00" },
        { weekday: 4, from: "09:00", to: "13:00" },
        { weekday: 6, from: "10:00", to: "14:00" },
      ],
    },
  ],
} as const satisfies Clinic;
