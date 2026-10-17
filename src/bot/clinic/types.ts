/** День недели: 1 — понедельник … 7 — воскресенье (ISO). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Часы приёма в один из дней недели, время — «ЧЧ:ММ» по часовому поясу клиники. */
export type WorkingHours = { weekday: Weekday; from: string; to: string };

export type Specialty = { id: string; title: string };

export type Doctor = {
  id: string;
  name: string;
  specialtyId: string;
  /** Короткое описание для ответов пациентам (вымышленное). */
  about: string;
  /** Длительность приёма в минутах — шаг расписания. */
  slotMinutes: number;
  hours: readonly WorkingHours[];
};

/** Услуга с ценой в рублях. Цены вымышленные. */
export type Service = { title: string; specialtyId: string; priceRub: number };

export type Clinic = {
  name: string;
  address: string;
  /** Как добраться — для кнопки после записи. */
  route: string;
  /** Режим работы одной строкой. */
  workingHours: string;
  services: readonly Service[];
  /** Немедицинская памятка к визиту. */
  visitTips: readonly string[];
  /** Часовой пояс IANA: даты и время в боте — локальные для клиники. */
  timeZone: string;
  specialties: readonly Specialty[];
  doctors: readonly Doctor[];
};
