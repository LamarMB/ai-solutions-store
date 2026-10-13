import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Как мы работаем" };

export default function Page() {
  return (
    <ComingSoon
      title="Как мы работаем"
      text="Описание порядка работы появится на одном из следующих этапов."
    />
  );
}
