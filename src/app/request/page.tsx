import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Оставить заявку" };

export default function Page() {
  return (
    <ComingSoon
      title="Оставить заявку"
      text="Форма заявки на выбранное решение появится на одном из следующих этапов."
    />
  );
}
