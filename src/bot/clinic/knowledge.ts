import type { Clinic } from "@/bot/clinic/types";

const rub = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value).replace(/\s/g, " ")} ₽`;

/** Ответы на типовые вопросы — только из данных клиники, без модели. */
export function pricesText(clinic: Clinic): string {
  return (
    "Цены (тестовые, клиника вымышленная):\n" +
    clinic.services.map((s) => `• ${s.title} — ${rub(s.priceRub)}`).join("\n")
  );
}

export function doctorsText(clinic: Clinic): string {
  return (
    "Наши врачи (вымышленные):\n" +
    clinic.doctors
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
  return `Адрес: ${clinic.address}\nРежим работы: ${clinic.workingHours}`;
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
    addressText(clinic),
    "Направления: " +
      clinic.specialties.map((s) => `${s.title} (id: ${s.id})`).join("; "),
    "Врачи:\n" +
      clinic.doctors
        .map(
          (d) =>
            `- ${d.name} (id: ${d.id}, направление: ${d.specialtyId}). ${d.about}`,
        )
        .join("\n"),
    pricesText(clinic),
    prepText(clinic),
  ].join("\n\n");
}
