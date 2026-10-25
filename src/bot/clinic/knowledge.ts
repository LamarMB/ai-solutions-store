import { isActiveDoctor, type Clinic } from "@/bot/clinic/types";

const rub = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value).replace(/\s/g, " ")} ₽`;

/** Ответы на типовые вопросы — только из данных клиники, без модели. */
export const rubles = rub;

export function pricesText(clinic: Clinic): string {
  // Стоимость приёма конкретного врача, если её задал администратор.
  const doctorPrices = clinic.doctors
    .filter((d) => isActiveDoctor(d) && d.priceRub !== undefined)
    .map((d) => `• Приём: ${d.name} — ${rub(d.priceRub!)}`);
  return (
    "Цены (тестовые, клиника вымышленная):\n" +
    [
      ...clinic.services.map((s) => `• ${s.title} — ${rub(s.priceRub)}`),
      ...doctorPrices,
    ].join("\n")
  );
}

export function doctorsText(clinic: Clinic): string {
  return (
    "Наши врачи (вымышленные):\n" +
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
export function clinicReference(clinic: Clinic): string {
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
    pricesText(clinic),
    prepText(clinic),
  ].join("\n\n");
}
