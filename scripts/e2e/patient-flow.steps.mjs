/**
 * Шаги сквозного сценария `npm run e2e:patient-flow` (запуск, временная база и
 * очистка — scripts/e2e/patient-flow.mjs): запись через VK Mini App → запись в
 * панели → выгрузка JSON → отмена удаления → удаление → слот снова свободен.
 * Только локальный next start на временной базе и вымышленный пациент.
 */
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sign = (secret, params) => {
  const query = Object.keys(params)
    .filter((k) => k.startsWith("vk_"))
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  return createHmac("sha256", secret)
    .update(query)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};
const check = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/**
 * Возвращает отчёт `{ ok, steps, … }`; при ошибке шага остальные не выполняются,
 * а в `shots` сохраняются снимки обеих страниц в момент сбоя.
 */
export async function runPatientFlow({
  chromium,
  launchOptions,
  base: B,
  shots: OUT,
  work,
  vkId: VK,
  otherBookingId,
  miniApp,
  owner,
}) {
  const report = {
    ok: false,
    steps: [],
    consoleErrors: [],
    failedRequests: [],
    piiInAdminUrls: [],
  };
  let shotN = 0;
  const params = {
    vk_user_id: VK,
    vk_app_id: miniApp.appId,
    vk_ts: String(Math.floor(Date.now() / 1000)),
    vk_platform: "mobile_web",
    vk_language: "ru",
  };
  const launch = new URLSearchParams({
    ...params,
    sign: sign(miniApp.secret, params),
  }).toString();
  const MINI = `${B}/miniapp?${launch}`;

  function watch(page, label) {
    page.on(
      "console",
      (m) =>
        m.type() === "error" &&
        report.consoleErrors.push(`${label}: ${m.text()}`),
    );
    page.on("pageerror", (e) =>
      report.consoleErrors.push(`${label} pageerror: ${e.message}`),
    );
    page.on("response", (r) => {
      if (r.status() >= 400)
        report.failedRequests.push(
          `${label}: ${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`,
        );
    });
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/admin") && u.includes(VK))
        report.piiInAdminUrls.push(new URL(u).pathname);
    });
  }
  async function shot(page, name) {
    const file = `${String(++shotN).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: true });
    return file;
  }
  async function step(id, title, fn) {
    const started = Date.now();
    try {
      const details = await fn();
      report.steps.push({
        id,
        title,
        ok: true,
        ms: Date.now() - started,
        ...details,
      });
      console.log(`PASS ${id} ${title}`);
    } catch (e) {
      const error = String(e?.message ?? e).slice(0, 600);
      report.steps.push({
        id,
        title,
        ok: false,
        ms: Date.now() - started,
        error,
      });
      console.log(`FAIL ${id} ${title}: ${error.slice(0, 300)}`);
      for (const [page, name] of [
        [mini, "miniapp"],
        [admin, "admin"],
      ])
        await shot(page, `FAIL-${id}-${name}`).catch(() => {});
      throw e;
    }
  }
  const miniApi = (path) =>
    fetch(`${B}/api/miniapp/${path}`, {
      headers: { "X-VK-Launch-Params": launch },
    }).then(async (r) => ({ status: r.status, body: (await r.json()).data }));

  const browser = await chromium.launch(launchOptions);
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: "ru-RU",
  });
  const mini = await mctx.newPage();
  watch(mini, "miniapp");
  const actx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "ru-RU",
    acceptDownloads: true,
  });
  const admin = await actx.newPage();
  watch(admin, "admin");

  let booked; // { id, date, time, doctorId }
  let token;
  try {
    await step("S1", "Запись пациента через VK Mini App", async () => {
      await mini.goto(MINI);
      await mini.getByRole("button", { name: "Врачи" }).last().click();
      await mini.getByText("Анна Тестова").first().click();
      await mini
        .getByRole("button", { name: /Записаться/ })
        .first()
        .click();
      const slot = mini
        .getByRole("button", { name: /^\s*\d{1,2}:\d{2}\s*$/ })
        .first();
      await slot.waitFor();
      const s1 = await shot(mini, "miniapp-slots");
      await slot.click();
      const confirm = mini.getByRole("button", { name: "Подтвердить запись" });
      await confirm.waitFor();
      const s2 = await shot(mini, "miniapp-confirm");
      const [resp] = await Promise.all([
        mini.waitForResponse(
          (r) =>
            r.url().endsWith("/api/miniapp/bookings") &&
            r.request().method() === "POST",
        ),
        confirm.click(),
      ]);
      const body = (await resp.json()).data;
      check(
        resp.status() === 200,
        `POST bookings → ${resp.status()} ${JSON.stringify(body)}`,
      );
      booked = {
        id: body.id,
        date: body.date,
        time: body.time,
        doctorId: body.doctorId,
      };
      check(body.repeated === false, "запись помечена как повтор");
      await mini.getByText("Вы записаны").waitFor();
      return {
        booking: booked,
        shots: [s1, s2, await shot(mini, "miniapp-booked")],
      };
    });

    await step("S2", "Запись видна в «Мои записи» Mini App", async () => {
      await mini.goto(MINI);
      await mini.getByRole("button", { name: "Записи" }).last().click();
      await mini.getByText("Анна Тестова").first().waitFor();
      await mini.getByText(booked.time).first().waitFor();
      const api = await miniApi("bookings");
      check(
        api.body.upcoming?.some((b) => b.id === booked.id),
        "нет в upcoming API",
      );
      return { shots: [await shot(mini, "miniapp-my-bookings")] };
    });

    await step(
      "S3",
      "Запись появилась в панели (источник VK Mini App, VK ID скрыт)",
      async () => {
        await admin.goto(`${B}/admin/login`);
        await admin.getByLabel("Логин").fill(owner.login);
        await admin.getByLabel("Пароль").fill(owner.password);
        await admin.getByRole("button", { name: /Войти/ }).click();
        await admin.waitForURL((u) => !u.pathname.startsWith("/admin/login"));
        await admin.goto(`${B}/admin/bookings`);
        const row = admin.getByRole("button", {
          name: new RegExp(`№${booked.id} ·`),
        });
        await row.waitFor();
        const rowText = (await row.innerText()).replace(/\s+/g, " ");
        check(
          rowText.includes(booked.time),
          `в строке нет времени: ${rowText}`,
        );
        check(!rowText.includes(VK), `полный VK ID в строке: ${rowText}`);
        const s1 = await shot(admin, "panel-bookings");
        await row.click();
        const dialog = admin.getByRole("dialog");
        await dialog.waitFor();
        const text = (await dialog.innerText()).replace(/\s+/g, " ");
        check(
          text.includes("VK Mini App"),
          `источник не VK Mini App: ${text.slice(0, 300)}`,
        );
        check(!text.includes(VK), "полный VK ID в карточке записи");
        const s2 = await shot(admin, "panel-booking-details");
        await admin.keyboard.press("Escape");
        return { row: rowText, shots: [s1, s2] };
      },
    );

    await step("S4", "Поиск пациента и выгрузка JSON", async () => {
      await admin.goto(`${B}/admin/patients`);
      await admin.getByLabel("VK ID пациента").fill(VK);
      const [resp] = await Promise.all([
        admin.waitForResponse((r) =>
          r.url().endsWith("/api/admin/patients/search"),
        ),
        admin.getByRole("button", { name: "Найти" }).click(),
      ]);
      const summary = (await resp.json()).data;
      token = summary.token;
      check(
        summary.found &&
          summary.counts.bookings === 1 &&
          summary.counts.upcomingBookings === 1,
        `счётчики: ${JSON.stringify(summary.counts)}`,
      );
      const s1 = await shot(admin, "panel-patient-found");
      const [download] = await Promise.all([
        admin.waitForEvent("download"),
        admin.getByRole("button", { name: "Скачать выгрузку (JSON)" }).click(),
      ]);
      const file = join(work, "export.json");
      await download.saveAs(file);
      const raw = readFileSync(file, "utf8");
      const data = JSON.parse(raw);
      const bks = data.data?.bookings ?? data.bookings;
      check(
        Array.isArray(bks) && bks.length === 1,
        `в выгрузке записей: ${bks?.length}`,
      );
      const b = bks[0];
      check(
        b.id === booked.id &&
          b.date === booked.date &&
          b.time === booked.time &&
          b.source === "miniapp" &&
          b.status === "confirmed",
        `запись в выгрузке не совпадает: ${JSON.stringify(b)}`,
      );
      check(
        !bks.some((x) => x.id === otherBookingId),
        "в выгрузку попала запись другого пациента",
      );
      // Медицинского содержания быть не должно: только флаги наличия.
      for (const bad of [
        "payload",
        "complaint",
        "messages",
        "history",
        "answers",
      ])
        check(!raw.includes(`"${bad}"`), `в выгрузке поле ${bad}`);
      await admin.getByText("Выгрузка сохранена").first().waitFor();
      return {
        filename: download.suggestedFilename(),
        format: data.format,
        version: data.version,
        topKeys: Object.keys(data),
        shots: [s1, await shot(admin, "panel-export-done")],
      };
    });

    await step(
      "S5",
      "Отмена удаления («Не удалять») ничего не меняет",
      async () => {
        await admin
          .getByRole("button", { name: "Удалить данные пациента…" })
          .click();
        const dialog = admin.getByRole("dialog");
        await dialog.waitFor();
        const del = dialog.getByRole("button", {
          name: "Удалить безвозвратно",
        });
        check(
          await del.isDisabled(),
          "кнопка удаления активна без повторного ввода VK ID",
        );
        await dialog.getByLabel("Введите VK ID ещё раз").fill("900101");
        check(await del.isDisabled(), "кнопка активна при неверном VK ID");
        await dialog.getByLabel("Введите VK ID ещё раз").fill(VK);
        check(await del.isEnabled(), "кнопка неактивна при верном VK ID");
        const s1 = await shot(admin, "panel-erase-dialog");
        let erased = false;
        admin.on(
          "request",
          (r) => r.url().endsWith("/patients/erase") && (erased = true),
        );
        await dialog.getByRole("button", { name: "Не удалять" }).click();
        await dialog.waitFor({ state: "hidden" });
        check(!erased, "после «Не удалять» отправлен запрос удаления");
        // Повторный поиск: данные на месте; поле подтверждения сброшено.
        const [resp] = await Promise.all([
          admin.waitForResponse((r) =>
            r.url().endsWith("/api/admin/patients/search"),
          ),
          admin.getByRole("button", { name: "Найти" }).click(),
        ]);
        const again = (await resp.json()).data;
        check(
          again.counts.bookings === 1 && again.counts.upcomingBookings === 1,
          "данные изменились после отмены",
        );
        check(again.token === token, "отпечаток данных изменился после отмены");
        await admin
          .getByRole("button", { name: "Удалить данные пациента…" })
          .click();
        const cleared = await admin
          .getByRole("dialog")
          .getByLabel("Введите VK ID ещё раз")
          .inputValue();
        check(cleared === "", `поле подтверждения не сброшено: «${cleared}»`);
        await admin
          .getByRole("dialog")
          .getByRole("button", { name: "Не удалять" })
          .click();
        const api = await miniApi("bookings");
        check(
          api.body.upcoming?.some((b) => b.id === booked.id),
          "запись пропала из Mini App после отмены",
        );
        return { shots: [s1, await shot(admin, "panel-after-cancel")] };
      },
    );

    await step("S6", "Подтверждённое удаление", async () => {
      await admin
        .getByRole("button", { name: "Удалить данные пациента…" })
        .click();
      const dialog = admin.getByRole("dialog");
      await dialog.getByLabel("Введите VK ID ещё раз").fill(VK);
      const [resp] = await Promise.all([
        admin.waitForResponse((r) =>
          r.url().endsWith("/api/admin/patients/erase"),
        ),
        dialog.getByRole("button", { name: "Удалить безвозвратно" }).click(),
      ]);
      const body = (await resp.json()).data;
      check(
        resp.status() === 200,
        `erase → ${resp.status()} ${JSON.stringify(body)}`,
      );
      await admin
        .getByText("В этой клинике данных пациента с таким VK ID нет.")
        .waitFor();
      await admin.getByText("Данные пациента удалены.").first().waitFor();
      return { response: body, shots: [await shot(admin, "panel-erased")] };
    });

    await step("S7", "Слот освобождён: Mini App и API", async () => {
      const api = await miniApi(
        `doctors/${booked.doctorId}/slots?date=${booked.date}`,
      );
      check(
        api.status === 200 && api.body.includes(booked.time),
        `слот ${booked.date} ${booked.time} не свободен: ${JSON.stringify(api.body)}`,
      );
      const my = await miniApi("bookings");
      check(
        (my.body.upcoming ?? []).length === 0 &&
          (my.body.past ?? []).length === 0,
        `у пациента остались записи: ${JSON.stringify(my.body)}`,
      );
      await mini.goto(MINI);
      await mini.getByRole("button", { name: "Записи" }).last().click();
      await mini.getByText("Предстоящих записей нет").waitFor();
      const s1 = await shot(mini, "miniapp-no-bookings");
      await mini.getByRole("button", { name: "Врачи" }).last().click();
      await mini.getByText("Анна Тестова").first().click();
      await mini
        .getByRole("button", { name: /Записаться/ })
        .first()
        .click();
      // Дата записи может быть не первым доступным днём (запуск вечером, выходные):
      // выбираем именно её — по порядку дней из API, как их показывает Mini App.
      const days = await miniApi(`doctors/${booked.doctorId}/days`);
      const index = days.body?.indexOf(booked.date) ?? -1;
      check(
        index >= 0,
        `дня ${booked.date} нет среди доступных: ${JSON.stringify(days.body)}`,
      );
      const chip = mini
        .getByRole("group", { name: "Дата" })
        .getByRole("button")
        .nth(index);
      await chip.click();
      await chip.and(mini.locator('[aria-pressed="true"]')).waitFor();
      const freed = mini.getByRole("button", {
        name: new RegExp(`^\\s*${booked.time}\\s*$`),
      });
      await freed.waitFor();
      return {
        chosenDay: (await chip.innerText()).replace(/\s+/g, " "),
        shots: [s1, await shot(mini, "miniapp-slot-free")],
      };
    });

    await step("S8", "Панель: записи нет, чужая запись цела", async () => {
      await admin.goto(`${B}/admin/bookings`);
      await admin
        .getByRole("button", { name: new RegExp(`№${otherBookingId} ·`) })
        .waitFor();
      check(
        (await admin
          .getByRole("button", { name: new RegExp(`№${booked.id} ·`) })
          .count()) === 0,
        "удалённая запись видна в панели",
      );
      return { shots: [await shot(admin, "panel-bookings-after")] };
    });

    await step(
      "S9",
      "Без ошибок в консоли, ответов ≥400 и VK ID в адресах панели",
      async () => {
        check(
          report.consoleErrors.length === 0,
          `ошибки консоли: ${report.consoleErrors.join(" | ")}`,
        );
        check(
          report.failedRequests.length === 0,
          `ответы с ошибкой: ${report.failedRequests.join(" | ")}`,
        );
        check(
          report.piiInAdminUrls.length === 0,
          `VK ID в адресах: ${report.piiInAdminUrls.join(" | ")}`,
        );
        return {};
      },
    );
    report.ok = true;
  } catch {
    /* шаг уже записан в отчёт */
  } finally {
    report.booking = booked;
    writeFileSync(
      join(OUT, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await browser.close();
  }
  return report;
}
