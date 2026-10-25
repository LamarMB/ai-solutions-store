"use client";

import { useState } from "react";
import type { RequestMeta } from "@/bot/storage/request-store";
import { api, ApiError, useResource } from "@/components/admin/client";
import { formatMoment } from "@/components/admin/format";
import {
  EmptyState,
  ErrorNote,
  Loading,
  Modal,
  PageHeader,
  Panel,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type RequestsData = { enabled: boolean; requests: RequestMeta[] };
type Opened = RequestMeta & { kind: string; text: string };

const CONSENT_LABELS: Record<RequestMeta["consent"], string> = {
  granted: "согласие действует",
  revoked: "согласие отозвано",
  expired: "срок истёк",
};

/**
 * Обращения пациентов: только текст, который пациент сам разрешил передать
 * (дословно). Переписка ВКонтакте здесь не показывается. Открытие текста и
 * отметка «обработано» пишутся в журнал доступа.
 */
export function Requests() {
  const toast = useToast();
  const { data, error, loading, reload } =
    useResource<RequestsData>("requests");
  const [opened, setOpened] = useState<Opened>();
  const [busy, setBusy] = useState<number>();

  async function open(id: number) {
    setBusy(id);
    try {
      setOpened(await api<Opened>(`requests/${id}/content`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось открыть.", "error");
      reload();
    } finally {
      setBusy(undefined);
    }
  }

  async function done(id: number) {
    setBusy(id);
    try {
      await api(`requests/${id}`, {
        method: "PATCH",
        body: { action: "done" },
      });
      toast(`Обращение №${id} отмечено обработанным.`);
      setOpened(undefined);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось.", "error");
    } finally {
      setBusy(undefined);
    }
  }

  const fresh = data?.requests.filter((r) => r.status === "new") ?? [];
  const handled = data?.requests.filter((r) => r.status === "done") ?? [];

  return (
    <>
      <PageHeader
        title="Обращения пациентов"
        description="Только текст, который пациент увидел и разрешил передать. Отвечайте пациенту в сообщениях сообщества ВКонтакте."
      />
      {data && !data.enabled && (
        <Panel className="mb-4">
          <p className="text-muted">
            Передача обращений выключена: на сервере не задан ключ шифрования
            (MEDICAL_DATA_KEY). Бот зовёт администратора без передачи текста.
          </p>
        </Panel>
      )}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data && data.requests.length === 0 ? (
        <EmptyState
          title="Обращений нет"
          text="Они появятся, когда пациент в боте разрешит передать текст администратору."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {[
            { title: `Новые · ${fresh.length}`, list: fresh },
            { title: `Обработанные · ${handled.length}`, list: handled },
          ].map(
            (group) =>
              group.list.length > 0 && (
                <Panel key={group.title} title={group.title}>
                  <ul className="divide-border flex flex-col divide-y">
                    {group.list.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div>
                          <p className="font-medium">
                            №{r.id} · {formatMoment(r.createdAt)}
                          </p>
                          <p className="text-small text-muted">
                            {r.patient} ·{" "}
                            <span
                              className={cn(
                                r.consent === "granted" ? "" : "text-danger",
                              )}
                            >
                              {CONSENT_LABELS[r.consent]}
                            </span>
                            {r.doneAt &&
                              ` · обработано ${formatMoment(r.doneAt)}${r.doneBy ? ` (${r.doneBy})` : ""}`}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {r.available && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy === r.id}
                              onClick={() => open(r.id)}
                            >
                              Открыть текст
                            </Button>
                          )}
                          {r.status === "new" && (
                            <Button
                              size="sm"
                              disabled={busy === r.id}
                              onClick={() => done(r.id)}
                            >
                              Обработано
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ),
          )}
        </div>
      )}
      <Modal
        open={opened !== undefined}
        title={opened ? `Обращение №${opened.id}` : ""}
        onClose={() => setOpened(undefined)}
      >
        {opened && (
          <div className="flex flex-col gap-4">
            <p className="text-small text-muted">
              {opened.kind}. {opened.patient}, {formatMoment(opened.createdAt)}.
            </p>
            <blockquote className="border-border bg-surface-2 rounded-field border px-4 py-3 whitespace-pre-wrap">
              {opened.text}
            </blockquote>
            <p className="text-caption text-muted">
              Открытие записано в журнал доступа. Пациент может отозвать
              согласие — тогда текст удаляется. Не копируйте текст в другие
              системы и чаты.
            </p>
            {opened.status === "new" && (
              <div className="flex justify-end">
                <Button
                  onClick={() => done(opened.id)}
                  disabled={busy === opened.id}
                >
                  Отметить обработанным
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
