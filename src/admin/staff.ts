import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { FAILURE_WINDOW_MS, hashToken, LoginThrottle } from "@/admin/auth";
import { hashPassword, passwordProblem } from "@/admin/password";
import {
  describeZodError,
  InviteAcceptSchema,
  InviteSchema,
  StaffPatchSchema,
} from "@/admin/schemas";
import type { AdminSession, StaffRole } from "@/bot/storage/admin-store";
import type { SqliteStore } from "@/bot/storage/sqlite";
import { AdminError } from "@/admin/errors";

/** Приглашение действует 72 часа и только один раз. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
/** Токен приглашения — 32 случайных байта в base64url (createInvite). */
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Неверных токенов приглашения с одного адреса за 15 минут — больше нельзя. */
export const INVITE_MAX_FAILURES = 10;
const INVALID_INVITE =
  "Приглашение недействительно: истекло, отозвано или уже использовано.";

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const { message, fields } = describeZodError(result.error);
    throw new AdminError(400, message, fields);
  }
  return result.data;
}

/**
 * Сотрудники панели (только роль owner, проверка — в api.ts).
 *
 * Учётные записи создаются приглашением: владелец указывает логин, роль и для
 * врача — врача расписания; сотрудник сам задаёт пароль по одноразовой
 * ссылке. Владелец пароля не знает, в базе — только хэш токена приглашения.
 */
export class StaffService {
  /** Неверные токены приглашений по адресу клиента — защита от перебора. */
  private readonly inviteThrottle: LoginThrottle;

  constructor(
    private readonly store: SqliteStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.inviteThrottle = new LoginThrottle(() => this.now().getTime());
  }

  private get at() {
    return this.now().toISOString();
  }

  list() {
    return {
      staff: this.store.admin.listUsers(),
      invites: this.store.admin.listInvites(this.at),
      doctors: this.store.clinic
        .listDoctors(this.at.slice(0, 10))
        .map((d) => ({ id: d.id, name: d.name })),
    };
  }

  /** Врач расписания существует и ещё не связан с другой учётной записью. */
  private checkDoctor(doctorId: string, exceptUserId?: number) {
    if (!this.store.clinic.load().doctors.some((d) => d.id === doctorId))
      throw new AdminError(400, "Выберите врача из расписания.", {
        doctorId: "Выберите врача из расписания.",
      });
    const linked = this.store.admin.userForDoctor(doctorId);
    if (linked && linked.id !== exceptUserId)
      throw new AdminError(
        409,
        `Этот врач уже связан с учётной записью «${linked.login}».`,
      );
  }

  createInvite(input: unknown, session: AdminSession) {
    const data = parse(InviteSchema, input);
    if (this.store.admin.findUser(data.login))
      throw new AdminError(409, "Такой логин уже есть.", {
        login: "Такой логин уже есть.",
      });
    if (data.role === "doctor") this.checkDoctor(data.doctorId!);
    const token = randomBytes(32).toString("base64url");
    const at = this.now();
    const id = this.store.admin.createInvite({
      tokenHash: hashToken(token),
      login: data.login,
      role: data.role,
      doctorId: data.role === "doctor" ? data.doctorId : null,
      createdBy: session.userId,
      at: at.toISOString(),
      expiresAt: new Date(at.getTime() + INVITE_TTL_MS).toISOString(),
    });
    this.store.admin.audit(
      session.userId,
      `invite_${data.role}`,
      "staff_invite",
      id,
      this.at,
    );
    // Токен показывается один раз; в базе остаётся только его хэш.
    return { id, token, expiresAt: new Date(at.getTime() + INVITE_TTL_MS) };
  }

  revokeInvite(id: number, session: AdminSession) {
    if (!this.store.admin.revokeInvite(id, this.at))
      throw new AdminError(404, "Приглашение не найдено или уже использовано.");
    this.store.admin.audit(
      session.userId,
      "revoke",
      "staff_invite",
      id,
      this.at,
    );
  }

  update(userId: number, input: unknown, session: AdminSession) {
    const user = this.store.admin.findUserById(userId);
    if (!user) throw new AdminError(404, "Сотрудник не найден.");
    if (user.id === session.userId)
      throw new AdminError(
        409,
        "Свою роль и доступ меняет другой владелец — так нельзя случайно остаться без владельца.",
      );
    const data = parse(StaffPatchSchema, input);
    const losesOwner =
      user.role === "owner" &&
      !user.disabled &&
      ("disabled" in data ? data.disabled : data.role !== "owner");
    if (losesOwner && this.store.admin.countActiveOwners() <= 1)
      throw new AdminError(409, "Нельзя оставить панель без владельца.");

    if ("disabled" in data) {
      this.store.admin.setDisabled(user.login, data.disabled, this.at);
      this.store.admin.audit(
        session.userId,
        data.disabled ? "disable" : "enable",
        "admin_user",
        user.id,
        this.at,
      );
    } else {
      const doctorId: string | null =
        data.role === "doctor" ? data.doctorId : null;
      if (doctorId) this.checkDoctor(doctorId, user.id);
      this.store.admin.setRole(user.id, data.role as StaffRole, doctorId);
      this.store.admin.audit(
        session.userId,
        `role_${data.role}`,
        "admin_user",
        user.id,
        this.at,
      );
    }
    return this.list();
  }

  // --- Принятие приглашения (без сессии) ------------------------------------

  /**
   * Действующее приглашение по токену. Сначала — лимит попыток и формат токена
   * (без обращения к базе), неверный токен засчитывается адресу клиента.
   * Ответ на неверный, истёкший и использованный токен одинаковый.
   */
  private findInvite(token: string, clientKey: string) {
    const key = `invite:${clientKey}`;
    if (this.inviteThrottle.isLocked([{ key, max: INVITE_MAX_FAILURES }]))
      throw new AdminError(
        429,
        `Слишком много попыток. Подождите ${FAILURE_WINDOW_MS / 60_000} минут.`,
      );
    const invite = INVITE_TOKEN_RE.test(token)
      ? this.store.admin.findInvite(hashToken(token), this.at)
      : undefined;
    if (!invite) {
      this.inviteThrottle.fail([key]);
      throw new AdminError(404, INVALID_INVITE);
    }
    return invite;
  }

  /** Что за приглашение — без секрета и без данных других сотрудников. */
  inviteInfo(token: string, clientKey: string) {
    const invite = this.findInvite(token, clientKey);
    return { login: invite.login, role: invite.role };
  }

  /**
   * Пароль по приглашению. Дорогой scrypt — только после проверки токена:
   * поток запросов с выдуманными токенами не нагружает сервер.
   */
  async acceptInvite(input: unknown, clientKey: string) {
    const data = parse(InviteAcceptSchema, input);
    const invite = this.findInvite(data.token, clientKey);
    const problem = passwordProblem(data.password, invite.login);
    if (problem) throw new AdminError(400, problem, { password: problem });
    // Приглашение проверяется ещё раз в транзакции: его могли отозвать или
    // использовать, пока считался хэш.
    const result = this.store.admin.acceptInvite(
      hashToken(data.token),
      await hashPassword(data.password),
      this.at,
    );
    if (!result.ok)
      throw new AdminError(
        result.reason === "taken" ? 409 : 404,
        result.reason === "taken"
          ? "Логин или врач уже заняты — попросите владельца прислать новое приглашение."
          : INVALID_INVITE,
      );
    this.store.admin.audit(
      result.userId,
      "accept",
      "staff_invite",
      result.userId,
      this.at,
    );
    return { login: this.store.admin.findUserById(result.userId)!.login };
  }
}
