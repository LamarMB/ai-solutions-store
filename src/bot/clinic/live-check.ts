import { isActiveDoctor, type Clinic } from "@/bot/clinic/types";

/**
 * Слова демонстрационной клиники: «демо», «демонстрационный», «вымышленный»,
 * «тестовый» — с начала слова, чтобы не цеплять «демодекоз» или
 * «аллерготесты». Фамилии вымышленных врачей (Демонстрова, Вымыслов) — тоже
 * признак демо.
 */
const DEMO_MARKER =
  /(^|[^а-яёa-z])(демо($|[^а-яёa-z])|демонстр|вымы[сш]л|тестов(ая|ое|ый|ые|ой|ого|ых)($|[^а-яё]))/i;

/**
 * Поля данных клиники, в которых остались пометки демонстрационной клиники.
 * В режиме клиники-клиента (BOT_MODE=live) бот не запускается, пока в
 * справочнике (панель → «Клиника», «Врачи», «Услуги») не заменены данные
 * вымышленной клиники, которые база получает при создании.
 */
export function demoMarkers(clinic: Clinic): string[] {
  const fields: [string, string | undefined][] = [
    ["название клиники", clinic.name],
    ["адрес", clinic.address],
    ["как добраться", clinic.route],
    ["режим работы", clinic.workingHours],
    ["о клинике", clinic.about],
    ["телефон", clinic.phone],
    ...clinic.visitTips.map((tip, i): [string, string] => [
      `памятка, пункт ${i + 1}`,
      tip,
    ]),
    ...clinic.services.map((s): [string, string] => [
      `услуга «${s.title}»`,
      s.title,
    ]),
    ...clinic.specialties.map((s): [string, string] => [
      `направление «${s.title}»`,
      s.title,
    ]),
    // Отключённых врачей пациенты не видят.
    ...clinic.doctors
      .filter(isActiveDoctor)
      .flatMap((d): [string, string][] => [
        [`врач ${d.id}: имя`, d.name],
        [`врач ${d.id}: описание`, d.about],
      ]),
  ];
  return fields
    .filter(([, value]) => value !== undefined && DEMO_MARKER.test(value))
    .map(([label]) => label);
}
