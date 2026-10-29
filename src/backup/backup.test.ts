import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { loadBackupConfig, type BackupConfig, type Env } from "@/backup/config";
import { decryptBackup, encryptBackup, readHeader } from "@/backup/format";
import {
  listBackups,
  ownBackups,
  restoreBackup,
  runBackup,
} from "@/backup/run";
import { signV4, type BackupStorage } from "@/backup/storage";
import { SqliteStore } from "@/bot/storage/sqlite";

/**
 * Резервные копии (P0-8): снимок работающей базы, шифрование, внешнее
 * хранилище (каталог и S3-совместимое), проверка восстановлением, срок
 * хранения, восстановление в новый файл, изоляция клиник, ошибки хранилища и
 * отсутствие секретов в журнале. Данные вымышленные.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "backup-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const newKey = () => randomBytes(32).toString("base64");

/** База клиники в режиме WAL с n записями на приём. */
function clinicDb(root: string, id: string, bookings = 3) {
  mkdirSync(join(root, "data", id), { recursive: true });
  const path = join(root, "data", id, "bot.sqlite");
  const store = new SqliteStore(path);
  for (let i = 0; i < bookings; i++)
    store.admin.audit(null, "test", "booking", i, new Date().toISOString());
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA busy_timeout = 5000");
  for (let i = 0; i < bookings; i++)
    raw
      .prepare(
        "INSERT INTO bookings (peer_id, doctor_id, date, time, created_at, status, source) VALUES (?, 'testova', ?, '10:00', '2026-10-19T06:00:00Z', 'confirmed', 'vk')",
      )
      .run(1000 + i, `2026-11-${String(i + 1).padStart(2, "0")}`);
  raw.close();
  cleanups.push(() => store.close());
  return { path, store };
}

function backupEnv(root: string, id: string, over: Env = {}): Env {
  return {
    CLINIC_ID: id,
    BOT_DB_PATH: join(root, "data", id, "bot.sqlite"),
    BACKUP_KEY: newKey(),
    BACKUP_TARGET: `file://${join(root, "remote")}`,
    BACKUP_KEEP: "30",
    BACKUP_LOCAL_DIR: join(root, "local", id),
    ...over,
  };
}

function load(env: Env): BackupConfig {
  const r = loadBackupConfig(env);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.config;
}

const bookings = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare("SELECT peer_id, date FROM bookings ORDER BY id")
      .all() as { peer_id: number; date: string }[];
  } finally {
    db.close();
  }
};

/** Время запуска: разные дни — разные имена копий. */
const day = (n: number) => () => new Date(Date.UTC(2026, 9, 1 + n, 3, 0, 0));

