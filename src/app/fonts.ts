import { Lora, Onest } from "next/font/google";

/** Onest — переменный шрифт с кириллицей; самохостится при сборке. */
export const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
  display: "swap",
});

/** Lora — серифный шрифт заголовков VK Mini App клиники (кириллица). */
export const lora = Lora({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600"],
  variable: "--font-lora",
  display: "swap",
});
