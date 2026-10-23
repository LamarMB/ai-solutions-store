"use client";

import { useState } from "react";
import type { Service, Specialty } from "@/bot/clinic/types";
import type { ClinicSettings } from "@/bot/storage/clinic-store";
import { api, ApiError, useResource } from "@/components/admin/client";
import {
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Select,
  Textarea,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";

type SettingsData = {
  settings: ClinicSettings;
  services: Service[];
  specialties: Specialty[];
};

type ServiceRow = { title: string; specialtyId: string; priceRub: string };

export function Settings() {
  const { data, error, loading, reload } =
    useResource<SettingsData>("settings");
  const [version, setVersion] = useState(0);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  // Форма создаётся заново после сохранения — с данными, которые вернул сервер.
  return (
    <SettingsForm
      key={version}
      data={data}
      onSaved={() => {
        reload();
        setVersion((v) => v + 1);
      }}
    />
  );
}

function SettingsForm({
  data,
  onSaved,
}: {
  data: SettingsData;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [settings, setSettings] = useState<ClinicSettings>(data.settings);
  const [tips, setTips] = useState(data.settings.visitTips.join("\n"));
  const [services, setServices] = useState<ServiceRow[]>(() =>
    data.services.map((s) => ({ ...s, priceRub: String(s.priceRub) })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (key: keyof ClinicSettings) => (value: string) =>
    setSettings((s) => ({ ...s, [key]: value }));

  async function save() {
    setBusy(true);
    setErrors({});
    setFormError(undefined);
    try {
      await api("settings", {
        method: "PUT",
        body: {
          settings: {
            ...settings,
            visitTips: tips
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean),
          },
          services: services.map((s) => ({
            title: s.title,
            specialtyId: s.specialtyId,
            priceRub: Number(s.priceRub),
          })),
        },
      });
      toast("Настройки сохранены. Бот отвечает пациентам по новым данным.");
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setFormError(e.message);
        setErrors(e.fields);
      } else setFormError("Не удалось сохранить.");
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) => errors[`settings.${key}`];
  return (
    <>
      <PageHeader
        title="Настройки клиники"
        description="Эти сведения бот сообщает пациентам: адрес, режим работы, цены, памятка к визиту."
        actions={
          <Button onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        }
      />
      {formError && (
        <div className="mb-6">
          <ErrorNote message={formError} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Клиника">
          <div className="flex flex-col gap-4">
            <Field label="Название" error={fieldError("name")}>
              {(props) => (
                <Input
                  {...props}
                  value={settings.name}
                  maxLength={100}
                  onChange={(e) => set("name")(e.target.value)}
                />
              )}
            </Field>
            <Field label="Адрес" error={fieldError("address")}>
              {(props) => (
                <Input
                  {...props}
                  value={settings.address}
                  maxLength={200}
                  onChange={(e) => set("address")(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Телефон регистратуры"
              error={fieldError("phone")}
              hint="Необязательно. Бот покажет его в ответе об адресе."
            >
              {(props) => (
                <Input
                  {...props}
                  type="tel"
                  value={settings.phone}
                  maxLength={30}
                  onChange={(e) => set("phone")(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Режим работы"
              error={fieldError("workingHours")}
              hint="Например: пн–сб с 08:00 до 19:00, вс — выходной"
            >
              {(props) => (
                <Input
                  {...props}
                  value={settings.workingHours}
                  maxLength={120}
                  onChange={(e) => set("workingHours")(e.target.value)}
                />
              )}
            </Field>
          </div>
        </Panel>
        <Panel title="Для пациентов">
          <div className="flex flex-col gap-4">
            <Field
              label="Описание клиники и услуг"
              error={fieldError("about")}
              hint="Коротко — бот использует текст для ответов о клинике."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={settings.about}
                  maxLength={1000}
                  onChange={(e) => set("about")(e.target.value)}
                />
              )}
            </Field>
            <Field label="Как добраться" error={fieldError("route")}>
              {(props) => (
                <Textarea
                  {...props}
                  value={settings.route}
                  maxLength={500}
                  onChange={(e) => set("route")(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Памятка к визиту"
              hint="Каждый пункт — с новой строки, до 10 пунктов. Без медицинских рекомендаций."
              error={
                Object.entries(errors).find(([k]) =>
                  k.startsWith("settings.visitTips"),
                )?.[1]
              }
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={tips}
                  rows={5}
                  onChange={(e) => setTips(e.target.value)}
                />
              )}
            </Field>
          </div>
        </Panel>
      </div>

      <Panel
        title="Услуги и цены"
        className="mt-6"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setServices((list) => [
                ...list,
                { title: "", specialtyId: "", priceRub: "0" },
              ])
            }
            disabled={services.length >= 50}
          >
            Добавить услугу
          </Button>
        }
      >
        <p className="text-small text-muted mb-4">
          Цены демонстрационные. Стоимость приёма конкретного врача задаётся в
          разделе «Врачи».
        </p>
        {services.length === 0 ? (
          <p className="text-small text-muted">Услуг нет.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {services.map((s, index) => {
              const err = (k: string) => errors[`services.${index}.${k}`];
              const update = (patch: Partial<ServiceRow>) =>
                setServices((list) =>
                  list.map((row, i) =>
                    i === index ? { ...row, ...patch } : row,
                  ),
                );
              return (
                <li
                  key={index}
                  className="border-border grid gap-3 border-t pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[2fr_1.2fr_0.8fr_auto] sm:items-end"
                >
                  <Field label="Услуга" error={err("title")}>
                    {(props) => (
                      <Input
                        {...props}
                        value={s.title}
                        maxLength={100}
                        onChange={(e) => update({ title: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Специальность">
                    {(props) => (
                      <Select
                        {...props}
                        value={s.specialtyId}
                        onChange={(e) =>
                          update({ specialtyId: e.target.value })
                        }
                      >
                        <option value="">Без специальности</option>
                        {data.specialties.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.title}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Цена, ₽" error={err("priceRub")}>
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        min={0}
                        step={50}
                        value={s.priceRub}
                        onChange={(e) => update({ priceRub: e.target.value })}
                      />
                    )}
                  </Field>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setServices((list) => list.filter((_, i) => i !== index))
                    }
                  >
                    Убрать
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <div className="mt-6 flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить настройки"}
        </Button>
      </div>
    </>
  );
}
