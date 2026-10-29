import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAuth } from "@/admin/auth";
import { hashPassword } from "@/admin/password";
import { AdminService } from "@/admin/service";
import { createDemoBot } from "@/bot";
import { loadBotConfig } from "@/bot/config";
import {
  checkConflicts,
  checkEnvFileMode,
  checkInstance,
  dbPathFor,
  placeholders,
  renderNginx,
  type Env,
  type InstanceLayout,
} from "@/deploy/instance";

/**
 * Отдельный экземпляр на клинику (P0-7): проверка настроек до запуска,
 * конфликты двух клиник на одном сервере, шаблоны systemd и nginx без
 * секретов, сценарий init/check и изоляция данных двух экземпляров.
 * Все значения — тестовые.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "instance-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const secrets = () => ({
  VK_GROUP_TOKEN: `vk1.a.${randomBytes(24).toString("hex")}`,
  MEDICAL_DATA_KEY: randomBytes(32).toString("base64"),
  OPENAI_API_KEY: `sk-test-${randomBytes(16).toString("hex")}`,
});

function clinicEnv(
  id: string,
  port: number,
  group: number,
  layout: InstanceLayout,
  over: Env = {},
): Env {
  return {
    CLINIC_ID: id,
    PANEL_PORT: String(port),
    PANEL_DOMAIN: `${id}.clinic.example`,
    BOT_DB_PATH: dbPathFor(layout, id),
    VK_GROUP_ID: String(group),
    BOT_MODE: "live",
    VK_ALLOWED_USER_IDS: "111",
    VK_ADMIN_USER_ID: "111",
    ...secrets(),
    ...over,
  };
}

describe("проверка настроек экземпляра до запуска", () => {
  const layout = { dataRoot: "/var/lib/demo-med" };

  it("заполненные настройки двух клиник — без ошибок и без конфликтов", () => {
    const a = clinicEnv("clinic-a", 3101, 1001, layout);
    const b = clinicEnv("clinic-b", 3102, 1002, layout);
    expect(checkInstance(a, layout).errors).toEqual([]);
    expect(checkInstance(b, layout).errors).toEqual([]);
    expect(
      checkConflicts([
        { name: "clinic-a", env: a },
        { name: "clinic-b", env: b },
      ]),
    ).toEqual([]);
  });

  it("каждая ошибка — по имени переменной, без значений", () => {
    const env = clinicEnv("clinic-a", 3101, 1001, layout, {
      CLINIC_ID: "Clinic_A",
      PANEL_PORT: "80",
      PANEL_DOMAIN: "localhost",
      BOT_DB_PATH: "/var/lib/demo-med/clinic-b/bot.sqlite",
      VK_GROUP_TOKEN: "short",
      MEDICAL_DATA_KEY: "",
      ADMIN_COOKIE_SECURE: "false",
      ADMIN_ALLOWED_ORIGINS: "http://panel.example",
      VK_MINIAPP_ID: "54834865",
      TRUSTED_PROXY_IPS: "proxy.example",
      VK_ALOWED_USER_IDS: "1",
    });
    const { errors, warnings } = checkInstance(env, layout);
    expect(errors.map((e) => e.split(":")[0])).toEqual([
      "CLINIC_ID",
      "PANEL_PORT",
      "PANEL_DOMAIN",
      "TRUSTED_PROXY_IPS",
      "VK_GROUP_TOKEN",
      "MEDICAL_DATA_KEY",
      "ADMIN_COOKIE_SECURE",
      "ADMIN_ALLOWED_ORIGINS",
      "VK_MINIAPP_SECRET",
    ]);
    expect(warnings).toContain(
      "VK_ALOWED_USER_IDS: неизвестная переменная — проверьте написание",
    );
    const all = [...errors, ...warnings].join("\n");
    for (const secret of [env.OPENAI_API_KEY!, "short"])
      expect(all).not.toContain(secret);

    // База чужого каталога при правильном CLINIC_ID.
    const foreign = checkInstance(
      clinicEnv("clinic-a", 3101, 1001, layout, {
        BOT_DB_PATH: "/var/lib/demo-med/clinic-b/bot.sqlite",
      }),
      layout,
    );
    expect(foreign.errors).toEqual([
      "BOT_DB_PATH: должен быть /var/lib/demo-med/clinic-a/bot.sqlite — у каждой клиники своя база в своём каталоге",
    ]);
  });

  it("live: открытый доступ с Mini App — ошибка; live без списка и demo — предупреждения", () => {
    const open = clinicEnv("clinic-a", 3101, 1001, layout, {
      VK_ALLOWED_USER_IDS: "",
      VK_MINIAPP_ID: "54834865",
      VK_MINIAPP_SECRET: "secret-value-123",
    });
    expect(checkInstance(open, layout).errors).toEqual([
      "VK_MINIAPP_ID: при открытом доступе (BOT_MODE=live) Mini App пока не поддерживается — оставьте пустым",
    ]);
    const live = checkInstance(
      clinicEnv("clinic-a", 3101, 1001, layout, { VK_ALLOWED_USER_IDS: "" }),
      layout,
    );
    expect(live.errors).toEqual([]);
    expect(live.warnings).toContain(
      "BOT_MODE=live и пустой VK_ALLOWED_USER_IDS: бот отвечает всем пациентам",
    );
    const demo = checkInstance(
      clinicEnv("clinic-a", 3101, 1001, layout, { BOT_MODE: "demo" }),
      layout,
    );
    expect(demo.warnings.join()).toMatch(/BOT_MODE=demo/);
  });

  it("конфликты двух клиник: порт, домен, база, сообщество, секреты", () => {
    const a = clinicEnv("clinic-a", 3101, 1001, layout);
    const b = clinicEnv("clinic-b", 3101, 1001, layout, {
      PANEL_DOMAIN: "CLINIC-A.clinic.example",
      BOT_DB_PATH: a.BOT_DB_PATH,
      MEDICAL_DATA_KEY: a.MEDICAL_DATA_KEY,
      VK_GROUP_TOKEN: a.VK_GROUP_TOKEN,
    });
    const errors = checkConflicts([
      { name: "clinic-a", env: a },
      { name: "clinic-b", env: b },
    ]);
    expect(errors.map((e) => e.split(":")[0])).toEqual([
      "PANEL_PORT",
      "PANEL_DOMAIN",
      "BOT_DB_PATH",
      "VK_GROUP_ID",
      "VK_GROUP_TOKEN",
      "MEDICAL_DATA_KEY",
    ]);
    for (const secret of [a.MEDICAL_DATA_KEY!, a.VK_GROUP_TOKEN!])
      expect(errors.join("\n")).not.toContain(secret);
  });

  it(".env в каталоге приложения — ошибка: его прочитали бы все клиники", () => {
    const app = tempDir();
    const env = clinicEnv("clinic-a", 3101, 1001, layout);
    expect(checkInstance(env, { ...layout, appDir: app }).errors).toEqual([]);
    writeFileSync(join(app, ".env.local"), "VK_GROUP_TOKEN=x\n");
    expect(checkInstance(env, { ...layout, appDir: app }).errors).toEqual([
      expect.stringMatching(/^Каталог приложения содержит \.env\.local/),
    ]);
  });

  it("права файла настроек и незаменённые заполнители", () => {
    const dir = tempDir();
    const file = join(dir, "clinic.env");
    writeFileSync(file, "X=1\n", { mode: 0o644 });
    chmodSync(file, 0o644);
    expect(checkEnvFileMode(file)).toHaveLength(1);
    chmodSync(file, 0o600);
    expect(checkEnvFileMode(file)).toEqual([]);
    expect(
      placeholders({ VK_GROUP_ID: "<id сообщества>", PANEL_PORT: "3101" }),
    ).toEqual(["VK_GROUP_ID: не заполнено (осталось значение из шаблона)"]);
  });
});

describe("шаблоны развёртывания", () => {
  it("шаблон настроек: все обязательные переменные, секреты пустые, сам по себе не запускается", () => {
    const env = parseEnv(read("deploy/clinic/clinic.env.example")) as Env;
    for (const key of [
      "CLINIC_ID",
      "PANEL_PORT",
      "PANEL_DOMAIN",
      "BOT_DB_PATH",
      "MEDICAL_DATA_KEY",
      "VK_GROUP_ID",
      "VK_GROUP_TOKEN",
      "BOT_MODE",
      "VK_ALLOWED_USER_IDS",
    ])
      expect(env).toHaveProperty(key);
    for (const key of ["VK_GROUP_TOKEN", "MEDICAL_DATA_KEY", "OPENAI_API_KEY"])
      expect(env[key]).toBe("");
    expect(env.BOT_MODE).toBe("live");
    expect(placeholders(env).length).toBeGreaterThan(0);
    expect(checkInstance(env).errors.length).toBeGreaterThan(0);
  });

  it.each(["bot", "panel"])(
    "systemd demo-med-%s@: свой пользователь, свои настройки, запись только в каталог клиники",
    (kind) => {
      const unit = read(`deploy/systemd/demo-med-${kind}@.service`);
      for (const line of [
        "User=dm-%i",
        "Group=dm-%i",
        "EnvironmentFile=/etc/demo-med/clinics/%i.env",
        "ReadWritePaths=/var/lib/demo-med/%i",
        "ProtectSystem=strict",
        "ProtectHome=yes",
        "PrivateTmp=yes",
        "NoNewPrivileges=yes",
        "UMask=0077",
        `SyslogIdentifier=demo-med-%i-${kind}`,
      ])
        expect(unit).toContain(line);
      expect(unit).toMatch(
        /^ExecStartPre=.*clinic-instance\.mts check --self/m,
      );
      expect(unit.match(/^ReadWritePaths=/gm)).toHaveLength(1);
      // Секреты — только в EnvironmentFile.
      expect(unit).not.toMatch(/^Environment=.*(TOKEN|KEY|SECRET|PASSWORD)/m);
      expect(unit).not.toMatch(/\.env\.local/);
    },
  );

  it("панель слушает только 127.0.0.1 на порту клиники", () => {
    expect(read("deploy/systemd/demo-med-panel@.service")).toMatch(
      /^ExecStart=.*next start -H 127\.0\.0\.1 -p \$\{PANEL_PORT\}$/m,
    );
  });

  it("nginx: домен и порт клиники, адрес клиента перезаписывается, Mini App без журнала, без секретов", () => {
    const template = read("deploy/nginx/clinic.conf.template");
    const env = clinicEnv("clinic-a", 3101, 1001, { dataRoot: "/x" });
    const conf = renderNginx(template, env);
    expect(conf).not.toMatch(/\{\{/);
    expect(conf).toContain("server_name clinic-a.clinic.example;");
    expect(conf.match(/proxy_pass http:\/\/127\.0\.0\.1:3101;/g)).toHaveLength(
      2,
    );
    expect(conf).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(conf).not.toContain("$proxy_add_x_forwarded_for");
    expect(conf).toMatch(
      /location ~ \^\/\(miniapp\|api\/miniapp\)\(\/\|\$\) \{\n\s+access_log off;/,
    );
    expect(conf).toContain("location / {\n    return 404;");
    expect(conf).toContain("/var/log/nginx/demo-med-clinic-a.access.log");
    for (const secret of [
      env.VK_GROUP_TOKEN!,
      env.MEDICAL_DATA_KEY!,
      env.OPENAI_API_KEY!,
    ])
      expect(conf).not.toContain(secret);

    // До сертификата — только http и проверка домена.
    const http = renderNginx(template, env, { httpOnly: true });
    expect(http).toContain("/.well-known/acme-challenge/");
    expect(http).not.toContain("listen 443");

    // Доверенный прокси перед nginx: настоящий адрес — из его X-Forwarded-For.
    const proxied = renderNginx(template, {
      ...env,
      TRUSTED_PROXY_IPS: "203.0.113.10, 198.51.100.0/24",
    });
    expect(proxied).toContain(
      "set_real_ip_from 203.0.113.10;\n  set_real_ip_from 198.51.100.0/24;\n  real_ip_header X-Forwarded-For;",
    );
  });
});

describe("сценарий init → check (scripts/clinic-instance.mts)", () => {
  const tsx = join(ROOT, "node_modules/tsx/dist/cli.mjs");
  const run = (args: string[]) => {
    const r = spawnSync(
      process.execPath,
      [tsx, "scripts/clinic-instance.mts", ...args],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it(
    "создание двух клиник, ошибки до запуска, конфликт порта, секреты не печатаются",
    { timeout: 60_000 },
    async () => {
      const dir = tempDir();
      const conf = join(dir, "conf");
      const app = join(dir, "app");
      mkdirSync(conf);
      mkdirSync(app);
      const common = [`--others=${conf}`, `--data-root=${join(dir, "data")}`];
      const fileA = join(conf, "clinic-a.env");

      const init = run([
        "init",
        "--id=clinic-a",
        "--port=3101",
        "--domain=a.clinic.example",
        `--out=${fileA}`,
        ...common,
      ]);
      expect(init.code).toBe(0);
      expect(statSync(fileA).mode & 0o777).toBe(0o600);
      const created = parseEnv(readFileSync(fileA, "utf8")) as Env;
      expect(Buffer.from(created.MEDICAL_DATA_KEY!, "base64")).toHaveLength(32);
      expect(init.out).not.toContain(created.MEDICAL_DATA_KEY);

      // Повторно тот же файл и тот же порт у другой клиники — отказ.
      expect(
        run([
          "init",
          "--id=clinic-a",
          "--port=3109",
          "--domain=x.example",
          `--out=${fileA}`,
          ...common,
        ]).code,
      ).not.toBe(0);
      const clash = run([
        "init",
        "--id=clinic-b",
        "--port=3101",
        "--domain=b.clinic.example",
        `--out=${join(conf, "clinic-b.env")}`,
        ...common,
      ]);
      expect(clash.code).toBe(1);
      expect(clash.out).toMatch(/PANEL_PORT: порт панели совпадает/);

      // Незаполненный файл — ошибки до запуска.
      const check = (file: string, extra: string[] = []) =>
        run(["check", `--env=${file}`, `--app=${app}`, ...common, ...extra]);
      const empty = check(fileA);
      expect(empty.code).toBe(1);
      expect(empty.out).toMatch(/FAIL VK_GROUP_TOKEN/);
      expect(empty.out).toMatch(/Экземпляр не запускать/);
      expect(empty.out).not.toContain(created.MEDICAL_DATA_KEY);

      // Заполнено — проверка проходит; значения в выводе не появляются.
      const token = `vk1.a.${randomBytes(24).toString("hex")}`;
      const fill = (file: string, group: string, tok: string) =>
        writeFileSync(
          file,
          readFileSync(file, "utf8")
            .replace(/^VK_GROUP_ID=.*$/m, `VK_GROUP_ID=${group}`)
            .replace(/^VK_GROUP_TOKEN=.*$/m, `VK_GROUP_TOKEN=${tok}`)
            .replace(/^VK_ALLOWED_USER_IDS=.*$/m, "VK_ALLOWED_USER_IDS=111")
            .replace(/^VK_ADMIN_USER_ID=.*$/m, "VK_ADMIN_USER_ID=111"),
        );
      fill(fileA, "1001", token);
      const ok = check(fileA);
      expect(ok.out).toMatch(/OK {3}настройки экземпляра проверены/);
      expect(ok.code).toBe(0);
      expect(ok.out).not.toContain(token);

      // Вторая клиника с тем же сообществом и ключом — конфликт.
      const fileB = join(conf, "clinic-b.env");
      expect(
        run([
          "init",
          "--id=clinic-b",
          "--port=3102",
          "--domain=b.clinic.example",
          `--out=${fileB}`,
          ...common,
        ]).code,
      ).toBe(0);
      fill(fileB, "1001", token);
      const both = check(fileB);
      expect(both.code).toBe(1);
      expect(both.out).toMatch(/FAIL VK_GROUP_ID: сообщество ВКонтакте/);
      expect(both.out).toMatch(/FAIL VK_GROUP_TOKEN: секрет совпадает/);
      expect(both.out).not.toContain(token);

      // Порт уже занят другим процессом.
      const server = createServer();
      await new Promise<void>((done) => server.listen(3101, "127.0.0.1", done));
      try {
        const busy = check(fileA, ["--port-free"]);
        expect(busy.code).toBe(1);
        expect(busy.out).toMatch(/PANEL_PORT: порт уже занят/);
      } finally {
        server.close();
      }

      // nginx из файла настроек — без секретов.
      const nginx = run(["nginx", `--env=${fileA}`]);
      expect(nginx.code).toBe(0);
      expect(nginx.out).toContain("server_name a.clinic.example;");
      expect(nginx.out).not.toContain(token);
    },
  );
});

describe("изоляция двух экземпляров", () => {
  it("свои базы, сотрудники, сессии, справочник и записи", async () => {
    const root = tempDir();
    const layout = { dataRoot: root };
    const envs = ["clinic-a", "clinic-b"].map((id, i) =>
      clinicEnv(id, 3101 + i, 1001 + i, layout),
    );
    const now = new Date("2026-10-19T06:00:00Z");
    // Хранилище сверяет даты с системными часами — фиксируем их.
    vi.useFakeTimers({ toFake: ["Date"], now });
    cleanups.push(() => vi.useRealTimers());
    const instances = envs.map((env) => {
      const cfg = loadBotConfig(env);
      if (!cfg.ok) throw new Error(cfg.errors.join());
      mkdirSync(join(root, env.CLINIC_ID!), { recursive: true });
      const { bot, store } = createDemoBot({
        dbPath: cfg.config.dbPath,
        cipher: cfg.config.cipher,
        now: () => now,
      });
      cleanups.push(() => store.close());
      return {
        bot,
        store,
        service: new AdminService(store, () => now),
        auth: new AdminAuth(store.admin, () => now),
      };
    });
    const [a, b] = instances;
    expect(envs[0].BOT_DB_PATH).not.toBe(envs[1].BOT_DB_PATH);

    // Сотрудник и сессия клиники A не действуют в клинике B.
    const password = "надёжный-пароль-2026";
    a.store.admin.createUser(
      "owner",
      await hashPassword(password),
      now.toISOString(),
      "owner",
    );
    const login = await a.auth.login("owner", password, "ip");
    expect(login.ok).toBe(true);
    const token = login.ok ? login.token : "";
    expect(a.auth.verify(token)).toBeDefined();
    expect(b.auth.verify(token)).toBeUndefined();
    expect((await b.auth.login("owner", password, "ip")).ok).toBe(false);

    // Справочник клиники A меняется — у B прежний.
    const settings = a.service.getSettings();
    a.service.updateSettings(
      {
        settings: { ...settings.settings, name: "Клиника «Альфа»" },
        services: settings.services,
      },
      1,
    );
    expect(a.store.clinic.load().name).toBe("Клиника «Альфа»");
    expect(b.store.clinic.load().name).not.toBe("Клиника «Альфа»");

    // Запись через бота A — только в базе A.
    const booking = a.service.createBooking(
      { doctorId: "testova", date: "2026-10-21", time: "10:00" },
      1,
    );
    expect(booking).toBeDefined();
    expect(a.store.searchBookings({})).toHaveLength(1);
    expect(b.store.searchBookings({})).toHaveLength(0);
    await a.bot.handle(7, { type: "text", text: "здравствуйте" });
    expect(a.store.load(7)).toBeDefined();
    expect(b.store.load(7)).toBeUndefined();

    // Ключи шифрования разные: разговор клиники A не читается ключом клиники B.
    expect(envs[0].MEDICAL_DATA_KEY).not.toBe(envs[1].MEDICAL_DATA_KEY);
  });

  it("файл базы создаётся с правами только для владельца процесса", () => {
    const root = tempDir();
    const path = join(root, "bot.sqlite");
    // Сервис запускается с UMask=0077 — так же, как здесь.
    const out = execFileSync(
      process.execPath,
      [
        "-e",
        `process.umask(0o077); const { DatabaseSync } = require("node:sqlite"); new DatabaseSync(${JSON.stringify(path)}).exec("CREATE TABLE t (x)"); console.log((require("node:fs").statSync(${JSON.stringify(path)}).mode & 0o777).toString(8))`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    expect(out.trim()).toBe("600");
  });
});
