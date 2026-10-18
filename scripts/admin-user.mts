/**
 * Учётные записи админ-панели. Публичных или демонстрационных паролей нет:
 * администратора создаёт владелец сервера этой командой.
 *
 *   npm run admin:user -- create <логин>     создать (пароль спросит, не показывая)
 *   npm run admin:user -- password <логин>   сменить пароль (завершает все сессии)
 *   npm run admin:user -- disable <логин>    отключить вход
 *   npm run admin:user -- enable <логин>     включить вход
 *   npm run admin:user -- list               список администраторов (без паролей)
 *
 * Для автоматизации пароль можно передать через stdin: … create admin --password-stdin
 * Пароль не печатается и не пишется в журнал; в базе хранится только хэш scrypt.
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { hashPassword, passwordProblem } from "@/admin/password";
import { loadLocalEnv } from "@/bot/env";
import { SqliteStore } from "@/bot/storage/sqlite";

loadLocalEnv();
const [command, login] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));
const fromStdin = process.argv.includes("--password-stdin");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Пароль из терминала без отображения символов. */
function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY)
    fail("Нет терминала для ввода пароля. Используйте --password-stdin.");
  return new Promise((resolve) => {
    stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char: string) => {
      for (const c of char) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  if (fromStdin) {
    const rl = createInterface({ input: stdin, terminal: false });
    for await (const line of rl) return line;
    fail("Пароль не передан.");
  }
  const first = await askHidden("Новый пароль: ");
  const second = await askHidden("Повторите пароль: ");
  if (first !== second) fail("Пароли не совпадают.");
  return first;
}

const store = new SqliteStore(process.env.BOT_DB_PATH || ".data/bot.sqlite");
const now = new Date().toISOString();
try {
  if (command === "list") {
    const users = store.admin.listUsers();
    if (users.length === 0)
      console.log(
        "Администраторов нет. Создайте: npm run admin:user -- create <логин>",
      );
    for (const u of users)
      console.log(
        `${u.login}${u.disabled ? " (отключён)" : ""} — создан ${u.createdAt.slice(0, 10)}`,
      );
  } else if (!login || !/^[a-zA-Z0-9._-]{3,64}$/.test(login)) {
    fail(
      "Укажите логин: латиница, цифры, точка, дефис, подчёркивание (3–64 символа).",
    );
  } else if (command === "create" || command === "password") {
    const exists = store.admin.findUser(login);
    if (command === "create" && exists)
      fail(`Администратор «${login}» уже есть.`);
    if (command === "password" && !exists)
      fail(`Администратора «${login}» нет.`);
    const password = await readPassword();
    const problem = passwordProblem(password);
    if (problem) fail(problem);
    const hash = await hashPassword(password);
    if (command === "create") {
      store.admin.createUser(login, hash, now);
      console.log(`Администратор «${login}» создан. Вход: /admin/login`);
    } else {
      store.admin.setPassword(login, hash);
      console.log(`Пароль «${login}» изменён, все его сессии завершены.`);
    }
  } else if (command === "disable" || command === "enable") {
    if (!store.admin.setDisabled(login, command === "disable", now))
      fail(`Администратора «${login}» нет.`);
    console.log(
      command === "disable"
        ? `Вход для «${login}» отключён.`
        : `Вход для «${login}» включён.`,
    );
  } else {
    fail("Команды: create, password, disable, enable, list.");
  }
} finally {
  store.close();
}
