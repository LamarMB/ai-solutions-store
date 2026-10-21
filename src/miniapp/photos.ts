import type { PhotoStore } from "@/bot/storage/photo-store";

/**
 * Ответ с фото врача. Адрес с версией (`?v=` — начало SHA-256) кэшируется
 * надолго; без версии — проверяется каждый раз. nosniff и sandbox-CSP: файл
 * никогда не исполняется как страница или скрипт.
 */
export function photoResponse(
  request: Request,
  store: PhotoStore,
  doctorId: string,
): Response {
  const photo = /^[a-z0-9_-]{1,40}$/i.test(doctorId)
    ? store.read(doctorId)
    : undefined;
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (!photo)
    return new Response("Not found", {
      status: 404,
      headers: { ...headers, "Cache-Control": "no-store" },
    });
  const etag = `"${photo.sha256.slice(0, 32)}"`;
  const version = new URL(request.url).searchParams.get("v");
  headers["ETag"] = etag;
  headers["Cache-Control"] =
    version && photo.sha256.startsWith(version)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate";
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(photo.data), {
    status: 200,
    headers: { ...headers, "Content-Type": photo.type },
  });
}
