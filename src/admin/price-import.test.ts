import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdminApi, type AdminApiDeps } from "@/admin/api";
import { AdminAuth, type AuthConfig } from "@/admin/auth";
import { hashPassword } from "@/admin/password";
import {
  buildImportPlan,
  decodeCsv,
  detectDelimiter,
  parseCsv,
  parsePrice,
  PriceImportError,
  type ImportPlan,
} from "@/admin/price-import";
import { AdminService } from "@/admin/service";
import { SERVICES_MAX, type Service } from "@/bot/clinic/types";
import { SqliteStore } from "@/bot/storage/sqlite";

/**
 * Импорт прайса из CSV (P0-3): разбор файла, предпросмотр, применение после
 * подтверждения одной транзакцией, повторная загрузка, ошибки по строкам.
 * Услуги и цены — вымышленные.
 */

const NOW = new Date("2026-10-19T06:00:00Z");
const HOST = "clinic.example";
const ORIGIN = `https://${HOST}`;
const PASSWORD = "надёжный-пароль-2026";
const config: AuthConfig = { secureCookie: true, allowedOrigins: [] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  while (cleanups.length) cleanups.pop()!();
});

const utf8 = (text: string) => new TextEncoder().encode(text);

/** Кодировщик Windows-1251 для русских букв — как сохраняет CSV Excel в Windows. */
function cp1251(text: string): Uint8Array {
  return Uint8Array.from([...text], (ch) => {
    const code = ch.charCodeAt(0);
    if (code < 0x80) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    if (ch === "ё") return 0xb8;
    if (ch === "Ё") return 0xa8;
    throw new Error(`нет в тесте: ${ch}`);
  });
}

const SPECIALTIES = [
  ["therapist", "Терапевт"],
  ["dentist", "Стоматолог"],
  ["pediatrician", "Педиатр"],
  ["ent", "Оториноларинголог (ЛОР)"],
  ["orthopedist", "Травматолог-ортопед"],
] as const;

