import { createHash, createHmac } from "node:crypto";
import {
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Внешнее хранилище резервных копий — не зависит от провайдера:
 *
 * - `s3://<bucket>/<префикс>` — любое S3-совместимое хранилище (Yandex Object
 *   Storage, Selectel, VK Cloud, Timeweb, MinIO …): адрес, регион и ключи — в
 *   настройках, подпись AWS Signature V4, адреса вида <endpoint>/<bucket>/<ключ>;
 * - `file:///путь` — каталог смонтированного внешнего диска или сетевого хранилища.
 *
 * Ошибки называют операцию и код ответа, но не адрес с подписью, не ключи и не
 * тело ответа.
 */
export interface BackupStorage {
  /** Где хранится — для журнала, без ключей. */
  readonly label: string;
  put(name: string, data: Buffer): Promise<void>;
  get(name: string): Promise<Buffer>;
  /** Имена объектов в каталоге клиники. */
  list(): Promise<string[]>;
  delete(name: string): Promise<void>;
}

export class StorageError extends Error {}

/** Имена копий: только безопасные символы (имя попадает в адрес и путь). */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
function checkName(name: string) {
  if (!SAFE_NAME.test(name)) throw new StorageError("недопустимое имя копии");
}

// --- Каталог ---------------------------------------------------------------

export class DirStorage implements BackupStorage {
  readonly label: string;
  constructor(private readonly dir: string) {
    this.label = `каталог ${dir}`;
  }

  /** Запись атомарна: временный файл, fsync, переименование. */
  async put(name: string, data: Buffer) {
    checkName(name);
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const partial = join(this.dir, `.${name}.partial`);
      const fd = openSync(partial, "w", 0o600);
      try {
        writeSync(fd, data);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(partial, join(this.dir, name));
    } catch (error) {
      rmSync(join(this.dir, `.${name}.partial`), { force: true });
      throw new StorageError(
        `хранилище (${this.label}): запись не удалась (${code(error)})`,
      );
    }
  }

  async get(name: string) {
    checkName(name);
    try {
      return readFileSync(join(this.dir, name));
    } catch (error) {
      throw new StorageError(
        `хранилище (${this.label}): чтение не удалось (${code(error)})`,
      );
    }
  }

  async list() {
    if (!existsSync(this.dir)) return [];
    try {
      return readdirSync(this.dir).filter((n) => SAFE_NAME.test(n));
    } catch (error) {
      throw new StorageError(
        `хранилище (${this.label}): список не получен (${code(error)})`,
      );
    }
  }

  async delete(name: string) {
    checkName(name);
    rmSync(join(this.dir, name), { force: true });
  }
}

const code = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code ?? "ошибка";

// --- S3 --------------------------------------------------------------------

export type S3Options = {
  /** https://storage.example.ru — без бакета. */
  endpoint: string;
  region: string;
  bucket: string;
  /** Каталог клиники в бакете, без «/» в начале и конце. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Повторов при сбое сети и ответах 5xx. */
  retries?: number;
  timeoutMs?: number;
};

const hex = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** Кодирование по RFC 3986, как требует подпись S3. */
export function uriEncode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

/** Значение из XML ответа S3 (сущности &amp; и т. п.). */
const xmlText = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Подпись AWS Signature Version 4. Проверена на примерах из документации AWS
 * (src/backup/backup.test.ts).
 */
export function signV4(input: {
  method: string;
  url: URL;
  /** Подписываемые заголовки (имена — в нижнем регистре). */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** ГГГГММДДTЧЧММССZ */
  amzDate: string;
}): string {
  const names = Object.keys(input.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [
    input.method,
    input.url.pathname || "/",
    query,
    names.map((n) => `${n}:${lower[n].trim().replace(/\s+/g, " ")}\n`).join(""),
    names.join(";"),
    input.payloadHash,
  ].join("\n");
  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    hex(canonical),
  ].join("\n");
  const key = hmac(
    hmac(
      hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region),
      input.service,
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
}

/** Понятная причина по коду ответа S3 (без тела и адреса). */
function s3Reason(status: number, code: string | undefined): string {
  const known: Record<string, string> = {
    AccessDenied: "доступ запрещён — проверьте ключи и права на бакет",
    InvalidAccessKeyId: "неизвестный ключ доступа",
    SignatureDoesNotMatch:
      "подпись не принята — проверьте секретный ключ и регион",
    NoSuchBucket: "бакет не найден",
    NoSuchKey: "копия не найдена",
    RequestTimeTooSkewed: "часы сервера расходятся с хранилищем",
    QuotaExceeded: "превышена квота хранилища",
  };
  return `HTTP ${status}${code ? ` ${code}` : ""}${code && known[code] ? ` — ${known[code]}` : ""}`;
}

export class S3Storage implements BackupStorage {
  readonly label: string;
  private readonly base: URL;

  constructor(private readonly options: S3Options) {
    this.base = new URL(options.endpoint);
    if (this.base.protocol !== "https:" && this.base.hostname !== "127.0.0.1")
      throw new StorageError("BACKUP_S3_ENDPOINT: нужен адрес https://");
    this.label = `S3 ${this.base.host}/${options.bucket}/${options.prefix}`;
  }

  private url(name?: string, query?: Record<string, string>) {
    const path = [
      this.options.bucket,
      ...(name ? [this.options.prefix, name] : []),
    ]
      .filter(Boolean)
      .join("/");
    const url = new URL(`/${uriEncode(path, true)}`, this.base);
    for (const [k, v] of Object.entries(query ?? {}))
      url.searchParams.set(k, v);
    return url;
  }

  private async request(
    method: string,
    url: URL,
    body?: Buffer,
  ): Promise<Buffer> {
    const doFetch = this.options.fetch ?? fetch;
    const attempts = (this.options.retries ?? 2) + 1;
    let last = "";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const amzDate = (this.options.now?.() ?? new Date())
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
      const payloadHash = hex(body ?? "");
      const headers: Record<string, string> = {
        host: url.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
      };
      const authorization = signV4({
        method,
        url,
        headers,
        payloadHash,
        region: this.options.region,
        service: "s3",
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey,
        amzDate,
      });
      let response: Response;
      try {
        // Host fetch ставит сам — тот же, что подписан.
        const { host: _host, ...sent } = headers;
        void _host;
        response = await doFetch(url, {
          method,
          headers: { ...sent, authorization },
          body: body ? new Uint8Array(body) : undefined,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
        });
      } catch (error) {
        last =
          error instanceof Error && error.name === "TimeoutError"
            ? "нет ответа (тайм-аут)"
            : "нет связи";
        continue;
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (response.ok) return data;
      const errorCode = /<Code>([A-Za-z]{1,64})<\/Code>/.exec(
        data.toString(),
      )?.[1];
      last = s3Reason(response.status, errorCode);
      if (response.status < 500) break;
    }
    throw new StorageError(`хранилище (${this.label}): ${method} — ${last}`);
  }

  async put(name: string, data: Buffer) {
    checkName(name);
    await this.request("PUT", this.url(name), data);
  }

  async get(name: string) {
    checkName(name);
    return this.request("GET", this.url(name));
  }

  async list() {
    const names: string[] = [];
    const prefix = `${this.options.prefix}/`;
    let token: string | undefined;
    do {
      const xml = (
        await this.request(
          "GET",
          this.url(undefined, {
            "list-type": "2",
            prefix,
            ...(token ? { "continuation-token": token } : {}),
          }),
        )
      ).toString();
      for (const [, raw] of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        const key = xmlText(raw);
        const name = key.startsWith(prefix) ? key.slice(prefix.length) : "";
        if (SAFE_NAME.test(name)) names.push(name);
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? xmlText(
            /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(
              xml,
            )?.[1] ?? "",
          ) || undefined
        : undefined;
    } while (token);
    return names;
  }

  async delete(name: string) {
    checkName(name);
    await this.request("DELETE", this.url(name));
  }
}
