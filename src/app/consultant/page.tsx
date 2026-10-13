import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Подобрать с ИИ" };

export default function Page() {
  return (
    <ComingSoon
      title="Подобрать с ИИ"
      text="ИИ-консультант по подбору решений появится на одном из следующих этапов."
    />
  );
}
