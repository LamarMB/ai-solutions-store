import type { DatabaseSync } from "node:sqlite";

/**
 * Роли сотрудников. Ни одна роль сама по себе не открывает медицинские сведения:
 * врач видит их только по согласию пациента на конкретную запись (ConsentStore).
 */
export const STAFF_ROLES = ["owner", "admin", "doctor"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type AdminUser = {
  id: number;
  login: string;
  passwordHash: string;
  disabled: boolean;
  role: StaffRole;
  doctorId: string | null;
};

export type AdminSession = {
  userId: number;
  login: string;
  role: StaffRole;
  /** Для роли doctor — врач расписания, чьи записи видит сотрудник. */
  doctorId: string | null;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

export type StaffMember = {
  id: number;
  login: string;
  role: StaffRole;
  doctorId: string | null;
  disabled: boolean;
  createdAt: string;
};

export type StaffInvite = {
  id: number;
  login: string;
  role: StaffRole;
  doctorId: string | null;
  createdAt: string;
  expiresAt: string;
};

export type AuditEntry = {
  at: string;
  login: string | null;
  action: string;
  entity: string;
  entityId: string | null;
};

type UserRow = {
  id: number;
  login: string;
  password_hash: string;
  disabled_at: string | null;
  role: StaffRole;
  doctor_id: string | null;
  created_at: string;
};

/**
 * Сотрудники и сессии панели. Пароли — только хэш scrypt (src/admin/password.ts),
 * сессии и приглашения — только SHA-256 токена. Журнал хранит действие и id
 * сущности, без персональных и медицинских данных.
 */
export class AdminStore {
  constructor(private readonly db: DatabaseSync) {}

  createUser(
    login: string,
    passwordHash: string,
    at: string,
    role: StaffRole,
    doctorId: string | null = null,
  ): number {
    return Number(
      this.db
        .prepare(
          "INSERT INTO admin_users (login, password_hash, created_at, role, doctor_id) VALUES (?, ?, ?, ?, ?)",
        )
        .run(login, passwordHash, at, role, role === "doctor" ? doctorId : null)
        .lastInsertRowid,
    );
  }

  private toUser(row: UserRow): AdminUser {
    return {
      id: row.id,
      login: row.login,
      passwordHash: row.password_hash,
      disabled: row.disabled_at !== null,
      role: row.role,
      doctorId: row.doctor_id,
    };
  }

  findUser(login: string): AdminUser | undefined {
    const row = this.db
      .prepare(
        "SELECT id, login, password_hash, disabled_at, role, doctor_id, created_at FROM admin_users WHERE login = ?",
      )
      .get(login) as UserRow | undefined;
    return row ? this.toUser(row) : undefined;
  }

  findUserById(id: number): AdminUser | undefined {
    const row = this.db
      .prepare(
        "SELECT id, login, password_hash, disabled_at, role, doctor_id, created_at FROM admin_users WHERE id = ?",
      )
      .get(id) as UserRow | undefined;
    return row ? this.toUser(row) : undefined;
  }

  listUsers(): StaffMember[] {
    return (
      this.db
        .prepare(
          "SELECT id, login, password_hash, disabled_at, role, doctor_id, created_at FROM admin_users ORDER BY id",
        )
        .all() as UserRow[]
    ).map((r) => ({
      id: r.id,
      login: r.login,
      role: r.role,
      doctorId: r.doctor_id,
      disabled: r.disabled_at !== null,
      createdAt: r.created_at,
    }));
  }

  /** Учётная запись, уже связанная с этим врачом расписания. */
  userForDoctor(doctorId: string): StaffMember | undefined {
    return this.listUsers().find((u) => u.doctorId === doctorId);
  }

  private endSessions(userId: number) {
    this.db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(userId);
  }

  setPassword(login: string, passwordHash: string): boolean {
    const user = this.findUser(login);
    if (!user) return false;
    this.db
      .prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?")
      .run(passwordHash, user.id);
    // Смена пароля завершает все сессии сотрудника.
    this.endSessions(user.id);
    return true;
  }

  setDisabled(login: string, disabled: boolean, at: string): boolean {
    const user = this.findUser(login);
    if (!user) return false;
    this.db
      .prepare("UPDATE admin_users SET disabled_at = ? WHERE id = ?")
      .run(disabled ? at : null, user.id);
    if (disabled) this.endSessions(user.id);
    return true;
  }

  /** Смена роли завершает сессии: новые права действуют только после нового входа. */
  setRole(userId: number, role: StaffRole, doctorId: string | null): boolean {
    const changed = Number(
      this.db
        .prepare("UPDATE admin_users SET role = ?, doctor_id = ? WHERE id = ?")
        .run(role, role === "doctor" ? doctorId : null, userId).changes,
    );
    if (changed) this.endSessions(userId);
    return changed === 1;
  }

  countUsers(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM admin_users").get() as {
        n: number;
      }
    ).n;
  }

  /** Активные владельцы: последнего нельзя отключить или понизить. */
  countActiveOwners(): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND disabled_at IS NULL",
        )
        .get() as { n: number }
    ).n;
  }

  createSession(
    tokenHash: string,
    userId: number,
    at: string,
    expiresAt: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(tokenHash, userId, at, expiresAt, at);
  }

  /** Сессия по хэшу токена — только действующая и только у активного сотрудника. */
  findSession(tokenHash: string, now: string): AdminSession | undefined {
    const row = this.db
      .prepare(
        `SELECT s.user_id, u.login, u.role, u.doctor_id, s.created_at, s.expires_at, s.last_seen_at
         FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
      )
      .get(tokenHash, now) as
      | {
          user_id: number;
          login: string;
          role: StaffRole;
          doctor_id: string | null;
          created_at: string;
          expires_at: string;
          last_seen_at: string;
        }
      | undefined;
    return row
      ? {
          userId: row.user_id,
          login: row.login,
          role: row.role,
          doctorId: row.doctor_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          lastSeenAt: row.last_seen_at,
        }
      : undefined;
  }

  touchSession(tokenHash: string, at: string, expiresAt: string) {
    this.db
      .prepare(
        "UPDATE admin_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
      )
      .run(at, expiresAt, tokenHash);
  }

  deleteSession(tokenHash: string) {
    this.db
      .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
      .run(tokenHash);
  }

  pruneSessions(now: string) {
    this.db
      .prepare("DELETE FROM admin_sessions WHERE expires_at <= ?")
      .run(now);
  }

  // --- Приглашения сотрудников ----------------------------------------------

  createInvite(input: {
    tokenHash: string;
    login: string;
    role: StaffRole;
    doctorId: string | null;
    createdBy: number;
    at: string;
    expiresAt: string;
  }): number {
    return Number(
      this.db
        .prepare(
          "INSERT INTO staff_invites (token_hash, login, role, doctor_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.tokenHash,
          input.login,
          input.role,
          input.role === "doctor" ? input.doctorId : null,
          input.createdBy,
          input.at,
          input.expiresAt,
        ).lastInsertRowid,
    );
  }

  /** Действующее (не использованное, не отозванное, не истёкшее) приглашение. */
  findInvite(tokenHash: string, now: string): StaffInvite | undefined {
    const row = this.db
      .prepare(
        `SELECT id, login, role, doctor_id, created_at, expires_at FROM staff_invites
         WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(tokenHash, now) as
      | {
          id: number;
          login: string;
          role: StaffRole;
          doctor_id: string | null;
          created_at: string;
          expires_at: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          login: row.login,
          role: row.role,
          doctorId: row.doctor_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        }
      : undefined;
  }

  listInvites(now: string): StaffInvite[] {
    return (
      this.db
        .prepare(
          `SELECT id, login, role, doctor_id, created_at, expires_at FROM staff_invites
           WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC`,
        )
        .all(now) as {
        id: number;
        login: string;
        role: StaffRole;
        doctor_id: string | null;
        created_at: string;
        expires_at: string;
      }[]
    ).map((r) => ({
      id: r.id,
      login: r.login,
      role: r.role,
      doctorId: r.doctor_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    }));
  }

  /** Использует приглашение и создаёт учётную запись — одной транзакцией. */
  acceptInvite(
    tokenHash: string,
    passwordHash: string,
    now: string,
  ): { ok: true; userId: number } | { ok: false; reason: "invalid" | "taken" } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const invite = this.findInvite(tokenHash, now);
      if (!invite) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "invalid" };
      }
      if (
        this.findUser(invite.login) ||
        (invite.doctorId && this.userForDoctor(invite.doctorId))
      ) {
        this.db.exec("ROLLBACK");
        return { ok: false, reason: "taken" };
      }
      const userId = this.createUser(
        invite.login,
        passwordHash,
        now,
        invite.role,
        invite.doctorId,
      );
      this.db
        .prepare("UPDATE staff_invites SET used_at = ? WHERE id = ?")
        .run(now, invite.id);
      this.db.exec("COMMIT");
      return { ok: true, userId };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  revokeInvite(id: number, at: string): boolean {
    return (
      Number(
        this.db
          .prepare(
            "UPDATE staff_invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL",
          )
          .run(at, id).changes,
      ) === 1
    );
  }

  // --- Журнал действий ----------------------------------------------------

  audit(
    userId: number | null,
    action: string,
    entity: string,
    entityId: string | number | null,
    at: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO admin_audit (at, user_id, action, entity, entity_id) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        at,
        userId,
        action,
        entity,
        entityId === null ? null : String(entityId),
      );
  }

  listAudit(limit = 50): AuditEntry[] {
    return (
      this.db
        .prepare(
          `SELECT a.at, u.login, a.action, a.entity, a.entity_id FROM admin_audit a
           LEFT JOIN admin_users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`,
        )
        .all(limit) as {
        at: string;
        login: string | null;
        action: string;
        entity: string;
        entity_id: string | null;
      }[]
    ).map((r) => ({
      at: r.at,
      login: r.login,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
    }));
  }
}