/** n вымышленных услуг: названия с запятыми и кавычками, специальность — названием. */
function bigPrice(n: number, delimiter: ";" | "," = ",") {
  const q = (v: string) => (/[;,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = Array.from({ length: n }, (_, i) => {
    const [, title] = SPECIALTIES[i % SPECIALTIES.length];
    return [
      "",
      q(
        `Исследование «Вариант ${i + 1}», ${i % 2 ? "повторное" : "первичное"}`,
      ),
      q(title),
      String(500 + i * 10),
    ].join(delimiter);
  });
  return [
    ["id", "Услуга", "Специальность", "Цена, ₽"].join(delimiter),
    ...rows,
  ].join("\r\n");
}

async function setup(path = ":memory:") {
  const store = new SqliteStore(path);
  cleanups.push(() => store.close());
  const hash = await hashPassword(PASSWORD);
  store.admin.createUser("owner", hash, NOW.toISOString(), "owner");
  store.admin.createUser("admin", hash, NOW.toISOString(), "admin");
  const service = new AdminService(store, () => NOW);
  const deps: AdminApiDeps = {
    service,
    auth: new AdminAuth(store.admin, () => NOW),
    config,
    clientKey: () => "client-1",
  };
  const raw = async (
    method: string,
    path: string,
    body?: BodyInit,
    headers: Record<string, string> = {},
  ) => {
    const url = new URL(`${ORIGIN}/api/admin/${path}`);
    return handleAdminApi(
      new Request(url, {
        method,
        headers: {
          host: HOST,
          ...(method !== "GET" ? { origin: ORIGIN } : {}),
          ...headers,
        },
        body,
      }),
      url.pathname.replace("/api/admin/", "").split("/").filter(Boolean),
      deps,
    );
  };
  const login = async (login: string) => {
    const r = await raw(
      "POST",
      "login",
      JSON.stringify({ login, password: PASSWORD }),
      { "content-type": "application/json" },
    );
    return r.headers.get("set-cookie")!.split(";")[0];
  };
  const owner = await login("owner");
  const csv = async (
    method: "POST" | "PUT",
    body: string | Uint8Array,
    token = "",
    cookie = owner,
  ) => {
    const r = await raw(
      method,
      `price-import${token ? `?token=${token}` : ""}`,
      new Blob([typeof body === "string" ? utf8(body) : new Uint8Array(body)]),
      { "content-type": "text/csv", cookie },
    );
    return {
      status: r.status,
      json: (await r.json()) as {
        ok: boolean;
        data?: ImportPlan & { counts: ImportPlan["counts"] };
        error?: string;
      },
    };
  };
  const preview = async (body: string | Uint8Array) => {
    const r = await csv("POST", body);
    expect(r.status, r.json.error).toBe(200);
    return r.json.data!;
  };
  const services = () => store.clinic.listServices();
  return { store, service, raw, owner, login, csv, preview, services };
}

describe("CSV: разбор файла", () => {
  it("кавычки, удвоенные кавычки, разделитель и перевод строки внутри поля", () => {
    const text =
      'Услуга;Цена\r\n"Приём ""ЛОР""; повторный";1500\n"Две\nстроки";10\nПросто;20';
    expect(parseCsv(text, ";")).toEqual([
      { line: 1, cells: ["Услуга", "Цена"] },
      { line: 2, cells: ['Приём "ЛОР"; повторный', "1500"] },
      { line: 3, cells: ["Две\nстроки", "10"] },
      { line: 5, cells: ["Просто", "20"] },
    ]);
  });

  it("разделитель — по заголовку; запятые в кавычках не считаются", () => {
    expect(detectDelimiter("Услуга;Специальность;Цена\nа,б;в;1")).toBe(";");
    expect(detectDelimiter('Услуга,Цена\n"а;б",1')).toBe(",");
    expect(detectDelimiter('"Услуга, название";Цена')).toBe(";");
  });

  it("незакрытая кавычка — ошибка файла с номером строки", () => {
    expect(() => parseCsv('Услуга;Цена\nА;1\n"Б;2\nВ;3', ";")).toThrow(
      /Строка 3: кавычка не закрыта/,
    );
  });

  it("UTF-8 с BOM и без; файл Excel в Windows-1251", () => {
    expect(decodeCsv(utf8("﻿Услуга;Цена"))).toEqual({
      text: "Услуга;Цена",
      encoding: "utf-8",
    });
    expect(decodeCsv(cp1251("Услуга;Цена\nЁжик;1"))).toEqual({
      text: "Услуга;Цена\nЁжик;1",
      encoding: "windows-1251",
    });
    expect(() => decodeCsv(new Uint8Array())).toThrow(PriceImportError);
  });

  it("цены: пробелы, ₽ и «руб.», нулевые копейки; остальное — не цена", () => {
    expect(parsePrice("2 000")).toBe(2000);
    expect(parsePrice("2 000 ₽")).toBe(2000);
    expect(parsePrice("1500 руб.")).toBe(1500);
    expect(parsePrice("1500,00")).toBe(1500);
    expect(parsePrice("1500.0")).toBe(1500);
    expect(parsePrice("0")).toBe(0);
    for (const bad of ["", "-5", "100,50", "абв", "1e3", "12.345", "1 5 0х"])
      expect(parsePrice(bad), bad).toBeUndefined();
  });
});

describe("импорт прайса: 300+ услуг", () => {
  it("350 новых услуг → применение → повторная загрузка ничего не меняет", async () => {
    const t = await setup();
    const before = t.services();
    const file = bigPrice(350);

    const plan = await t.preview(file);
    expect(plan.counts).toEqual({ new: 350, update: 0, skip: 0, error: 0 });
    expect(plan.delimiter).toBe(",");
    expect(plan.totalAfter).toBe(before.length + 350);
    // Предпросмотр ничего не меняет.
    expect(t.services()).toEqual(before);

    const applied = await t.csv("PUT", file, plan.token);
    expect(applied.status, applied.json.error).toBe(200);
    const after = t.services();
    expect(after).toHaveLength(before.length + 350);
    // Прежние услуги и их номера на месте; новые — в конце списка.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toMatchObject({
      title: "Исследование «Вариант 350», повторное",
      specialtyId: "orthopedist",
      priceRub: 500 + 349 * 10,
    });

    // Тот же файл ещё раз: дубликатов нет, все строки — без изменений.
    const again = await t.preview(file);
    expect(again.counts).toEqual({ new: 0, update: 0, skip: 350, error: 0 });
    const reapplied = await t.csv("PUT", file, again.token);
    expect(reapplied.status).toBe(200);
    expect(t.services()).toEqual(after);
  });

  it("шаблон с текущими услугами: правка цен и названий по id, отсутствующие строки не удаляются", async () => {
    const t = await setup();
    await t.csv(
      "PUT",
      bigPrice(320, ";"),
      (await t.preview(bigPrice(320, ";"))).token,
    );
    const before = t.services();
    expect(before.length).toBeGreaterThan(320);

    const template = await t.raw("GET", "price-template", undefined, {
      cookie: t.owner,
    });
    expect(template.status).toBe(200);
    expect(template.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    const bytes = new Uint8Array(await template.arrayBuffer());
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith("﻿id;Услуга;Специальность;Цена, ₽\r\n")).toBe(true);
    // Шаблон загружается обратно без изменений.
    expect((await t.preview(bytes)).counts).toEqual({
      new: 0,
      update: 0,
      skip: before.length,
      error: 0,
    });

    // Администратор меняет две цены, одно название и убирает из файла половину строк.
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    const [header, ...rows] = lines;
    const edited = rows
      .filter((_, i) => i % 2 === 0)
      .map((row, i) => {
        const cells = row.split(";");
        if (i === 0) cells[3] = "9 999";
        if (i === 1) cells[3] = "1000,00";
        if (i === 2) cells[1] = "Приём терапевта (первичный)";
        return cells.join(";");
      });
    const file = [header, ...edited].join("\n");
    const plan = await t.preview(file);
    expect(plan.counts.error).toBe(0);
    expect(plan.counts.new).toBe(0);
    const updates = plan.rows.filter((r) => r.status === "update");
    expect(updates.map((r) => r.id)).toEqual(
      [before[0], before[2], before[4]]
        .filter((s, i) => (i === 1 ? s.priceRub !== 1000 : true))
        .map((s) => s.id),
    );
    expect(updates[0]).toMatchObject({
      line: 2,
      priceRub: 9999,
      before: { priceRub: before[0].priceRub },
    });

    expect((await t.csv("PUT", file, plan.token)).status).toBe(200);
    const after = t.services();
    // Ни одна услуга не удалена, номера и порядок те же.
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(after[0].priceRub).toBe(9999);
    expect(after[4].title).toBe("Приём терапевта (первичный)");
    expect(after[1]).toEqual(before[1]);
  });

  it("без id — по названию и специальности, без учёта регистра, ё и пробелов", async () => {
    const t = await setup();
    const therapist = t.services().find((s) => s.specialtyId === "therapist")!;
    const title = therapist.title.toUpperCase().replace(/е/gi, "ё");
    const plan = await t.preview(
      `Услуга;Специальность;Цена\n"  ${title} ";therapist;${therapist.priceRub + 1}\n` +
        `${therapist.title};Стоматолог;100`,
    );
    expect(plan.rows).toMatchObject([
      { line: 2, status: "update", id: therapist.id },
      // То же название у другой специальности — другая услуга.
      { line: 3, status: "new", specialtyId: "dentist" },
    ]);
  });

  it("Windows-1251 и запятая как разделитель", async () => {
    const t = await setup();
    const plan = await t.preview(
      cp1251(
        'Наименование,Направление,Стоимость\n"Осмотр, повторный",Педиатр,1200\n',
      ),
    );
    expect(plan.encoding).toBe("windows-1251");
    expect(plan.rows).toMatchObject([
      {
        status: "new",
        title: "Осмотр, повторный",
        specialtyId: "pediatrician",
        priceRub: 1200,
      },
    ]);
  });
});

