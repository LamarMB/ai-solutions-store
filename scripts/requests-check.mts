/**
 * Проверка приёма заявок на сервере: две проверочные заявки — от формы на главной
 * и от страницы /request — проходят тот же обработчик, что и формы сайта
 * (src/requests/service.ts), и уходят в Telegram по настройкам из .env.local.
 *
 *   npx tsx scripts/requests-check.mts
 *
 * Данные заявок — проверочные, без персональных данных. Токен и контакты не выводятся.
 */
import { randomUUID } from "node:crypto";
import { getSolutions } from "@/catalog";
import { privacyPolicyFromEnv } from "@/content/privacy";
import { loadLocalEnv } from "@/bot/env";
import {
  createIdempotencyCache,
  createRateLimiter,
} from "@/requests/rate-limit";
import { DEMO_FORM, FORM_KIND_FIELD, SERVICE_FIELDS } from "@/requests/schema";
import { handleSubmission } from "@/requests/service";
import type { SubmitState } from "@/requests/state";
import { requestStoreFromEnv } from "@/requests/store";

loadLocalEnv();
const policy = privacyPolicyFromEnv(process.env);
const store = requestStoreFromEnv(process.env, policy !== null);
if (store.mode !== "live") {
  const missing = [
    "REQUESTS_TELEGRAM_BOT_TOKEN",
    "REQUESTS_TELEGRAM_CHAT_ID",
    "PRIVACY_OPERATOR_NAME",
    "PRIVACY_OPERATOR_INN",
    "PRIVACY_OPERATOR_EMAIL",
  ].filter((k) => !process.env[k]?.trim());
  console.log(
    `Приём заявок выключен (тестовый режим). ${missing.length ? `Не заданы: ${missing.join(", ")}.` : "Проверьте формат ИНН (10 или 12 цифр) и email оператора."}`,
  );
  process.exit(1);
}

const forms: [string, Record<string, string>][] = [
  [
    "форма на главной",
    {
      [FORM_KIND_FIELD]: DEMO_FORM,
      solutionId: "clinic-ai-administrator",
      message: "",
    },
  ],
  [
    "страница /request",
    { message: "Проверочная заявка: проверка доставки, ответа не требует." },
  ],
];

let failed = 0;
for (const [label, extra] of forms) {
  const fd = new FormData();
  const fields: Record<string, string> = {
    name: "Проверка доставки",
    company: "Проверка — не клиент",
    contactMethod: "telegram",
    contact: "@delivery_check",
    consent: "on",
    [SERVICE_FIELDS.honeypot]: "",
    [SERVICE_FIELDS.startedAt]: String(Date.now() - 10_000),
    [SERVICE_FIELDS.submissionId]: randomUUID(),
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const state: SubmitState = await handleSubmission(fd, {
    store,
    limiter: createRateLimiter({ limit: 10, windowMs: 60_000 }),
    idempotency: createIdempotencyCache<SubmitState>({ ttlMs: 60_000 }),
    solutions: getSolutions(),
    clientKey: "requests-check",
    now: Date.now,
    newId: randomUUID,
    log: () => {},
  });
  if (state.status === "accepted" && state.mode === "live") {
    console.log(`  ${label}: доставлено в Telegram (номер ${state.reference})`);
  } else {
    failed += 1;
    console.log(
      `  ${label}: НЕ доставлено — ${"message" in state ? state.message : state.status}`,
    );
  }
}
process.exit(failed ? 1 : 0);
