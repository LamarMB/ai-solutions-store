"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { getSolutions } from "@/catalog";
import { getChatProvider } from "@/consultant/provider";
import {
  handleConsultantMessage,
  type ConsultantResponse,
} from "@/consultant/service";
import { createRateLimiter } from "@/requests/rate-limit";

const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });
const salt = randomBytes(16);

async function clientKey(): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  return createHash("sha256").update(salt).update(ip).digest("hex");
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