describe("копия работающей базы и восстановление", () => {
  it("WAL и открытая транзакция: копия содержит подтверждённое и не содержит незавершённое; данные восстанавливаются", async () => {
    const root = tempDir();
    const { path } = clinicDb(root, "clinic-a", 3);
    // Подтверждённые, но ещё не перенесённые из WAL записи и незавершённая транзакция.
    const writer = new DatabaseSync(path);
    writer.exec("PRAGMA wal_autocheckpoint = 0");
    writer
      .prepare(
        "INSERT INTO bookings (peer_id, doctor_id, date, time, created_at, status, source) VALUES (2000, 'testova', '2026-12-01', '11:00', '2026-10-19T06:00:00Z', 'confirmed', 'vk')",
      )
      .run();
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
    writer.exec("BEGIN IMMEDIATE");
    writer
      .prepare(
        "INSERT INTO bookings (peer_id, doctor_id, date, time, created_at, status, source) VALUES (3000, 'testova', '2026-12-02', '11:00', '2026-10-19T06:00:00Z', 'confirmed', 'vk')",
      )
      .run();

    const config = load(backupEnv(root, "clinic-a"));
    const logs: string[] = [];
    const result = await runBackup(config, {
      now: day(0),
      log: (m) => logs.push(m),
    });
    writer.exec("COMMIT");
    writer.close();

    expect(result.summary.bookings).toBe(4);
    expect(result.name).toBe("demo-med-clinic-a-20261001T030000Z.dmbk");
    expect(logs.at(-1)).toMatch(/^готово: demo-med-clinic-a-/);
    // Во внешнем хранилище — только зашифрованное (нет заголовка SQLite).
    const remote = readFileSync(join(root, "remote", "clinic-a", result.name));
    expect(remote.subarray(0, 4).toString()).toBe("DMBK");
    expect(remote.includes(Buffer.from("SQLite format 3"))).toBe(false);
    // Временные файлы удалены, незашифрованного снимка нет.
    expect(readdirSync(config.stagingDir)).toEqual([]);

    const out = join(root, "restored.sqlite");
    const restored = await restoreBackup(config, { name: result.name }, out);
    expect(restored.summary.bookings).toBe(4);
    expect(bookings(out).map((b) => b.peer_id)).toEqual([
      1000, 1001, 1002, 2000,
    ]);
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it(
    "копия во время непрерывной записи другим процессом",
    { timeout: 30_000 },
    async () => {
      const root = tempDir();
      const { path } = clinicDb(root, "clinic-a", 1);
      const child = spawn(
        process.execPath,
        [
          "-e",
          `const { DatabaseSync } = require("node:sqlite");
         const db = new DatabaseSync(${JSON.stringify(path)});
         db.exec("PRAGMA busy_timeout = 5000");
         const insert = db.prepare("INSERT INTO admin_audit (at, user_id, action, entity, entity_id) VALUES (?, NULL, 'w', 'x', NULL)");
         const end = Date.now() + 1500;
         let n = 0;
         while (Date.now() < end) { insert.run(new Date().toISOString()); n++; }
         console.log(n);`,
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      let written = "";
      child.stdout.on("data", (d) => (written += d));
      const done = new Promise((r) => child.on("exit", r));
      await new Promise((r) => setTimeout(r, 200));
      const config = load(backupEnv(root, "clinic-a"));
      const result = await runBackup(config, { now: day(0) });
      await done;
      expect(Number(written)).toBeGreaterThan(0);
      const out = join(root, "restored.sqlite");
      const { summary } = await restoreBackup(
        config,
        { name: result.name },
        out,
      );
      expect(summary.bookings).toBe(1);
    },
  );
});

describe("шифрование: неверный ключ, повреждения, другая клиника", () => {
  const key = Buffer.from(newKey(), "base64");
  const data = Buffer.from("SQLite format 3\0 — вымышленные данные");
  const file = encryptBackup(data, key, {
    clinic: "clinic-a",
    createdAt: "2026-10-01T03:00:00.000Z",
    schema: 8,
  });

  it("расшифровывается своим ключом и проверяет контрольную сумму", () => {
    expect(decryptBackup(file, key, "clinic-a").database.equals(data)).toBe(
      true,
    );
    expect(readHeader(file).header).toMatchObject({
      clinic: "clinic-a",
      schema: 8,
    });
  });

  it.each([
    [
      "неверный ключ",
      () => decryptBackup(file, randomBytes(32), "clinic-a"),
      /неверный BACKUP_KEY или копия повреждена/,
    ],
    [
      "изменён байт шифротекста",
      () => {
        const bad = Buffer.from(file);
        bad[bad.length - 5] ^= 0xff;
        return decryptBackup(bad, key, "clinic-a");
      },
      /неверный BACKUP_KEY или копия повреждена/,
    ],
    [
      "изменён заголовок",
      () => {
        const bad = Buffer.from(
          file.toString("latin1").replace('"schema":8', '"schema":9'),
          "latin1",
        );
        return decryptBackup(bad, key, "clinic-a");
      },
      /неверный BACKUP_KEY или копия повреждена/,
    ],
    [
      "обрезанный файл",
      () => decryptBackup(file.subarray(0, 40), key, "clinic-a"),
      /повреждена или обрезана|не читается/,
    ],
    [
      "не копия",
      () => decryptBackup(Buffer.from("hello"), key, "clinic-a"),
      /не резервная копия/,
    ],
    [
      "копия другой клиники",
      () => decryptBackup(file, key, "clinic-b"),
      /копия другой клиники/,
    ],
  ] as const)("%s — ошибка без данных", (_name, fn, message) => {
    expect(fn).toThrow(message);
  });

  it("одинаковый мастер-ключ у двух клиник всё равно даёт разные ключи шифрования", () => {
    const forged = Buffer.from(
      file
        .toString("latin1")
        .replace('"clinic":"clinic-a"', '"clinic":"clinic-b"'),
      "latin1",
    );
    expect(() => decryptBackup(forged, key, "clinic-b")).toThrow(
      /неверный BACKUP_KEY или копия повреждена/,
    );
  });
});

describe("сбои: нет частичных копий, старые не удаляются", () => {
  /** Хранилище в памяти с внедряемыми ошибками. */
  function memoryStorage(
    fail: Partial<Record<"put" | "get" | "list", boolean>> = {},
  ) {
    const objects = new Map<string, Buffer>();
    const storage: BackupStorage = {
      label: "память",
      put: async (n, d) => {
        if (fail.put)
          throw Object.assign(new Error("connect ECONNRESET 10.0.0.1"), {
            code: "ECONNRESET",
          });
        objects.set(n, Buffer.from(d));
      },
      get: async (n) => {
        if (fail.get) {
          const d = Buffer.from(objects.get(n)!);
          d[d.length - 1] ^= 1;
          return d;
        }
        return objects.get(n)!;
      },
      list: async () => {
        if (fail.list)
          throw Object.assign(new Error("list failed"), {
            code: "EHOSTUNREACH",
          });
        return [...objects.keys()];
      },
      delete: async (n) => void objects.delete(n),
    };
    return { storage, objects, fail };
  }

  it("ошибка отправки: копии во внешнем хранилище нет, временных файлов нет, прежние копии целы, статус — ошибка", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a");
    const mem = memoryStorage();
    const config = {
      ...load(backupEnv(root, "clinic-a", { BACKUP_KEEP: "1" })),
      storage: mem.storage,
    };
    await runBackup(config, { now: day(0) });
    const first = [...mem.objects.keys()];
    mem.fail.put = true;
    const logs: string[] = [];
    await expect(
      runBackup(config, { now: day(1), log: (m) => logs.push(m) }),
    ).rejects.toThrow(/^отправка: ECONNRESET$/);
    expect([...mem.objects.keys()]).toEqual(first);
    expect(readdirSync(config.stagingDir)).toEqual([]);
    expect(
      readdirSync(config.localDir!).some((n) => n.includes("partial")),
    ).toBe(false);
    expect(JSON.parse(readFileSync(config.statusPath, "utf8"))).toMatchObject({
      ok: false,
      error: "отправка: ECONNRESET",
    });
    expect(logs.at(-1)).toBe("ошибка: отправка: ECONNRESET");
  });

  it("копия в хранилище испорчена — проверка восстановлением не проходит, старые копии не удаляются", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a");
    const mem = memoryStorage();
    const config = {
      ...load(backupEnv(root, "clinic-a", { BACKUP_KEEP: "1" })),
      storage: mem.storage,
    };
    await runBackup(config, { now: day(0) });
    mem.fail.get = true;
    await expect(runBackup(config, { now: day(1) })).rejects.toThrow(
      /^проверка восстановления: копия в хранилище отличается от отправленной$/,
    );
    // Старая копия на месте: удаление — только после успешной проверки новой.
    expect(ownBackups("clinic-a", [...mem.objects.keys()])).toContain(
      "demo-med-clinic-a-20261001T030000Z.dmbk",
    );
    expect(readdirSync(config.stagingDir)).toEqual([]);
  });

  it("список хранилища недоступен — копия создана, удаление старых пропущено с предупреждением", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a");
    const mem = memoryStorage({ list: true });
    const config = {
      ...load(backupEnv(root, "clinic-a", { BACKUP_KEEP: "1" })),
      storage: mem.storage,
    };
    await runBackup(config, { now: day(0) });
    const r = await runBackup(config, { now: day(1) });
    expect(r.pruned).toBe(0);
    expect(r.warnings).toEqual([
      "удаление старых копий пропущено: EHOSTUNREACH",
    ]);
    expect(mem.objects.size).toBe(2);
  });

  it("остатки прерванного запуска и устаревшая блокировка убираются следующим запуском", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a");
    const config = load(backupEnv(root, "clinic-a"));
    mkdirSync(config.stagingDir, { recursive: true });
    writeFileSync(join(config.stagingDir, "snapshot.sqlite"), "остаток");
    writeFileSync(join(config.stagingDir, "verify.sqlite.partial"), "остаток");
    writeFileSync(join(config.stagingDir, "backup.lock"), "999999999");
    await runBackup(config, { now: day(0) });
    expect(readdirSync(config.stagingDir)).toEqual([]);
  });

  it("срок хранения: остаются N новых, чужие файлы не трогаются; BACKUP_KEEP=0 — ничего не удаляется", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a");
    const remote = join(root, "remote", "clinic-a");
    mkdirSync(remote, { recursive: true });
    writeFileSync(join(remote, "notes.txt"), "заметка владельца");
    const config = load(
      backupEnv(root, "clinic-a", { BACKUP_KEEP: "2", BACKUP_LOCAL_KEEP: "1" }),
    );
    for (let i = 0; i < 4; i++) await runBackup(config, { now: day(i) });
    expect(readdirSync(remote).sort()).toEqual([
      "demo-med-clinic-a-20261003T030000Z.dmbk",
      "demo-med-clinic-a-20261004T030000Z.dmbk",
      "notes.txt",
    ]);
    expect(readdirSync(config.localDir!)).toEqual([
      "demo-med-clinic-a-20261004T030000Z.dmbk",
    ]);
    const forever = load({
      ...backupEnv(root, "clinic-a"),
      BACKUP_KEY: config.key.toString("base64"),
      BACKUP_KEEP: "0",
    });
    await runBackup(forever, { now: day(5) });
    expect(ownBackups("clinic-a", readdirSync(remote))).toHaveLength(3);
  });
});

