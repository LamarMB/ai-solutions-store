"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/components/admin/client";
import {
  ConfirmDialog,
  DangerButton,
  ErrorNote,
  Modal,
  useToast,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/Button";

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
/** Исходный файл до обработки (фото с телефона бывают крупными). */
const SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const SIDE = 800;

/**
 * Готовит фото в браузере: квадрат по центру (чуть выше середины — там лицо),
 * 800×800, WebP (или JPEG, если браузер не умеет WebP). Перекодирование
 * убирает метаданные EXIF (геопозиция, устройство). Сервер всё равно
 * проверяет тип и размер по содержимому.
 */
async function prepare(file: File): Promise<Blob> {
  if (!ACCEPT.includes(file.type))
    throw new Error("Нужна фотография JPEG, PNG или WebP.");
  if (file.size > SOURCE_MAX_BYTES)
    throw new Error("Файл слишком большой: не больше 15 МБ.");
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  }).catch(() => {
    throw new Error("Не удалось прочитать изображение.");
  });
  const side = Math.min(bitmap.width, bitmap.height);
  if (side < 120) throw new Error("Фото слишком маленькое: нужно от 120 px.");
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) * 0.25;
  const out = Math.min(SIDE, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не может обработать изображение.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality),
    );
  const webp = await encode("image/webp", 0.86);
  const blob =
    webp?.type === "image/webp" ? webp : await encode("image/jpeg", 0.88);
  if (!blob) throw new Error("Не удалось подготовить изображение.");
  return blob;
}

export function DoctorPhotoDialog({
  doctor,
  onClose,
  onSaved,
}: {
  doctor?: {
    id: string;
    name: string;
    photoUrl: string | null;
    photoSource: "demo_ai" | "upload" | null;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [blob, setBlob] = useState<Blob>();
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function pick(file: File | undefined) {
    setError(undefined);
    if (!file) return;
    try {
      const prepared = await prepare(file);
      setBlob(prepared);
      setPreview(URL.createObjectURL(prepared));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обработать фото.");
    }
  }

  async function upload() {
    if (!doctor || !blob) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/admin/doctors/${encodeURIComponent(doctor.id)}/photo`,
        {
          method: "PUT",
          headers: { "Content-Type": blob.type },
          body: blob,
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const json = (await response.json().catch(() => null)) as {
        ok: boolean;
        error?: string;
      } | null;
      if (response.status === 401)
        window.location.assign(new URL("/admin/login", window.location.origin));
      if (!json?.ok)
        throw new ApiError(
          json?.error ?? "Не удалось загрузить фото.",
          response.status,
        );
      toast(`Фото врача «${doctor.name}» сохранено`);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить фото.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!doctor) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/doctors/${encodeURIComponent(doctor.id)}/photo`,
        { method: "DELETE", credentials: "same-origin", cache: "no-store" },
      );
      const json = (await response.json().catch(() => null)) as {
        ok: boolean;
        error?: string;
      } | null;
      if (!json?.ok) throw new Error(json?.error ?? "Не удалось удалить фото.");
      toast("Фото удалено — в приложении будет монограмма");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить фото.");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const shown = preview ?? doctor?.photoUrl ?? undefined;
  return (
    <Modal
      open={doctor !== undefined}
      title={doctor ? `Фото: ${doctor.name}` : ""}
      onClose={onClose}
    >
      {doctor && (
        <div className="flex flex-col gap-4">
          {error && <ErrorNote message={error} />}
          <div className="flex flex-wrap items-center gap-5">
            <div className="bg-surface-2 rounded-card flex size-28 shrink-0 items-center justify-center overflow-hidden sm:size-40">
              {shown ? (
                // Предпросмотр — локальный объект или фото с нашего сервера.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shown}
                  alt={`Фото: ${doctor.name}`}
                  className="size-full object-cover"
                />
              ) : (
                <span className="text-small text-muted px-4 text-center">
                  Фото нет — в приложении монограмма
                </span>
              )}
            </div>
            <div className="text-small text-muted flex min-w-0 flex-1 flex-col gap-1.5">
              <p>
                {preview
                  ? "Предпросмотр: так фото будет выглядеть в приложении."
                  : doctor.photoSource === "demo_ai"
                    ? "Демо-портрет, созданный ИИ (не реальный сотрудник)."
                    : doctor.photoUrl
                      ? "Загруженное фото."
                      : "Фото не загружено."}
              </p>
              <p>
                JPEG, PNG или WebP. Фото обрежется до квадрата и уменьшится до
                800×800. Загружайте только фото с согласия врача.
              </p>
            </div>
          </div>
          <label className="text-small inline-flex w-fit cursor-pointer flex-col gap-1.5">
            <span className="font-medium">
              {doctor.photoUrl ? "Заменить фото" : "Выбрать фото"}
            </span>
            <input
              type="file"
              accept={ACCEPT.join(",")}
              onChange={(e) => pick(e.target.files?.[0])}
              className="text-small file:bg-surface-2 file:text-ink file:rounded-control file:mr-3 file:border-0 file:px-4 file:py-2"
            />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {doctor.photoUrl ? (
              <DangerButton
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Удалить фото
              </DangerButton>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Отмена
              </Button>
              <Button onClick={upload} disabled={!blob || busy}>
                {busy ? "Сохраняю…" : "Сохранить фото"}
              </Button>
            </div>
          </div>
          <ConfirmDialog
            open={confirmDelete}
            title="Удалить фото?"
            text="В приложении вместо фото будет монограмма врача."
            confirmLabel="Удалить"
            onConfirm={remove}
            onClose={() => setConfirmDelete(false)}
            busy={busy}
          />
        </div>
      )}
    </Modal>
  );
}
