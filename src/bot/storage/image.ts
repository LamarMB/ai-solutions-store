/**
 * Проверка изображений по содержимому, а не по имени или заголовку запроса:
 * только JPEG, PNG и WebP (без анимации), разумные размеры. SVG, GIF, HTML и
 * прочее отклоняются — их нельзя безопасно отдавать как фото.
 */
export const PHOTO_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Не больше 2 МБ: панель сама уменьшает фото до 800×800 перед загрузкой. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_MIN_SIDE = 120;
export const PHOTO_MAX_SIDE = 4000;

export type ImageInfo = { type: PhotoType; width: number; height: number };

const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.subarray(at, at + len));

function jpegSize(
  b: Uint8Array,
): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0–SOF15, кроме DHT (C4), JPG (C8), DAC (CC).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return {
        height: (b[i + 5] << 8) | b[i + 6],
        width: (b[i + 7] << 8) | b[i + 8],
      };
    i += 2 + len;
  }
  return undefined;
}

function webpSize(
  b: Uint8Array,
): { width: number; height: number; animated: boolean } | undefined {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 " && b.length >= 30)
    return {
      width: ((b[27] << 8) | b[26]) & 0x3fff,
      height: ((b[29] << 8) | b[28]) & 0x3fff,
      animated: false,
    };
  if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      animated: false,
    };
  }
  if (chunk === "VP8X" && b.length >= 30)
    return {
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      animated: (b[20] & 0x02) !== 0,
    };
  return undefined;
}

export type ImageProblem = "type" | "size" | "dimensions" | "animated";

export function inspectImage(
  bytes: Uint8Array,
): { ok: true; info: ImageInfo } | { ok: false; problem: ImageProblem } {
  if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES)
    return { ok: false, problem: "size" };
  let info: ImageInfo | undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const s = jpegSize(bytes);
    if (s) info = { type: "image/jpeg", ...s };
  } else if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    ascii(bytes, 12, 4) === "IHDR"
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    info = {
      type: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const s = webpSize(bytes);
    if (s?.animated) return { ok: false, problem: "animated" };
    if (s) info = { type: "image/webp", width: s.width, height: s.height };
  }
  if (!info) return { ok: false, problem: "type" };
  const { width, height } = info;
  if (
    Math.min(width, height) < PHOTO_MIN_SIDE ||
    Math.max(width, height) > PHOTO_MAX_SIDE
  )
    return { ok: false, problem: "dimensions" };
  return { ok: true, info };
}
