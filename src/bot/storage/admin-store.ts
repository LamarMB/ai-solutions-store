import type { DatabaseSync } from "node:sqlite";

export type AdminUser = {
  id: number;
  login: string;
  passwordHash: string;
  disabled: boolean;
};

export type AdminSession = {
  userId: number;
  login: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

export type AuditEntry = {
  at: string;
  login: string | null;
  action: string;
  entity: string;
  entityId: string | null;
};

/**
 * Администраторы и сессии панели. Пароли — только хэш scrypt (src/admin/password.ts),
 * сессии — только SHA-256 токена. Журнал хранит действие и id сущности, без
 * персональных данных.
 */
export class AdminStore {
  constructor(private readonly db: DatabaseSync) {}

  createUser(login: string, passwordHash: string, at: string): number {
    return Number(
      this.db
        .prepare(
          "INSERT INTO admin_users (login, password_hash, created_at) VALUES (?, ?, ?)",
        )
        .run(login, passwordHash, at).lastInsertRowid,
    );
  }

  findUser(login: string): AdminUser | undefined {
    const row = this.db
      .prepare(
        "SELECT id, login, password_hash, disabled_at FROM admin_users WHERE login = ?",
      )
      .get(login) as
      | {
          id: number;
          login: string;
          password_hash: string;
          disabled_at: string | null;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          login: row.login,
          passwordHash: row.password_hash,
          disabled: row.disabled_at !== null,
        }
      : undefined;
  }

  listUsers(): { login: string; disabled: boolean; createdAt: string }[] {
    return (
      this.db
        .prepare(
          "SELECT login, disabled_at, created_at FROM admin_users ORDER BY id",
        )
        .all() as {
        login: string;
        disabled_at: string | null;
        created_at: string;
      }[]
    ).map((r) => ({
      login: r.login,
      disabled: r.disabled_at !== null,
      createdAt: r.created_at,
    }));
  }

  setPassword(login: string, passwordHash: string): boolean {
    const user = this.findUser(login);
    if (!user) return false;
    this.db
      .prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?")
      .run(passwordHash, user.id);
    // Смена пароля завершает все сессии этого администратора.
    this.db
      .prepare("DELETE FROM admin_sessions WHERE user_id = ?")
      .run(user.id);
    return true;
  }

  setDisabled(login: string, disabled: boolean, at: string): boolean {
    const user = this.findUser(login);
    if (!user) return false;
    this.db
      .prepare("UPDATE admin_users SET disabled_at = ? WHERE id = ?")
      .run(disabled ? at : null, user.id);
    if (disabled)
      this.db
        .prepare("DELETE FROM admin_sessions WHERE user_id = ?")
        .run(user.id);
    return true;
  }

  countUsers(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM admin_users").get() as {
        n: number;
      }
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

  /** Сессия по хэшу токена — только действующая и только у активного администратора. */
  findSession(tokenHash: string, now: string): AdminSession | undefined {
    const row = this.db
      .prepare(
        `SELECT s.user_id, u.login, s.created_at, s.expires_at, s.last_seen_at FROM admin_sessions s
         JOIN admin_users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
      )
      .get(tokenHash, now) as
      | {
          user_id: number;
          login: string;
          created_at: string;
          expires_at: string;
          last_seen_at: string;
        }
      | undefined;
    return row
      ? {
          userId: row.user_id,
          login: row.login,
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