describe("импорт прайса: ошибки и дубликаты", () => {
  it("каждая ошибка — с номером строки и причиной; импорт с ошибками не применяется", async () => {
    const t = await setup();
    const existing = t.services()[0];
    const before = t.services();
    const file = [
      "id;Услуга;Специальность;Цена",
      ";Новая услуга;;1000",
      ";;Терапевт;1000",
      ";Без цены;Терапевт;",
      ";Плохая цена;Терапевт;абв",
      ";С копейками;Терапевт;100,50",
      ";Отрицательная;Терапевт;-5",
      ";Слишком дорогая;Терапевт;2000000",
      ";Кардио;Кардиолог;1000",
      "999999;Чужой id;;1000",
      "abc;Кривой id;;1000",
      ";Новая услуга;;1500",
      `${existing.id};Та же услуга;;100`,
      `${existing.id};Та же услуга снова;;200`,
      ";Лишние;;1;2",
      `;${"Д".repeat(101)};;1`,
      ";Я;;1",
      ';"Перевод\nстроки";;1',
      "",
      ";;;",
    ].join("\n");
    const plan = await t.preview(file);
    const errors = plan.rows
      .filter((r) => r.status === "error")
      .map((r) => [r.line, r.reason]);
    expect(errors).toEqual([
      [3, "не указано название услуги"],
      [4, "не указана цена"],
      [5, "цена «абв» — нужно целое число рублей"],
      [6, "цена «100,50» — нужно целое число рублей"],
      [7, "цена «-5» — нужно целое число рублей"],
      [8, "слишком большая цена"],
      [9, "неизвестная специальность «Кардиолог»"],
      [
        10,
        "услуги с id 999999 нет в справочнике — уберите id, чтобы добавить новую",
      ],
      [
        11,
        "услуги с id abc нет в справочнике — уберите id, чтобы добавить новую",
      ],
      [12, "повторяет строку 2 (то же название и специальность)"],
      [14, "повторяет строку 13 (та же услуга)"],
      [
        15,
        "больше значений, чем столбцов в заголовке — проверьте разделитель и кавычки",
      ],
      [16, "название услуги — от 2 до 100 символов"],
      [17, "название услуги — от 2 до 100 символов"],
      [18, "перевод строки в названии услуги"],
    ]);
    expect(plan.counts).toEqual({ new: 1, update: 1, skip: 0, error: 15 });

    // Применение файла с ошибками — отказ, база не изменилась.
    const r = await t.csv("PUT", file, plan.token);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/В файле есть ошибки/);
    expect(t.services()).toEqual(before);
  });

  it("переименование в название другой услуги и неоднозначное название — ошибки", async () => {
    const t = await setup();
    const [a, b] = t.services();
    const ambiguous = t.service.updateSettings(
      {
        settings: t.service.getSettings().settings,
        services: [
          ...t.services(),
          { title: a.title, specialtyId: a.specialtyId, priceRub: 1 },
        ],
      },
      1,
    );
    expect(ambiguous.services).toHaveLength(t.services().length);
    const plan = await t.preview(
      `id;Услуга;Специальность;Цена\n${b.id};${a.title};${a.specialtyId};1\n;${a.title};${a.specialtyId};5`,
    );
    expect(plan.rows.map((r) => r.reason)).toEqual([
      `такая услуга уже есть в справочнике (id ${a.id})`,
      expect.stringMatching(/^в справочнике несколько услуг .* — укажите id/),
    ]);
  });

  it("файл без нужных столбцов, пустой, без услуг — ошибка файла", async () => {
    const t = await setup();
    for (const [file, message] of [
      ["Название;Сумма\nА;1", /нужны столбцы «Услуга» и «Цена»/],
      ["", /Файл пустой/],
      ["Услуга;Цена\n;;\n", /В файле нет услуг/],
      ["\n\n", /нет строки заголовка/],
    ] as const) {
      const r = await t.csv("POST", file);
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(message);
    }
  });

  it("лимит справочника: больше SERVICES_MAX после импорта — отказ", async () => {
    const t = await setup();
    const r = await t.csv("POST", bigPrice(SERVICES_MAX));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/будет \d+ услуг — не больше 1000/);
    const tooMany = await t.csv("POST", bigPrice(SERVICES_MAX + 1));
    expect(tooMany.json.error).toMatch(/не больше 1000 за один раз/);
  });
});