describe("восстановление: рабочая база не перезаписывается", () => {
  it("отказ для рабочей базы, её журналов и существующего файла", async () => {
    const root = tempDir();
    const { path } = clinicDb(root, "clinic-a");
    const config = load(backupEnv(root, "clinic-a"));
    const { name } = await runBackup(config, { now: day(0) });
    const before = readFileSync(path);
    for (const target of [path, `${path}-wal`]) {
      await expect(restoreBackup(config, { name }, target)).rejects.toThrow(
        /поверх рабочей базы запрещено/,
      );
    }
    expect(readFileSync(path).equals(before)).toBe(true);
    const existing = join(root, "existing.sqlite");
    writeFileSync(existing, "важный файл");
    await expect(restoreBackup(config, { name }, existing)).rejects.toThrow(
      /перезапись запрещена/,
    );
    expect(readFileSync(existing, "utf8")).toBe("важный файл");
    // Восстановление из локального файла копии.
    const out = join(root, "from-local.sqlite");
    const r = await restoreBackup(
      config,
      { file: join(config.localDir!, name) },
      out,
    );
    expect(r.summary.bookings).toBe(3);
  });
});

describe("изоляция двух клиник", () => {
  it("свои каталоги в хранилище, свои ключи; копия одной клиники не читается и не восстанавливается другой", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a", 2);
    clinicDb(root, "clinic-b", 5);
    const a = load(backupEnv(root, "clinic-a", { BACKUP_KEEP: "1" }));
    const b = load(backupEnv(root, "clinic-b", { BACKUP_KEEP: "1" }));
    const ra = await runBackup(a, { now: day(0) });
    await runBackup(b, { now: day(0) });
    await runBackup(b, { now: day(1) });
    // Удаление старых копий B не трогает копию A в том же хранилище.
    expect(await listBackups(a)).toEqual([ra.name]);
    expect(await listBackups(b)).toEqual([
      "demo-med-clinic-b-20261002T030000Z.dmbk",
    ]);
    expect(readdirSync(join(root, "remote")).sort()).toEqual([
      "clinic-a",
      "clinic-b",
    ]);

    const fileA = readFileSync(join(root, "remote", "clinic-a", ra.name));
    expect(() => decryptBackup(fileA, b.key, "clinic-a")).toThrow(
      /неверный BACKUP_KEY/,
    );
    await expect(
      restoreBackup(
        b,
        { file: join(root, "remote", "clinic-a", ra.name) },
        join(root, "x.sqlite"),
      ),
    ).rejects.toThrow(/копия другой клиники/);
    expect(existsSync(join(root, "x.sqlite"))).toBe(false);
  });
});

