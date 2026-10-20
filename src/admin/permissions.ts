import type { StaffRole } from "@/bot/storage/admin-store";

/**
 * Права ролей панели. Проверяются на сервере для каждого запроса API
 * (src/admin/api.ts) и для каждой страницы; скрытие разделов в интерфейсе —
 * только удобство, не защита.
 *
 * Медицинских прав у owner и admin нет совсем. У doctor есть только право
 * запросить сведения по своей записи — выдаются они лишь при действующем
 * согласии пациента на эту запись и этого врача (ConsentStore).
 */
export const PERMISSIONS = {
  /** Главная: записи, неделя, счётчики бота (без текста сообщений). */
  "dashboard.read": ["owner", "admin"],
  /** Все записи клиники: номер, врач, время, статус, источник, маска VK ID. */
  "bookings.read": ["owner", "admin"],
  "bookings.write": ["owner", "admin"],
  "doctors.read": ["owner", "admin"],
  "doctors.write": ["owner", "admin"],
  "schedule.read": ["owner", "admin"],
  "schedule.write": ["owner", "admin"],
  "settings.read": ["owner"],
  "settings.write": ["owner"],
  /** Сотрудники, роли, приглашения. */
  "staff.manage": ["owner"],
  /** Журнал доступа к медицинским сведениям — только метаданные. */
  "medical_log.read": ["owner"],
  /**
   * Обращения пациентов с согласием на передачу текста администратору.
   * Получатель по тексту согласия — администраторы клиники: роль admin.
   * Владелец видит только журнал доступа (без содержания), врач — ничего.
   */
  "requests.handle": ["admin"],
  /** Свои приёмы (только записи к своему врачу расписания). */
  "own_bookings.read": ["doctor"],
  /** Запрос сведений по своей записи — дальше решает согласие пациента. */
  "own_medical.request": ["doctor"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: StaffRole, permission: Permission): boolean =>
  (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);

export const ROLE_TITLES: Record<StaffRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  doctor: "Врач",
};

/** Первая страница панели для роли. */
export const homeFor = (role: StaffRole) =>
  role === "doctor" ? "/admin/my" : "/admin";
