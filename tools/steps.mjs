// Разведка: главные экраны Mini App и панели.
export default async function ({ B, MINI, phone, desk, shot, run, password }) {
  await run("mini", async () => {
    const page = await phone.newPage();
    await page.goto(MINI, { waitUntil: "networkidle" });
    await shot(page, "mini-home");
    await shot(page, "mini-home-full", true);
  });
  await run("admin", async () => {
    const page = await desk.newPage();
    await page.goto(`${B}/admin/login`);
    await page.locator("input").nth(0).fill("demo-admin");
    await page.locator('input[type="password"]').fill(password);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/admin(?!\/login)/, { timeout: 15000 });
    for (const r of ["", "bookings", "schedule", "doctors", "requests"]) {
      await page.goto(`${B}/admin/${r}`, { waitUntil: "networkidle" });
      await shot(page, `admin-${r || "home"}`);
    }
  });
  await run("owner", async () => {
    const ctx2 = await desk.browser().newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const page = await ctx2.newPage();
    await page.goto(`${B}/admin/login`);
    await page.locator("input").nth(0).fill("demo-owner");
    await page.locator('input[type="password"]').fill(password);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/admin(?!\/login)/, { timeout: 15000 });
    for (const r of ["staff", "settings", "access-log"]) {
      await page.goto(`${B}/admin/${r}`, { waitUntil: "networkidle" });
      await shot(page, `admin-${r}`);
    }
  });
  await run("doctor", async () => {
    const ctx3 = await desk.browser().newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const page = await ctx3.newPage();
    await page.goto(`${B}/admin/login`);
    await page.locator("input").nth(0).fill("demo-doctor");
    await page.locator('input[type="password"]').fill(password);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/admin(?!\/login)/, { timeout: 15000 });
    await page.goto(`${B}/admin/my`, { waitUntil: "networkidle" });
    await shot(page, "admin-my");
  });
  await run("site", async () => {
    for (const [ctxName, c] of [["desk", desk], ["phone", phone]]) {
      const page = await c.newPage();
      await page.goto(`${B}/`, { waitUntil: "networkidle" });
      await shot(page, `site-home-${ctxName}`, true);
    }
  });
}