// --- S3-совместимое хранилище ---------------------------------------------

type Mode = { put403?: boolean; put500Once?: boolean; corruptGet?: boolean };

/** Минимальный S3 (PUT/GET/DELETE/ListObjectsV2) с проверкой подписи по составу заголовков. */
async function mockS3(mode: Mode = {}) {
  const objects = new Map<string, Buffer>();
  const seen: string[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
    const auth = String(req.headers.authorization ?? "");
    const hash = createHash("sha256").update(body).digest("hex");
    if (
      !/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/ru-central1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(
        auth,
      ) ||
      req.headers["x-amz-content-sha256"] !== hash
    ) {
      res
        .writeHead(403)
        .end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
      return;
    }
    const url = new URL(req.url!, "http://x");
    const key = decodeURIComponent(url.pathname).replace(/^\/bucket\//, "");
    if (req.method === "PUT") {
      if (mode.put403) {
        res
          .writeHead(403)
          .end(
            "<Error><Code>AccessDenied</Code><Message>secret-hint</Message></Error>",
          );
        return;
      }
      if (mode.put500Once) {
        mode.put500Once = false;
        res.writeHead(500).end("<Error><Code>InternalError</Code></Error>");
        return;
      }
      objects.set(key, body);
      res.writeHead(200).end();
    } else if (
      req.method === "GET" &&
      url.searchParams.get("list-type") === "2"
    ) {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      res
        .writeHead(200)
        .end(
          `<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`,
        );
    } else if (req.method === "GET") {
      const data = objects.get(key);
      if (!data) {
        res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
        return;
      }
      const out = Buffer.from(data);
      if (mode.corruptGet) out[out.length - 1] ^= 1;
      res.writeHead(200).end(out);
    } else if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  return { objects, seen, endpoint: `http://127.0.0.1:${port}` };
}

const S3_SECRET = "s3-secret-value-for-tests-only-1234567890";
const s3Env = (root: string, id: string, endpoint: string, over: Env = {}) =>
  backupEnv(root, id, {
    BACKUP_TARGET: "s3://bucket/demo-med",
    BACKUP_S3_ENDPOINT: endpoint,
    BACKUP_S3_REGION: "ru-central1",
    BACKUP_S3_ACCESS_KEY_ID: "AKIDTEST",
    BACKUP_S3_SECRET_ACCESS_KEY: S3_SECRET,
    BACKUP_LOCAL_DIR: "",
    ...over,
  });

describe("S3-совместимое хранилище", () => {
  it("подпись AWS Signature V4 совпадает с примерами из документации AWS", () => {
    const empty =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(
      signV4({
        method: "GET",
        url: new URL(
          "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
        ),
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          host: "iam.amazonaws.com",
          "x-amz-date": "20150830T123600Z",
        },
        payloadHash: empty,
        region: "us-east-1",
        service: "iam",
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        amzDate: "20150830T123600Z",
      }),
    ).toMatch(
      /Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7$/,
    );
    expect(
      signV4({
        method: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        headers: {
          host: "examplebucket.s3.amazonaws.com",
          range: "bytes=0-9",
          "x-amz-content-sha256": empty,
          "x-amz-date": "20130524T000000Z",
        },
        payloadHash: empty,
        region: "us-east-1",
        service: "s3",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        amzDate: "20130524T000000Z",
      }),
    ).toMatch(
      /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/,
    );
  });

  it("копия, проверка, список, срок хранения и восстановление через S3; повтор после 500", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a", 4);
    const s3 = await mockS3({ put500Once: true });
    const config = load(
      s3Env(root, "clinic-a", s3.endpoint, { BACKUP_KEEP: "2" }),
    );
    for (let i = 0; i < 3; i++) await runBackup(config, { now: day(i) });
    expect([...s3.objects.keys()].sort()).toEqual([
      "demo-med/clinic-a/demo-med-clinic-a-20261002T030000Z.dmbk",
      "demo-med/clinic-a/demo-med-clinic-a-20261003T030000Z.dmbk",
    ]);
    const out = join(root, "restored.sqlite");
    const r = await restoreBackup(
      config,
      { name: "demo-med-clinic-a-20261003T030000Z.dmbk" },
      out,
    );
    expect(r.summary.bookings).toBe(4);
  });

  it("ошибки хранилища: понятная причина, без ключей, подписи и тела ответа", async () => {
    const root = tempDir();
    clinicDb(root, "clinic-a");
    const env = s3Env(root, "clinic-a", "", {});
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);

    const denied = await mockS3({ put403: true });
    const c1 = load({ ...env, BACKUP_S3_ENDPOINT: denied.endpoint });
    await expect(runBackup(c1, { now: day(0), log })).rejects.toThrow(
      "отправка: хранилище (S3 127.0.0.1:" +
        denied.endpoint.split(":")[2] +
        "/bucket/demo-med/clinic-a): PUT — HTTP 403 AccessDenied — доступ запрещён — проверьте ключи и права на бакет",
    );

    const corrupt = await mockS3({ corruptGet: true });
    const c2 = load({ ...env, BACKUP_S3_ENDPOINT: corrupt.endpoint });
    await expect(runBackup(c2, { now: day(1), log })).rejects.toThrow(
      /проверка восстановления: копия в хранилище отличается/,
    );

    const c3 = load({
      ...env,
      BACKUP_S3_ENDPOINT: "http://127.0.0.1:9",
    });
    await expect(runBackup(c3, { now: day(2), log })).rejects.toThrow(
      /отправка: хранилище .*: PUT — нет связи/,
    );

    const all = logs.join("\n") + readFileSync(c1.statusPath, "utf8");
    for (const secret of [
      env.BACKUP_KEY!,
      S3_SECRET,
      "Signature=",
      "secret-hint",
      "AKIDTEST",
    ])
      expect(all).not.toContain(secret);
  });
});

