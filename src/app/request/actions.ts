"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { getSolutions } from "@/catalog";
import {
  createIdempotencyCache,
  createRateLimiter,
} from "@/requests/rate-limit";
import { handleSubmission } from "@/requests/service";
import type { SubmitState } from "@/requests/state";
import { getRequestStore } from "@/requests/store";
import { createClientKeyHasher } from "@/lib/client-key";

// Состояние в памяти процесса (см. ограничения в docs/requests.md).
const limiter = createRateLimiter({ limit: 8, windowMs: 10 * 60 * 1000 });
const idempotency = createIdempotencyCache<SubmitState>({
  ttlMs: 30 * 60 * 1000,
});
const hashClientKey = createClientKeyHasher();

async function clientKey(): Promise<string> {
  return hashClientKey(await headers());
}

/** Server Action формы заявки. Next.js проверяет Origin (CSRF) и размер тела. */
export async function submitRequest(
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  return handleSubmission(formData, {
    store: getRequestStore(),
    limiter,
    idempotency,
    solutions: getSolutions(),
    clientKey: await clientKey(),
    now: Date.now,
    newId: randomUUID,
    log: (message) => console.info(message),
  });
}
