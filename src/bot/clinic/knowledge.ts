import { isActiveDoctor, type Clinic } from "@/bot/clinic/types";

const rub = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value).replace(/\s/g, " ")} ₽`;

/** Ответы на типовые вопросы — только из данных клиники, без модели. */
export const rubles = rub;

/**
 * `demo` — демонстрационная клиника: в справке пометки «тестовые» и
 * «вымышленные». У клиники-клиента (BOT_MODE=live) их нет.
 */
export function pricesText(clinic: Clinic, demo = true): string {
  // Стоимость приёма конкретного врача, если её задал администратор.
  const doctorPrices = clinic.doctors
    .filter((d) => isActiveDoctor(d) && d.priceRub !== undefined)
    .map((d) => `• Приём: ${d.name} — ${rub(d.priceRub!)}`);
  return (
    (demo ? "Цены (тестовые, клиника вымышленная):\n" : "Цены:\n") +
    [
      ...clinic.services.map((s) => `• ${s.title} — ${rub(s.priceRub)}`),
      ...doctorPrices,
    ].join("\n")
  );
}

/**
 * Ответ о ценах длиннее — бот показывает цены по направлениям и по страницам:
 * сообщение ВКонтакте ограничено 4096 символами, а длинный список неудобно
 * читать в мессенджере.
 */
export const PRICES_TEXT_MAX = 3000;

/** Цены одного направления; id "" — услуги без специальности. */
export type PriceGroup = { id: string; title: string; lines: string[] };

/**
 * Цены по направлениям в порядке справочника: услуги и стоимость приёма
 * врачей направления. Пустые направления не показываются.
 */
export function priceGroups(clinic: Clinic): PriceGroup[] {
  const groups = [
    ...clinic.specialties.map((s) => ({ id: s.id, title: s.title })),
    { id: "", title: "Другие услуги" },
  ].map((g) => ({
    ...g,
    lines: [
      ...servicesOf(clinic, g.id).map(
        (s) => `• ${s.title} — ${rub(s.priceRub)}`,
      ),
      ...clinic.doctors
        .filter(
          (d) =>
            g.id &&
            d.specialtyId === g.id &&
            isActiveDoctor(d) &&
            d.priceRub !== undefined,
        )
        .map((d) => `• Приём: ${d.name} — ${rub(d.priceRub!)}`),
    ],
  }));
  return groups.filter((g) => g.lines.length > 0);
}

/** Услуги направления; "" — без специальности или с удалённой специальностью. */
function servicesOf(clinic: Clinic, specialtyId: string) {
  return clinic.services.filter((s) =>
    specialtyId
      ? s.specialtyId === specialtyId
      : !clinic.specialties.some((sp) => sp.id === s.specialtyId),
  );
}

/** Строки по страницам: каждая страница вместе с заголовком — не длиннее max. */
export function pageLines(lines: readonly string[], max: number): string[][] {
  const pages: string[][] = [];
  let page: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (page.length > 0 && size + line.length + 1 > max) {
      pages.push(page);
      page = [];
      size = 0;
    }
    page.push(line);
    size += line.length + 1;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

export function doctorsText(clinic: Clinic, demo = true): string {
  return (
    (demo ? "Наши врачи (вымышленные):\n" : "Наши врачи:\n") +
    clinic.doctors
      .filter(isActiveDoctor)
      .map((d) => {
        const specialty = clinic.specialties.find(
          (s) => s.id === d.specialtyId,
        );
        return `• ${d.name} — ${specialty?.title ?? ""}. ${d.about}`;
      })
      .join("\n")
  );
}

export function addressText(clinic: Clinic): string {
  return [
    `Адрес: ${clinic.address}`,
    `Режим работы: ${clinic.workingHours}`,
    ...(clinic.phone ? [`Телефон регистратуры: ${clinic.phone}`] : []),
  ].join("\n");
}

export function routeText(clinic: Clinic): string {
  return `${clinic.address}\n${clinic.route}`;
}

export function prepText(clinic: Clinic): string {
  return (
    "Памятка к визиту:\n" + clinic.visitTips.map((t) => `• ${t}`).join("\n")
  );
}

/**
 * Справка о клинике для системных инструкций модели. Модель отвечает только
 * по этим данным; записи и свободное время она не видит и не создаёт.
 */
export function clinicReference(clinic: Clinic, demo = true): string {
  return [
    `Клиника: ${clinic.name}`,
    ...(clinic.about ? [clinic.about] : []),
    addressText(clinic),
    "Направления: " +
      clinic.specialties
        .filter((s) =>
          clinic.doctors.some(
            (d) => d.specialtyId === s.id && isActiveDoctor(d),
          ),
        )
        .map((s) => `${s.title} (id: ${s.id})`)
        .join("; "),
    "Врачи:\n" +
      clinic.doctors
        .filter(isActiveDoctor)
        .map(
          (d) =>
            `- ${d.name} (id: ${d.id}, направление: ${d.specialtyId}). ${d.about}`,
        )
        .join("\n"),
    referencePrices(clinic, demo),
    prepText(clinic),
  ].join("\n\n");
}

/** Справка для модели — не длиннее: большой прайс увеличил бы каждый запрос. */
const REFERENCE_PRICES_MAX = 6000;

/**
 * Услуги в справке модели. Цены в ответах модель не пишет (их добавляет
 * программа), поэтому при большом прайсе — только названия по направлениям, а
 * сверх лимита — сколько услуг ещё есть.
 */
function referencePrices(clinic: Clinic, demo: boolean): string {
  const full = pricesText(clinic, demo);
  if (full.length <= PRICES_TEXT_MAX) return full;
  const lines = [
    "Услуги (цены программа покажет, когда пациент спросит о ценах):",
  ];
  let size = 0;
  let omitted = 0;
  for (const group of priceGroups(clinic)) {
    const titles = servicesOf(clinic, group.id).map((s) => s.title);
    const line = `${group.title}: ${titles.join("; ")}`;
    if (size + line.length > REFERENCE_PRICES_MAX) {
      omitted += titles.length;
      continue;
    }
    lines.push(line);
    size += line.length;
  }
  if (omitted > 0)
    lines.push(`…и ещё ${omitted} услуг — точный список у администратора.`);
  return lines.join("\n");
}
