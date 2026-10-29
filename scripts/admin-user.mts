/**
 * Учётные записи админ-панели. Публичных или демонстрационных паролей нет:
 * администратора создаёт владелец сервера этой командой.
 *
 *   npm run admin:user -- create <логин>     создать (пароль спросит, не показывая)
 *       --role=owner|admin|doctor            роль (первая учётная запись — owner,
 *                                            следующие по умолчанию — admin)
 *       --doctor=<id врача>                  для роли doctor: врач расписания
 *   npm run admin:user -- role <логин> --role=… [--doctor=…]   сменить роль
 *   npm run admin:user -- password <логин>   сменить пароль (завершает все сессии)
 *   npm run admin:user -- disable <логин>    отключить вход
 *   npm run admin:user -- enable <логин>     включить вход
 *   npm run admin:user -- list               список сотрудников и ролей (без паролей)
 *
 * Сотрудников удобнее приглашать из панели (раздел «Сотрудники», роль owner):
 * сотрудник сам задаёт пароль по одноразовой ссылке. Ни одна роль не открывает
 * медицинские сведения сама по себе — см. docs/medical-privacy.md.
 *
 * Для автоматизации пароль можно передать через stdin: … create admin --password-stdin
 * Пароль не печатается и не пишется в журнал; в базе хранится только хэш scrypt.
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { hashPassword, passwordProblem } from "@/admin/password";
import { loadLocalEnv } from "@/bot/env";
import { STAFF_ROLES, type StaffRole } from "@/bot/storage/admin-store";
import { SqliteStore } from "@/bot/storage/sqlite";

loadLocalEnv();
const [command, login] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));
const fromStdin = process.argv.includes("--password-stdin");
const option = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim();
const ROLE_TITLES: Record<StaffRole, string> = {
  owner: "владелец",
  admin: "администратор",
  doctor: "врач",
};

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

/** Роль и врач из параметров; врач проверяется по справочнику клиники. */
function roleFromArgs(fallback: StaffRole): {
  role: StaffRole;
  doctorId: string | null;
} {
  const raw = option("role") ?? fallback;
  if (!(STAFF_ROLES as readonly string[]).includes(raw))
    fail(`Роль: ${STAFF_ROLES.join(", ")}.`);
  const role = raw as StaffRole;
  if (role !== "doctor") return { role, doctorId: null };
  const doctorId = option("doctor");
  const doctors = store.clinic.load().doctors;
  if (!doctorId || !doctors.some((d) => d.id === doctorId))
    fail(
      `Для роли doctor укажите --doctor=<id>. Врачи: ${doctors.map((d) => d.id).join(", ")}`,
    );
  const taken = store.admin.userForDoctor(doctorId);
  if (taken && taken.login !== login)
    fail(`Врач «${doctorId}» уже связан с учётной записью «${taken.login}».`);
  return { role, doctorId };
}
try {
  if (command === "list") {
    const users = store.admin.listUsers();
    if (users.length === 0)
      console.log(
        "Сотрудников нет. Создайте владельца: npm run admin:user -- create <логин>",
      );
    for (const u of users)
      console.log(
        `${u.login} — ${ROLE_TITLES[u.role]}${u.doctorId ? ` (${u.doctorId})` : ""}${u.disabled ? ", отключён" : ""}, создан ${u.createdAt.slice(0, 10)}`,
      );
  } else if (!login || !/^[a-zA-Z0-9._-]{3,64}$/.test(login)) {
    fail(
      "Укажите логин: латиница, цифры, точка, дефис, подчёркивание (3–64 символа).",
    );
  } else if (command === "role") {
    const user = store.admin.findUser(login);
    if (!user) fail(`Сотрудника «${login}» нет.`);
    const { role, doctorId } = roleFromArgs(user.role);
    if (
      user.role === "owner" &&
      role !== "owner" &&
      !user.disabled &&
      store.admin.countActiveOwners() <= 1
    )
      fail("Это последний владелец: сначала назначьте другого.");
    store.admin.setRole(user.id, role, doctorId);
    store.admin.audit(null, "staff.role", "admin_user", user.id, now);
    console.log(
      `Роль «${login}»: ${ROLE_TITLES[role]}. Сессии сотрудника завершены.`,
    );
  } else if (command === "create" || command === "password") {
    const exists = store.admin.findUser(login);
    if (command === "create" && exists) fail(`Сотрудник «${login}» уже есть.`);
    if (command === "password" && !exists) fail(`Сотрудника «${login}» нет.`);
    const access =
      command === "create"
        ? roleFromArgs(store.admin.countUsers() === 0 ? "owner" : "admin")
        : null;
    const password = await readPassword();
    const problem = passwordProblem(password, login);
    if (problem) fail(problem);
    const hash = await hashPassword(password);
    if (command === "create") {
      store.admin.createUser(login, hash, now, access!.role, access!.doctorId);
      console.log(
        `Сотрудник «${login}» (${ROLE_TITLES[access!.role]}) создан. Вход: /admin/login`,
      );
    } else {
      store.admin.setPassword(login, hash);
      console.log(`Пароль «${login}» изменён, все его сессии завершены.`);
    }
  } else if (command === "disable" || command === "enable") {
    const user = store.admin.findUser(login);
    if (!user) fail(`Сотрудника «${login}» нет.`);
    if (
      command === "disable" &&
      user.role === "owner" &&
      !user.disabled &&
      store.admin.countActiveOwners() <= 1
    )
      fail("Это последний владелец: сначала назначьте другого.");
    store.admin.setDisabled(login, command === "disable", now);
    console.log(
      command === "disable"
        ? `Вход для «${login}» отключён.`
        : `Вход для «${login}» включён.`,
    );
  } else {
    fail("Команды: create, password, role, disable, enable, list.");
  }
} finally {
  store.close();
}
