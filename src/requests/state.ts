import type { RequestField } from "@/requests/schema";
import type { IntakeMode } from "@/requests/store";

/** Состояние формы после отправки — только то, что нужно интерфейсу. */
export type SubmitState =
  | { status: "idle" }
  | {
      status: "invalid";
      fieldErrors: Partial<Record<RequestField, string>>;
      message: string;
    }
  | { status: "too_fast"; message: string }
  | { status: "rate_limited"; message: string }
  | { status: "error"; message: string }
  | { status: "accepted"; mode: IntakeMode; reference: string };

export const INITIAL_STATE: SubmitState = { status: "idle" };
