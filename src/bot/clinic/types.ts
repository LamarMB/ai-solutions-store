/** День недели: 1 — понедельник … 7 — воскресенье (ISO). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Часы приёма в один из дней недели, время — «ЧЧ:ММ» по часовому поясу клиники. */
export type WorkingHours = { weekday: Weekday; from: string; to: string };

export type Specialty = {
  id: string;
  title: string;
  /** «к терапевту» — для естественных ответов. */
  toWhom: string;
};

export type Doctor = {
  id: string;
  name: string;
  specialtyId: string;
  /** Короткое описание для ответов пациентам (вымышленное). */
  about: string;
  /** Длительность приёма в минутах — шаг расписания. */
  slotMinutes: number;
  hours: readonly WorkingHours[];
  /** Стоимость приёма в рублях (если задана администратором). */
  priceRub?: number;
  /** false — врач отключён: не показывается пациентам и не принимает записи. */
  active?: boolean;
};

/**
 * Недоступность в расписании на дату: весь день (выходной, отпуск) или
 * интервал «ЧЧ:ММ»–«ЧЧ:ММ». Без doctorId — для всей клиники (праздник).
 */
export type ScheduleException = {
  doctorId?: string;
  date: string;
  from?: string;
  to?: string;
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
  /** Телефон регистратуры (необязательно). */
  phone?: string;
  /** Описание клиники и услуг для пациентов. */
  about?: string;
  exceptions?: readonly ScheduleException[];
};

/**
 * Источник данных клиники: готовый объект (тесты) или функция, которая читает
 * актуальные данные из общей базы при каждом обращении (бот и админ-панель).
 */
export type ClinicSource = Clinic | (() => Clinic);

export const resolveClinic = (source: ClinicSource): Clinic =>
  typeof source === "function" ? source() : source;

/** Врач принимает пациентов (не отключён администратором). */
export const isActiveDoctor = (doctor: Doctor) => doctor.active !== false;