describe("настройки и шаблоны", () => {
  it("ошибки настроек — по имени переменной; тот же диск — предупреждение", () => {
    const root = tempDir();
    const bad = loadBackupConfig({
      CLINIC_ID: "clinic-a",
      BOT_DB_PATH: join(root, "data/clinic-a/bot.sqlite"),
      BACKUP_KEY: "короткий",
      BACKUP_TARGET: "ftp://host",
      BACKUP_KEEP: "-1",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.errors.map((e) => e.split(":")[0])).toEqual([
        "BACKUP_KEY",
        "BACKUP_KEEP",
        "BACKUP_TARGET",
      ]);
    const key = newKey();
    const same = loadBackupConfig({
      ...backupEnv(root, "clinic-a"),
      BACKUP_KEY: key,
      MEDICAL_DATA_KEY: key,
    });
    expect(same.ok).toBe(false);
    const s3 = loadBackupConfig({
      ...backupEnv(root, "clinic-a"),
      BACKUP_TARGET: "s3://bucket/x",
      BACKUP_S3_ENDPOINT: "http://storage.example",
      BACKUP_S3_REGION: "r",
      BACKUP_S3_ACCESS_KEY_ID: "a",
      BACKUP_S3_SECRET_ACCESS_KEY: "b",
    });
    expect(s3.ok).toBe(false);
    if (!s3.ok)
      expect(s3.errors).toEqual(["BACKUP_S3_ENDPOINT: нужен адрес https://"]);

    mkdirSync(join(root, "data/clinic-a"), { recursive: true });
    mkdirSync(join(root, "remote"), { recursive: true });
    const local = loadBackupConfig(backupEnv(root, "clinic-a"));
    expect(local.ok && local.warnings[0]).toMatch(/на том же диске/);
  });

  it("сервис копирования: пользователь клиники, только настройки копий, запись только в свои каталоги; таймер — ежедневно", () => {
    const unit = readFileSync(
      join(ROOT, "deploy/systemd/demo-med-backup@.service"),
      "utf8",
    );
    for (const line of [
      "User=dm-%i",
      "Environment=CLINIC_ID=%i",
      "Environment=BOT_DB_PATH=/var/lib/demo-med/%i/bot.sqlite",
      "EnvironmentFile=/etc/demo-med/backup/%i.env",
      "ReadWritePaths=/var/lib/demo-med/%i /var/backups/demo-med/%i",
      "ProtectSystem=strict",
      "UMask=0077",
      "SyslogIdentifier=demo-med-%i-backup",
    ])
      expect(unit).toContain(line);
    // Секреты бота и панели задача копирования не получает.
    expect(unit).not.toContain("/etc/demo-med/clinics/");
    const timer = readFileSync(
      join(ROOT, "deploy/systemd/demo-med-backup@.timer"),
      "utf8",
    );
    expect(timer).toMatch(/^OnCalendar=\*-\*-\* 03:00:00$/m);
    expect(timer).toContain("Persistent=true");
    const template = parseEnv(
      readFileSync(join(ROOT, "deploy/clinic/backup.env.example"), "utf8"),
    ) as Env;
    expect(template.BACKUP_KEY).toBe("");
    expect(template.BACKUP_S3_SECRET_ACCESS_KEY).toBe("");
  });

  it(
    "init и check: ключ генерируется и не печатается; повтор ключа другой клиники и MEDICAL_DATA_KEY — ошибки",
    { timeout: 60_000 },
    () => {
      const root = tempDir();
      const conf = join(root, "backup");
      mkdirSync(conf);
      const run = (args: string[], env: Env = {}) => {
        const r = spawnSync(
          process.execPath,
          [
            join(ROOT, "node_modules/tsx/dist/cli.mjs"),
            "scripts/clinic-backup.mts",
            ...args,
          ],
          {
            cwd: ROOT,
            encoding: "utf8",
            env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
          },
        );
        return { code: r.status, out: `${r.stdout}${r.stderr}` };
      };
      const fileA = join(conf, "clinic-a.env");
      const init = run(["init", "--id=clinic-a", `--out=${fileA}`]);
      expect(init.code).toBe(0);
      expect(statSync(fileA).mode & 0o777).toBe(0o600);
      const a = parseEnv(readFileSync(fileA, "utf8")) as Env;
      expect(Buffer.from(a.BACKUP_KEY!, "base64")).toHaveLength(32);
      expect(a.BACKUP_LOCAL_DIR).toBe("/var/backups/demo-med/clinic-a");
      expect(init.out).not.toContain(a.BACKUP_KEY);
      expect(run(["init", "--id=clinic-a", `--out=${fileA}`]).code).toBe(1);

      const target = { BACKUP_TARGET: `file://${join(root, "remote")}` };
      writeFileSync(
        fileA,
        `${readFileSync(fileA, "utf8")}\nBACKUP_TARGET=${target.BACKUP_TARGET}\n`,
      );
      const fileB = join(conf, "clinic-b.env");
      writeFileSync(
        fileB,
        `BACKUP_KEY=${a.BACKUP_KEY}\nBACKUP_TARGET=${target.BACKUP_TARGET}\n`,
        { mode: 0o600 },
      );
      const clinicEnv = join(root, "clinic-a.clinic.env");
      writeFileSync(clinicEnv, `MEDICAL_DATA_KEY=${a.BACKUP_KEY}\n`);
      const env = {
        CLINIC_ID: "clinic-a",
        BOT_DB_PATH: join(root, "data/clinic-a/bot.sqlite"),
      };
      const check = run(
        [
          "check",
          `--env=${fileA}`,
          `--clinic-env=${clinicEnv}`,
          `--others=${conf}`,
        ],
        env,
      );
      expect(check.code).toBe(1);
      expect(check.out).toContain(
        "FAIL BACKUP_KEY: должен отличаться от MEDICAL_DATA_KEY",
      );
      expect(check.out).toContain(
        "FAIL BACKUP_KEY: совпадает с ключом клиники «clinic-b»",
      );
      expect(check.out).not.toContain(a.BACKUP_KEY);
    },
  );
});
