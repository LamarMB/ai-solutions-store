"use server";

import { headers } from "next/headers";
import { getSolutions } from "@/catalog";
import { getChatProvider } from "@/consultant/provider";
import {
  handleConsultantMessage,
  type ConsultantResponse,
} from "@/consultant/service";
import { createRateLimiter } from "@/requests/rate-limit";
import { createClientKeyHasher } from "@/lib/client-key";

const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });
const hashClientKey = createClientKeyHasher();

async function clientKey(): Promise<string> {
  return hashClientKey(await headers());
}

/** Server Action консультанта. История приходит с клиента и нигде не хранится. */
export async function askConsultant(
  history: unknown,
): Promise<ConsultantResponse> {
  return handleConsultantMessage(history, {
    provider: getChatProvider(),
    solutions: getSolutions(),
    limiter,
    clientKey: await clientKey(),
  });
}