describe("импорт прайса: подтверждение и атомарность", () => {
  it("без токена предпросмотра или после изменения справочника — 409 без изменений", async () => {
    const t = await setup();
    const file = bigPrice(5);
    const plan = await t.preview(file);
    expect((await t.csv("PUT", file)).status).toBe(409);
    expect((await t.csv("PUT", file, "0".repeat(32))).status).toBe(409);
    // Другой файл с токеном первого.
    expect((await t.csv("PUT", bigPrice(6), plan.token)).status).toBe(409);

    const settings = t.service.getSettings();
    t.service.updateSettings(
      {
        settings: settings.settings,
        services: [
          { ...settings.services[0], priceRub: 1 },
          ...settings.services.slice(1),
        ],
      },
      1,
    );
    const before = t.services();
    const r = await t.csv("PUT", file, plan.token);
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/изменились после предпросмотра/);
    expect(t.services()).toEqual(before);
  });

  it("сбой посреди применения — откат: ни обновлений, ни новых услуг", async () => {
    const dir = mkdtempSync(join(tmpdir(), "price-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "bot.sqlite");
    const t = await setup(path);
    const before = t.services();
    // Сбой базы на последней вставке — после всех обновлений и части вставок.
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER fail_import BEFORE INSERT ON services WHEN NEW.title = 'Сбой' BEGIN SELECT RAISE(ABORT, 'test'); END;",
    );
    db.close();
    const file = [
      "id;Услуга;Специальность;Цена",
      ...before.slice(0, 3).map((s) => `${s.id};${s.title};${s.specialtyId};7`),
      ";Новая 1;;100",
      ";Новая 2;;100",
      ";Сбой;;100",
    ].join("\n");
    const plan = await t.preview(file);
    expect(plan.counts).toEqual({ new: 3, update: 3, skip: 0, error: 0 });
    const r = await t.csv("PUT", file, plan.token);
    expect(r.status).toBe(500);
    expect(t.services()).toEqual(before);
  });

  it("права и формат: только владелец, только CSV со своего сайта, не больше 1 МБ", async () => {
    const t = await setup();
    const admin = await t.login("admin");
    expect((await t.csv("POST", bigPrice(1), "", admin)).status).toBe(403);
    expect((await t.csv("PUT", bigPrice(1), "x", admin)).status).toBe(403);
    expect(
      (await t.raw("GET", "price-template", undefined, { cookie: admin }))
        .status,
    ).toBe(403);
    expect((await t.raw("GET", "price-template")).status).toBe(401);
    expect((await t.csv("POST", bigPrice(1), "", "")).status).toBe(401);

    const json = await t.raw("POST", "price-import", "{}", {
      "content-type": "application/json",
      cookie: t.owner,
    });
    expect(json.status).toBe(415);
    const foreign = await t.raw("POST", "price-import", bigPrice(1), {
      "content-type": "text/csv",
      cookie: t.owner,
      origin: "https://evil.example",
    });
    expect(foreign.status).toBe(403);
    const big = await t.csv("POST", new Uint8Array(1024 * 1024 + 1).fill(65));
    expect(big.status).toBe(413);
  });
});

