/**
 * Симулятор диалога в терминале — проверка записи без ВКонтакте.
 *
 *   npm run bot:sim                 собеседник 1, база .data/bot.sqlite
 *   npm run bot:sim -- --peer=2     другой собеседник (проверка двойной записи)
 *   npm run bot:sim -- --db=путь    другой файл базы
 *
 * Номер — нажать кнопку, любой другой текст — сообщение боту, «выход» — завершить.
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { createDemoBot, type Button, type Reply } from "@/bot";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const peerId = Number(arg("peer") ?? 1);
const dbPath = arg("db") ?? ".data/bot.sqlite";
const { bot, store } = createDemoBot({ dbPath });

let buttons: Button[] = [];

function print(replies: Reply[]) {
  for (const reply of replies) {
    console.log(`\n${reply.text}`);
    buttons = reply.buttons.flat();
    reply.buttons.forEach((row) => {
      console.log(
        "  " +
          row.map((b) => `[${buttons.indexOf(b) + 1}] ${b.label}`).join("   "),
      );
    });
  }
}

const rl = createInterface({ input: stdin, output: stdout, terminal: false });
console.log(`Симулятор бота · собеседник ${peerId} · база ${dbPath}`);
// Незавершённый диалог продолжается с того же шага (как после перезапуска бота).
print(await bot.handle(peerId, { type: "resume" }));
stdout.write("\n> ");

// Построчное чтение буферизует ввод: работает и вручную, и из файла.
for await (const line of rl) {
  const input = line.trim();
  if (["выход", "exit", "quit"].includes(input.toLowerCase())) break;
  if (input) {
    stdout.write(`${input}\n`);
    const index = Number(input);
    const button =
      Number.isInteger(index) && index >= 1 ? buttons[index - 1] : undefined;
    print(
      await bot.handle(
        peerId,
        button
          ? { type: "action", payload: button.action }
          : { type: "text", text: input },
      ),
    );
  }
  stdout.write("\n> ");
}
rl.close();
store.close();
