// Экраны для карты продукта и проверка самой карты на сайте.
const login = async (browser, B, user, password) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${B}/admin/login`);
  await page.locator("input").nth(0).fill(user);
  await page.locator('input[type="password"]').fill(password);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/admin(?!\/login)/, { timeout: 15000 });
  return page;
};
const settle = (page) => page.waitForLoadState("networkidle").then(() => page.waitForTimeout(1200));

export default async function ({ B, MINI, phone, desk, shot, run, report, password }) {
  const browser = desk.browser();
  await run("mini", async () => {
    const page = await phone.newPage();
    await page.goto(MINI, { waitUntil: "networkidle" });
    await shot(page, "mini-home");
    await page.getByRole("button", { name: "Врачи" }).last().click();
    await settle(page);
    await shot(page, "mini-doctors");
    await page.getByText("Анна Тестова").first().click();
    await settle(page);
    await shot(page, "mini-doctor");
    const book = page.getByRole("button", { name: /Записаться/ }).first();
    await book.click();
    await settle(page);
    await shot(page, "mini-flow-1");
    const time = page.getByRole("button", { name: /^\s*\d{1,2}:\d{2}\s*$/ }).first();
    if (await time.count()) { await time.click(); await settle(page); await shot(page, "mini-flow-2"); }
    await page.getByRole("button", { name: "Подтвердить запись" }).click();
    await settle(page);
    await shot(page, "mini-done");
    report["mini-buttons"] = await page.locator("button").allInnerTexts();
  });
  await run("mini-my", async () => {
    const page = await phone.newPage();
    await page.goto(MINI, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Записи" }).last().click();
    await settle(page);
    await shot(page, "mini-my");
  });
  await run("admin", async () => {
    const page = await login(browser, B, "demo-admin", password);
    for (const r of ["", "bookings", "schedule", "doctors", "requests"]) {
      await page.goto(`${B}/admin/${r}`);
      await settle(page);
      await shot(page, `admin-${r || "home"}`);
    }
    await page.getByRole("button", { name: "Открыть текст" }).first().click();
    await settle(page);
    await shot(page, "admin-requests-open");
  });
  await run("owner", async () => {
    const page = await login(browser, B, "demo-owner", password);
    for (const r of ["staff", "access-log"]) {
      await page.goto(`${B}/admin/${r}`);
      await settle(page);
      await shot(page, `admin-${r}`);
    }
  });
  await run("doctor", async () => {
    const page = await login(browser, B, "demo-doctor", password);
    await page.goto(`${B}/admin/my`);
    await settle(page);
    await page.waitForTimeout(2000);
    await shot(page, "admin-my");
  });
  await run("reduced", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`${B}/catalog/clinic-ai-administrator#map-a5`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    report["reduced-running"] = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName));
  });
  // Сайт: карта на главной и на странице решения.
  for (const [name, c] of [["desk", desk], ["phone", phone]]) {
    await run(`site-${name}`, async () => {
      const page = await c.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(`${B}/`, { waitUntil: "networkidle" });
      await shot(page, `site-home-${name}`, true);
      const ov = page.locator("#how-it-works");
      if (await ov.count()) {
        await ov.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70));
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/ov-${name}-1.png` });
        await ov.getByRole("button", { name: /Запись на приём/ }).first().click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/ov-${name}-3.png` });
      }
      await page.goto(`${B}/catalog/clinic-ai-administrator`, { waitUntil: "networkidle" });
      await shot(page, `site-admin-${name}`, true);
      const map = page.locator("#product-map");
      if (await map.count()) {
        await map.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70));
        await page.waitForTimeout(2500);
        report[`debug-${name}`] = await page.evaluate(() => {
          const m = document.querySelector(".pm-map");
          const nodes = [...document.querySelectorAll("#product-map .pm-map .pm-node")].slice(0, 3);
          return {
            inview: m && m.getAttribute("data-inview"),
            nodes: nodes.map((n) => { const cs = getComputedStyle(n); const r = n.getBoundingClientRect(); return { op: cs.opacity, anim: cs.animationName, vis: cs.visibility, r: [r.x, r.y, r.width, r.height].map(Math.round) }; }),
            anims: document.getAnimations().map((a) => [a.animationName, a.playState, Math.round(a.currentTime)]).slice(0, 30),
          };
        });
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/map-${name}-view.png` });
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/map-${name}-1.png` });
        await map.locator("button[data-index='4']:visible").first().click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/map-${name}-a5.png` });
        await map.locator("button[data-index='6']:visible").first().click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/map-${name}-a7.png` });
        await map.getByRole("button", { name: "Показать за минуту" }).click();
        await page.waitForTimeout(6800);
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/map-${name}-auto.png` });
        report[`autoplay-${name}`] = await map.locator("[aria-current]:visible").allInnerTexts();
      }
      const setup = page.locator("#product-setup");
      if (await setup.count()) {
        await setup.locator("button[data-index='3']:visible").first().click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${process.env.GITHUB_WORKSPACE}/out/shots/setup-${name}.png` });
      }
      await page.goto(`${B}/catalog/clinic-ai-administrator#map-a8`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      report[`hash-${name}`] = await page.locator("#product-map [aria-current]:visible").allInnerTexts();
      await shot(page, `site-hash-${name}`);
      report[`errors-${name}`] = errors;
      for (const url of ["/", "/catalog/clinic-ai-administrator"]) {
        await page.goto(`${B}${url}`, { waitUntil: "networkidle" });
        report[`overflow-${name}-${url}`] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      }
    });
  }
}
