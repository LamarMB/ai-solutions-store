import { Onest } from "next/font/google";

/** Onest — переменный шрифт с кириллицей; самохостится при сборке. */
export const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
  display: "swap",
});
