import { createHash } from "node:crypto";
import { SERVICES_MAX, type Service, type Specialty } from "@/bot/clinic/types";

/**
 * Импорт прайса клиники из CSV в справочник услуг. Два шага: предпросмотр
 * (план без изменений в базе) и применение того же плана после подтверждения
 * администратора — одной транзакцией. Услуги, которых нет в файле, остаются.
 *
 * Сопоставление: столбец `id` (номер услуги из шаблона панели) — та же
 * услуга; без `id` — по названию и специальности (без учёта регистра, ё/е и
 * лишних пробелов). Повторная загрузка того же файла ничего не меняет.
 */

/** Размер файла прайса. */
export const PRICE_CSV_MAX_BYTES = 1024 * 1024;
const PRICE_MAX = 1_000_000;

export type ImportStatus = "new" | "update" | "skip" | "error";

export type ImportRow = {
  /** Номер строки в файле (заголовок — строка 1). */
  line: number;
  status: ImportStatus;
  /** Причина ошибки или пропуска. */
  reason?: string;
  /** Номер услуги в справочнике — для обновлений и пропусков. */
  id?: number;
  title: string;
  specialtyId: string;
  priceRub?: number;
  /** Прежние значения обновляемой услуги. */
  before?: { title: string; specialtyId: string; priceRub: number };
};

export type ImportPlan = {
  encoding: "utf-8" | "windows-1251";
  delimiter: ";" | ",";
  rows: ImportRow[];
  counts: Record<ImportStatus, number>;
  /** Услуг в справочнике после импорта. */
  totalAfter: number;
  /**
   * Отпечаток плана и текущего справочника: применяется только тот план,
   * который видел администратор, и только если справочник не менялся.
   */
  token: string;
};

/** Ошибка файла целиком (кодировка, заголовок, кавычки, размер). */
export class PriceImportError extends Error {}

// --- Чтение файла ------------------------------------------------------------

/**
 * UTF-8 (с BOM или без). Если файл не в UTF-8 — Windows-1251: так сохраняет
 * CSV Excel в русской Windows. Кодировка показывается в предпросмотре.
 */
export function decodeCsv(bytes: Uint8Array): {
  text: string;
  encoding: ImportPlan["encoding"];
} {
  if (bytes.length === 0) throw new PriceImportError("Файл пустой.");
  if (bytes.length > PRICE_CSV_MAX_BYTES)
    throw new PriceImportError("Файл слишком большой: не больше 1 МБ.");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return {
      text: new TextDecoder("windows-1251").decode(bytes),
      encoding: "windows-1251",
    };
  }
}

/** Разделитель — по строке заголовка: «;» (Excel в России) или «,». */
export function detectDelimiter(text: string): ";" | "," {
  let semicolons = 0;
  let commas = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch === ";") semicolons++;
    else if (!quoted && ch === ",") commas++;
  }
  return semicolons >= commas && semicolons > 0 ? ";" : commas > 0 ? "," : ";";
}

export type CsvRecord = { line: number; cells: string[] };

/**
 * Разбор CSV по RFC 4180: поля в кавычках могут содержать разделитель,
 * перевод строки и кавычки (удвоенные). `line` — строка файла, где запись
 * начинается. Незакрытая кавычка — ошибка с номером строки.
 */
export function parseCsv(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let quoteLine = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      quoteLine = line;
      cell = "";
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      records.push({ line: start, cells });
      cells = [];
      cell = "";
      line++;
      start = line;
    } else cell += ch;
  }
  if (quoted)
    throw new PriceImportError(
      `Строка ${quoteLine}: кавычка не закрыта — проверьте кавычки в названии.`,
    );
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    records.push({ line: start, cells });
  }
  return records;
}

// --- Значения ----------------------------------------------------------------

/** Ключ сопоставления: регистр, ё/е и пробелы не важны. */
const norm = (value: string) =>
  value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const serviceKey = (title: string, specialtyId: string) =>
  `${norm(title)}|${specialtyId}`;