describe("настройки клиники: сотни услуг", () => {
  it("сохранение формы сохраняет номера услуг; убранные — удаляются, новые — добавляются", async () => {
    const t = await setup();
    await t.csv("PUT", bigPrice(700), (await t.preview(bigPrice(700))).token);
    const before = t.services();
    expect(before.length).toBeGreaterThan(700);

    // Как форма панели: весь список с id, через API (тело больше 64 КБ).
    const settings = t.service.getSettings();
    const services: Service[] = [
      { ...before[1], priceRub: 4321 },
      ...before.slice(2),
      { title: "Новая из формы", specialtyId: "", priceRub: 10 },
    ];
    const body = JSON.stringify({ settings: settings.settings, services });
    expect(body.length).toBeGreaterThan(64 * 1024);
    const r = await t.raw("PUT", "settings", body, {
      "content-type": "application/json",
      cookie: t.owner,
    });
    expect(r.status).toBe(200);
    const after = t.services();
    expect(after.map((s) => s.id)).toEqual([
      ...before.slice(1).map((s) => s.id),
      expect.any(Number),
    ]);
    expect(after[0]).toEqual({ ...before[1], priceRub: 4321 });
    expect(after.some((s) => s.id === before[0].id)).toBe(false);
    expect(after.at(-1)!.id).toBeGreaterThan(
      Math.max(...before.map((s) => s.id!)),
    );
  });

  it("повтор id в форме и больше SERVICES_MAX — ошибка проверки", async () => {
    const t = await setup();
    const settings = t.service.getSettings();
    const s = settings.services[0];
    expect(() =>
      t.service.updateSettings(
        { settings: settings.settings, services: [s, s] },
        1,
      ),
    ).toThrow(/повторяется/);
    expect(() =>
      t.service.updateSettings(
        {
          settings: settings.settings,
          services: Array.from({ length: SERVICES_MAX + 1 }, (_, i) => ({
            title: `Услуга ${i}`,
            specialtyId: "",
            priceRub: 1,
          })),
        },
        1,
      ),
    ).toThrow(/Не больше 1000 услуг/);
  });
});

describe("план импорта без базы", () => {
  it("одинаковые файл и справочник — одинаковый отпечаток; иначе другой", () => {
    const current: Service[] = [
      { id: 1, title: "Приём", specialtyId: "", priceRub: 100 },
    ];
    const file = utf8("Услуга;Цена\nПриём;200");
    const a = buildImportPlan(file, current, []);
    expect(buildImportPlan(file, current, []).token).toBe(a.token);
    expect(
      buildImportPlan(file, [{ ...current[0], priceRub: 150 }], []).token,
    ).not.toBe(a.token);
    expect(
      buildImportPlan(utf8("Услуга;Цена\nПриём;300"), current, []).token,
    ).not.toBe(a.token);
  });
});
