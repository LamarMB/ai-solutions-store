"use client";

import { useState } from "react";
import { ROLE_TITLES } from "@/admin/permissions";
import type {
  StaffInvite,
  StaffMember,
  StaffRole,
} from "@/bot/storage/admin-store";
import { api, ApiError, useResource } from "@/components/admin/client";
import { formatMoment } from "@/components/admin/format";
import {
  ConfirmDialog,
  DangerButton,
  ErrorNote,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Select,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";

type StaffData = {
  staff: StaffMember[];
  invites: StaffInvite[];
  doctors: { id: string; name: string }[];
};

const ROLE_HINTS: Record<StaffRole, string> = {
  owner:
    "Сотрудники, роли, настройки клиники и все организационные разделы. Медицинских сведений в панели не видит.",
  admin:
    "Записи, врачи, расписание, «Обращения». В панели видит время, врача и статус записи, но не жалобы и не переписку. Переписку во ВКонтакте видит, если ему дан доступ к сообщениям сообщества.",
  doctor:
    "Только свои приёмы. Описание жалобы — только если пациент сам разрешил передать его врачу записи.",
};

function RoleFields({
  role,
  doctorId,
  doctors,
  onChange,
  errors = {},
}: {
  role: StaffRole;
  doctorId: string;
  doctors: StaffData["doctors"];
  onChange: (value: { role: StaffRole; doctorId: string }) => void;
  errors?: Record<string, string>;
}) {
  return (
    <>
      <Field label="Роль" hint={ROLE_HINTS[role]} error={errors.role}>
        {(props) => (
          <Select
            {...props}
            value={role}
            onChange={(e) =>
              onChange({ role: e.target.value as StaffRole, doctorId })
            }
          >
            {(Object.keys(ROLE_TITLES) as StaffRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_TITLES[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {role === "doctor" && (
        <Field
          label="Врач в расписании"
          hint="Сотрудник увидит только записи к этому врачу."
          error={errors.doctorId}
        >
          {(props) => (
            <Select
              {...props}
              value={doctorId}
              onChange={(e) => onChange({ role, doctorId: e.target.value })}
            >
              <option value="">Выберите врача</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </>
  );
}

/** Приглашение: логин и роль; пароль сотрудник задаёт сам по одноразовой ссылке. */
function InviteDialog({
  open,
  doctors,
  onClose,
  onDone,
}: {
  open: boolean;
  doctors: StaffData["doctors"];
  onClose: () => void;
  onDone: () => void;
}) {
  const [login, setLogin] = useState("");
  const [access, setAccess] = useState<{ role: StaffRole; doctorId: string }>({
    role: "admin",
    doctorId: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState(false);

  function close() {
    setLogin("");
    setAccess({ role: "admin", doctorId: "" });
    setLink(undefined);
    setError(undefined);
    setErrors({});
    onClose();
  }

  async function create() {
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      const result = await api<{ token: string }>("invites", {
        method: "POST",
        body: {
          login: login.trim(),
          role: access.role,
          doctorId: access.role === "doctor" ? access.doctorId || null : null,
        },
      });
      // Токен — во фрагменте (#): он не уходит на сервер в адресе и не
      // попадает в журналы веб-сервера.
      setLink(`${window.location.origin}/admin/invite#${result.token}`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setErrors(e.fields);
      } else setError("Не удалось создать приглашение.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Пригласить сотрудника" onClose={close}>
      {link ? (
        <div className="flex flex-col gap-4">
          <p>
            Ссылка показывается один раз и действует 72 часа. Передайте её
            сотруднику лично (не в общий чат): по ней он сам задаст пароль.
          </p>
          <Input readOnly value={link} onFocus={(e) => e.target.select()} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(link)}
            >
              Скопировать
            </Button>
            <Button onClick={close}>Готово</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <ErrorNote message={error} />}
          <Field
            label="Логин"
            hint="Латиница, цифры, точка, дефис (3–64 символа)."
            error={errors.login}
          >
            {(props) => (
              <Input
                {...props}
                value={login}
                autoComplete="off"
                onChange={(e) => setLogin(e.target.value)}
              />
            )}
          </Field>
          <RoleFields
            {...access}
            doctors={doctors}
            onChange={setAccess}
            errors={errors}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close} disabled={busy}>
              Отмена
            </Button>
            <Button onClick={create} disabled={busy || !login.trim()}>
              {busy ? "Создаю…" : "Создать ссылку"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RoleDialog({
  member,
  doctors,
  onClose,
  onDone,
}: {
  member?: StaffMember;
  doctors: StaffData["doctors"];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [access, setAccess] = useState({
    role: member?.role ?? "admin",
    doctorId: member?.doctorId ?? "",
  });
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!member) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(`staff/${member.id}`, {
        method: "PATCH",
        body: {
          role: access.role,
          doctorId: access.role === "doctor" ? access.doctorId || null : null,
        },
      });
      toast(`Роль «${member.login}» изменена. Его сессии завершены.`);
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setErrors(e.fields);
      } else setError("Не удалось изменить роль.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={member !== undefined}
      title={member ? `Роль: ${member.login}` : ""}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorNote message={error} />}
        <RoleFields
          {...access}
          doctors={doctors}
          onChange={setAccess}
          errors={errors}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Staff({ currentLogin }: { currentLogin: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useResource<StaffData>("staff");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffMember>();
  const [toggling, setToggling] = useState<StaffMember>();
  const [busy, setBusy] = useState(false);
  const doctorName = (id: string | null) =>
    data?.doctors.find((d) => d.id === id)?.name ?? id ?? "";

  async function toggle() {
    if (!toggling) return;
    setBusy(true);
    try {
      await api(`staff/${toggling.id}`, {
        method: "PATCH",
        body: { disabled: !toggling.disabled },
      });
      toast(
        toggling.disabled
          ? `Вход для «${toggling.login}» включён.`
          : `Вход для «${toggling.login}» отключён, сессии завершены.`,
      );
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось.", "error");
    } finally {
      setBusy(false);
      setToggling(undefined);
    }
  }

  async function revokeInvite(id: number) {
    try {
      await api(`invites/${id}`, { method: "DELETE", body: {} });
      toast("Приглашение отозвано.");
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось.", "error");
    }
  }

  return (
    <>
      <PageHeader
        title="Сотрудники"
        description="Роли и доступ. Ни одна роль сама по себе не открывает медицинские сведения."
        actions={<Button onClick={() => setInviting(true)}>Пригласить</Button>}
      />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <div className="flex flex-col gap-4">
            <Panel title="Учётные записи">
              <ul className="divide-border flex flex-col divide-y">
                {data.staff.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-medium">
                        {m.login}
                        {m.login === currentLogin && (
                          <span className="text-muted font-normal"> (вы)</span>
                        )}
                      </p>
                      <p className="text-small text-muted">
                        {ROLE_TITLES[m.role]}
                        {m.role === "doctor" && ` · ${doctorName(m.doctorId)}`}
                        {m.disabled && " · вход отключён"}
                      </p>
                    </div>
                    {m.login !== currentLogin && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditing(m)}
                        >
                          Роль
                        </Button>
                        {m.disabled ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setToggling(m)}
                          >
                            Включить вход
                          </Button>
                        ) : (
                          <DangerButton small onClick={() => setToggling(m)}>
                            Отключить
                          </DangerButton>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Действующие приглашения">
              {data.invites.length === 0 ? (
                <p className="text-muted">Нет.</p>
              ) : (
                <ul className="divide-border flex flex-col divide-y">
                  {data.invites.map((i) => (
                    <li
                      key={i.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <p>
                        {i.login} · {ROLE_TITLES[i.role]}
                        {i.role === "doctor" && ` · ${doctorName(i.doctorId)}`}
                        <span className="text-small text-muted">
                          {" "}
                          · до {formatMoment(i.expiresAt)}
                        </span>
                      </p>
                      <DangerButton small onClick={() => revokeInvite(i.id)}>
                        Отозвать
                      </DangerButton>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )
      )}
      <InviteDialog
        open={inviting}
        doctors={data?.doctors ?? []}
        onClose={() => setInviting(false)}
        onDone={reload}
      />
      <RoleDialog
        key={editing?.id ?? 0}
        member={editing}
        doctors={data?.doctors ?? []}
        onClose={() => setEditing(undefined)}
        onDone={reload}
      />
      <ConfirmDialog
        open={toggling !== undefined && !toggling.disabled}
        title="Отключить вход?"
        text={`«${toggling?.login}» не сможет войти, его сессии завершатся. Данные сохраняются.`}
        confirmLabel="Отключить"
        onConfirm={toggle}
        onClose={() => setToggling(undefined)}
        busy={busy}
      />
      <ConfirmDialog
        open={toggling !== undefined && toggling.disabled}
        title="Включить вход?"
        text={`«${toggling?.login}» снова сможет войти со своим паролем.`}
        confirmLabel="Включить"
        onConfirm={toggle}
        onClose={() => setToggling(undefined)}
        busy={busy}
      />
    </>
  );
}