/** Ячейки, которые Excel принял бы за формулу, выгружаются с апострофом. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cleanTitle(raw: string): string {
  const title = raw.replace(/\s+/g, " ").trim();
  return title.startsWith("'") && FORMULA_START.test(title.slice(1))
    ? title.slice(1)
    : title;
}

/** «2 000», «2000,00», «2000 ₽», «2000 руб.» → 2000. undefined — не цена. */
export function parsePrice(raw: string): number | undefined {
  const value = raw.replace(/[\s  ]/g, "").replace(/(₽|руб\.?|р\.?)$/i, "");
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match || (match[2] && Number(match[2]) !== 0)) return undefined;
  return Number(match[1]);
}

const COLUMNS = {
  id: ["id"],
  title: [
    "услуга",
    "название",
    "наименование",
    "название услуги",
    "наименование услуги",
  ],
  specialty: ["специальность", "направление"],
  price: ["цена", "стоимость"],
} as const;
type Column = keyof typeof COLUMNS;

/** «Цена, ₽» → «цена»: единицы после запятой или в скобках не важны. */
const headerName = (value: string) =>
  norm(value.replace(/^﻿/, "").split(/[,(]/)[0]);

function readHeader(cells: string[]): Partial<Record<Column, number>> {
  const map: Partial<Record<Column, number>> = {};
  cells.forEach((cell, index) => {
    const name = headerName(cell);
    for (const column of Object.keys(COLUMNS) as Column[]) {
      if (
        map[column] === undefined &&
        (COLUMNS[column] as readonly string[]).includes(name)
      )
        map[column] = index;
    }
  });
  return map;
}

// --- План импорта ------------------------------------------------------------

/**
 * План импорта: что будет добавлено, обновлено, пропущено и какие строки с
 * ошибками. База не меняется. Ошибка файла целиком — PriceImportError.
 */
export function buildImportPlan(
  bytes: Uint8Array,
  current: readonly Service[],
  specialties: readonly Specialty[],
): ImportPlan {
  const { text, encoding } = decodeCsv(bytes);
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  const headerRecord = records.find((r) => r.cells.some((c) => c.trim()));
  if (!headerRecord)
    throw new PriceImportError("В файле нет строки заголовка и услуг.");
  const header = readHeader(headerRecord.cells);
  if (header.title === undefined || header.price === undefined)
    throw new PriceImportError(
      `Строка ${headerRecord.line}: нужны столбцы «Услуга» и «Цена» (шаблон можно скачать в панели). ` +
        `Разделитель определён как «${delimiter}».`,
    );
  const data = records
    .slice(records.indexOf(headerRecord) + 1)
    .filter((r) => r.cells.some((c) => c.trim()));
  if (data.length === 0) throw new PriceImportError("В файле нет услуг.");
  if (data.length > SERVICES_MAX)
    throw new PriceImportError(
      `В файле ${data.length} строк — не больше ${SERVICES_MAX} за один раз.`,
    );

  const byId = new Map(current.map((s) => [s.id!, s]));
  const byKey = new Map<string, Service[]>();
  for (const s of current) {
    const key = serviceKey(s.title, s.specialtyId);
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }
  const specialtyOf = (raw: string): string | undefined => {
    const value = norm(raw);
    if (!value) return "";
    return specialties.find(
      (s) => s.id === raw.trim() || norm(s.title) === value,
    )?.id;
  };
  const width = headerRecord.cells.length;
  const cell = (r: CsvRecord, column: Column) =>
    header[column] === undefined ? "" : (r.cells[header[column]!] ?? "");

  const rows: ImportRow[] = [];
  /** Строка файла, где уже встретилась услуга (по id и по итоговому ключу). */
  const seenId = new Map<number, number>();
  const seenKey = new Map<string, number>();

  for (const record of data) {
    const title = cleanTitle(cell(record, "title"));
    const rawSpecialty = cell(record, "specialty").trim();
    const rawId = cell(record, "id").trim();
    const base = { line: record.line, title, specialtyId: "" };
    const fail = (reason: string) =>
      rows.push({ ...base, status: "error", reason });

    if (record.cells.slice(width).some((c) => c.trim())) {
      fail(
        "больше значений, чем столбцов в заголовке — проверьте разделитель и кавычки",
      );
      continue;
    }
    if (/[\r\n]/.test(cell(record, "title"))) {
      fail("перевод строки в названии услуги");
      continue;
    }
    if (title.length < 2 || title.length > 100) {
      fail(
        title
          ? "название услуги — от 2 до 100 символов"
          : "не указано название услуги",
      );
      continue;
    }
    const specialtyId = specialtyOf(rawSpecialty);
    if (specialtyId === undefined) {
      fail(`неизвестная специальность «${rawSpecialty.slice(0, 60)}»`);
      continue;
    }
    base.specialtyId = specialtyId;
    const rawPrice = cell(record, "price").trim();
    const priceRub = parsePrice(rawPrice);
    if (priceRub === undefined || priceRub > PRICE_MAX) {
      fail(
        !rawPrice
          ? "не указана цена"
          : priceRub === undefined
            ? `цена «${rawPrice.slice(0, 20)}» — нужно целое число рублей`
            : "слишком большая цена",
      );
      continue;
    }

    let target: Service | undefined;
    if (rawId) {
      const id = Number(rawId);
      target = Number.isSafeInteger(id) && id > 0 ? byId.get(id) : undefined;
      if (!target) {
        fail(
          `услуги с id ${rawId.slice(0, 12)} нет в справочнике — уберите id, чтобы добавить новую`,
        );
        continue;
      }
    } else {
      const found = byKey.get(serviceKey(title, specialtyId)) ?? [];
      if (found.length > 1) {
        fail(
          `в справочнике несколько услуг «${title}» — укажите id (id: ${found.map((s) => s.id).join(", ")})`,
        );
        continue;
      }
      target = found[0];
    }

    if (target && seenId.has(target.id!)) {
      fail(`повторяет строку ${seenId.get(target.id!)} (та же услуга)`);
      continue;
    }
    const key = serviceKey(title, specialtyId);
    if (seenKey.has(key)) {
      fail(
        `повторяет строку ${seenKey.get(key)} (то же название и специальность)`,
      );
      continue;
    }
    // Новое название не должно совпасть с другой услугой, которой нет в файле.
    const clash = (byKey.get(key) ?? []).find((s) => s.id !== target?.id);
    if (target && clash) {
      fail(`такая услуга уже есть в справочнике (id ${clash.id})`);
      continue;
    }
    if (target) seenId.set(target.id!, record.line);
    seenKey.set(key, record.line);

    if (!target) {
      rows.push({ ...base, status: "new", priceRub });
      continue;
    }
    const before = {
      title: target.title,
      specialtyId: target.specialtyId,
      priceRub: target.priceRub,
    };
    const same =
      before.title === title &&
      before.specialtyId === specialtyId &&
      before.priceRub === priceRub;
    rows.push({
      ...base,
      id: target.id,
      priceRub,
      ...(same
        ? { status: "skip", reason: "без изменений" }
        : { status: "update", before }),
    });
  }

  const counts: Record<ImportStatus, number> = {
    new: 0,
    update: 0,
    skip: 0,
    error: 0,
  };
  for (const row of rows) counts[row.status]++;
  const totalAfter = current.length + counts.new;
  if (counts.error === 0 && totalAfter > SERVICES_MAX)
    throw new PriceImportError(
      `После импорта в справочнике будет ${totalAfter} услуг — не больше ${SERVICES_MAX}.`,
    );
  const token = createHash("sha256")
    .update(
      JSON.stringify([
        current.map((s) => [s.id, s.title, s.specialtyId, s.priceRub]),
        rows.map((r) => [r.status, r.id, r.title, r.specialtyId, r.priceRub]),
      ]),
    )
    .digest("hex")
    .slice(0, 32);
  return { encoding, delimiter, rows, counts, totalAfter, token };
}

// --- Шаблон ------------------------------------------------------------------

const csvCell = (value: string) => {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[;"\r\n,]/.test(safe) || safe !== safe.trim()
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
};

/**
 * Шаблон прайса: заголовок и текущие услуги с id. UTF-8 с BOM и «;» —
 * Excel в России открывает такой файл без перекодировки.
 */
export function priceTemplateCsv(
  services: readonly Service[],
  specialties: readonly Specialty[],
): string {
  const title = (id: string) =>
    specialties.find((s) => s.id === id)?.title ?? id;
  const lines = [
    ["id", "Услуга", "Специальность", "Цена, ₽"].join(";"),
    ...services.map((s) =>
      [
        String(s.id ?? ""),
        csvCell(s.title),
        csvCell(s.specialtyId ? title(s.specialtyId) : ""),
        String(s.priceRub),
      ].join(";"),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
