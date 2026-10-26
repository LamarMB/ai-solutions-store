/**
 * Симулятор диалога в терминале — проверка записи без ВКонтакте.
 *
 *   npm run bot:sim                 собеседник 1, база .data/bot.sqlite
 *   npm run bot:sim -- --peer=2     другой собеседник (проверка двойной записи)
 *   npm run bot:sim -- --db=путь    другой файл базы
 *   npm run bot:sim -- --openai     разговор через OpenAI (ключ из .env.local)
 *
 * Номер — нажать кнопку, любой другой текст — сообщение боту, «выход» — завершить.
 */
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { createDemoBot, type Button, type Reply } from "@/bot";
import { createLogger, medicalCipherFromEnv } from "@/bot/config";
import { loadLocalEnv } from "@/bot/env";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const peerId = Number(arg("peer") ?? 1);
const dbPath = arg("db") ?? ".data/bot.sqlite";
loadLocalEnv();
const useOpenAi = process.argv.includes("--openai");
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (useOpenAi && !apiKey) {
  console.log("OPENAI_API_KEY не задан в .env.local — работаю по правилам.");
}
const openai =
  useOpenAi && apiKey
    ? {
        apiKey,
        model: process.env.OPENAI_MODEL?.trim() || "gpt-5.6-luna",
      }
    : undefined;
// Как у бота ВКонтакте (scripts/vk-bot.mts): с MEDICAL_DATA_KEY — обращения с
// согласием и шифрование разговоров, с VK_MINIAPP_ID — меню «Открыть приложение».
const cipher = medicalCipherFromEnv();
const miniApp = Boolean(process.env.VK_MINIAPP_ID?.trim());
const { bot, store } = createDemoBot({
  dbPath,
  openai,
  cipher,
  miniApp,
  log: createLogger("sim"),
});

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
console.log(
  `Симулятор бота · собеседник ${peerId} · база ${dbPath} · ${openai ? `OpenAI ${openai.model}` : "правила"} · ` +
    `обращения с согласием: ${cipher ? "да" : "нет (нет MEDICAL_DATA_KEY)"} · приложение: ${miniApp ? "да" : "нет"}`,
);
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
