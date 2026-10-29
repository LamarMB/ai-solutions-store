"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ImportPlan, ImportRow } from "@/admin/price-import";
import type { Service, Specialty } from "@/bot/clinic/types";
import type { ClinicSettings } from "@/bot/storage/clinic-store";
import { ApiError } from "@/components/admin/client";
import { ErrorNote, Panel, useToast } from "@/components/admin/ui";
import { Button, buttonClasses } from "@/components/ui/Button";

/** Строк каждого вида в предпросмотре; полный список — по кнопке. */
const PREVIEW_ROWS = 20;

/** Файл прайса уходит на сервер как есть: разбор и проверки — там. */
async function send<T>(method: "POST" | "PUT", path: string, file: Blob) {
  let response: Response;
  try {
    response = await fetch(`/api/admin/${path}`, {
      method,
      headers: { "Content-Type": "text/csv" },
      body: file,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Нет связи с сервером. Проверьте подключение.", 0);
  }
  const json = (await response.json().catch(() => null)) as {
    ok: boolean;
    data?: T;
    error?: string;
  } | null;
  if (response.status === 401)
    window.location.assign(new URL("/admin/login", window.location.origin));
  if (!json?.ok)
    throw new ApiError(
      json?.error ?? "Не удалось обработать файл.",
      response.status,
    );
  return json.data as T;
}

const rub = (value: number) =>
  `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;

/**
 * Импорт прайса из CSV: шаблон, предпросмотр (новые, обновления, без
 * изменений, ошибки по строкам) и применение после подтверждения. Услуги,
 * которых нет в файле, не удаляются.
 */
export function PriceImport({
  specialties,
  dirty,
  onImported,
}: {
  specialties: Specialty[];
  /** На странице есть несохранённые изменения услуг — они будут потеряны. */
  dirty: boolean;
  /** Справочник после импорта — из ответа сервера. */
  onImported: (next: {
    settings: ClinicSettings;
    services: Service[];
    specialties: Specialty[];
  }) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [plan, setPlan] = useState<ImportPlan>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const specialty = (id: string) =>
    id
      ? (specialties.find((s) => s.id === id)?.title ?? id)
      : "без специальности";

  function reset() {
    setFile(undefined);
    setPlan(undefined);
    setShowAll(false);
    if (input.current) input.current.value = "";
  }

  async function preview(selected: File) {
    reset();
    setError(undefined);
    setBusy(true);
    try {
      setPlan(await send<ImportPlan>("POST", "price-import", selected));
      setFile(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!file || !plan) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await send<Parameters<typeof onImported>[0]>(
        "PUT",
        `price-import?token=${encodeURIComponent(plan.token)}`,
        file,
      );
      toast(
        `Прайс загружен: новых услуг — ${plan.counts.new}, обновлено — ${plan.counts.update}.`,
      );
      reset();
      onImported(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось применить импорт.");
    } finally {
      setBusy(false);
    }
  }

  const changes = plan ? plan.counts.new + plan.counts.update : 0;
  const group = (status: ImportRow["status"]) =>
    plan?.rows.filter((r) => r.status === status) ?? [];

  return (
    <Panel title="Загрузка прайса из CSV" className="mt-6">
      <div className="text-small text-muted mb-4 flex flex-col gap-2">
        <p>
          Столбцы: <b>id</b> (номер услуги из шаблона, для новых — пусто),{" "}
          <b>Услуга</b>, <b>Специальность</b> (название или пусто),{" "}
          <b>Цена, ₽</b> (целое число). Разделитель «;» или «,», кодировка UTF-8
          (файл Excel в Windows-1251 тоже читается).
        </p>
        <p>
          Услуги с id и услуги с тем же названием и специальностью обновляются,
          остальные добавляются. Услуги, которых нет в файле, остаются — убрать
          их можно в списке выше. Повторная загрузка того же файла ничего не
          меняет.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/api/admin/price-template"
          download="price.csv"
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          Скачать шаблон с текущими услугами
        </a>
        <label className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {busy && !plan ? "Проверяю…" : "Выбрать файл CSV"}
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) void preview(selected);
            }}
          />
        </label>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      {plan && (
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-small">
            Файл «{file?.name}»: кодировка {plan.encoding.toUpperCase()},
            разделитель «{plan.delimiter}».
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Новые", plan.counts.new],
                ["Обновления", plan.counts.update],
                ["Без изменений", plan.counts.skip],
                ["Ошибки", plan.counts.error],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="border-border rounded-field border px-3 py-2"
              >
                <dt className="text-caption text-muted">{label}</dt>
                <dd
                  className={
                    label === "Ошибки" && value > 0
                      ? "text-danger text-h3 font-semibold"
                      : "text-h3 font-semibold"
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {group("error").length > 0 && (
            <RowList
              title="Ошибки — исправьте файл и загрузите снова"
              rows={group("error")}
              all={showAll}
              render={(r) => (
                <>
                  <b>Строка {r.line}</b>
                  {r.title ? ` («${r.title}»)` : ""}: {r.reason}
                </>
              )}
            />
          )}
          {group("new").length > 0 && (
            <RowList
              title="Будут добавлены"
              rows={group("new")}
              all={showAll}
              render={(r) => (
                <>
                  {r.title} — {specialty(r.specialtyId)} — {rub(r.priceRub!)}
                </>
              )}
            />
          )}
          {group("update").length > 0 && (
            <RowList
              title="Будут обновлены"
              rows={group("update")}
              all={showAll}
              render={(r) => (
                <>
                  id {r.id}: {r.title}
                  {r.before!.title !== r.title &&
                    ` (было «${r.before!.title}»)`}
                  {" — "}
                  {r.before!.specialtyId !== r.specialtyId &&
                    `${specialty(r.before!.specialtyId)} → `}
                  {specialty(r.specialtyId)}
                  {" — "}
                  {r.before!.priceRub !== r.priceRub &&
                    `${rub(r.before!.priceRub)} → `}
                  {rub(r.priceRub!)}
                </>
              )}
            />
          )}
          {!showAll &&
            (["error", "new", "update"] as const).some(
              (s) => group(s).length > PREVIEW_ROWS,
            ) && (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => setShowAll(true)}
              >
                Показать все строки
              </Button>
            )}

          {dirty && changes > 0 && (
            <p className="text-small text-danger">
              На странице есть несохранённые изменения услуг — после импорта
              список загрузится заново, и они пропадут. Сначала сохраните
              настройки.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={apply}
              disabled={busy || plan.counts.error > 0 || changes === 0}
            >
              {busy
                ? "Применяю…"
                : `Применить: добавить ${plan.counts.new}, обновить ${plan.counts.update}`}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Отменить
            </Button>
            {plan.counts.error === 0 && changes === 0 && (
              <span className="text-small text-muted">
                Изменений нет — прайс уже совпадает с файлом.
              </span>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function RowList({
  title,
  rows,
  all,
  render,
}: {
  title: string;
  rows: ImportRow[];
  all: boolean;
  render: (row: ImportRow) => ReactNode;
}) {
  const shown = all ? rows : rows.slice(0, PREVIEW_ROWS);
  return (
    <div>
      <h3 className="text-small mb-2 font-semibold">
        {title} ({rows.length})
      </h3>
      <ul className="text-small flex max-h-80 flex-col gap-1 overflow-y-auto">
        {shown.map((r) => (
          <li key={r.line}>{render(r)}</li>
        ))}
        {shown.length < rows.length && (
          <li className="text-muted">…и ещё {rows.length - shown.length}</li>
        )}
      </ul>
    </div>
  );
}
