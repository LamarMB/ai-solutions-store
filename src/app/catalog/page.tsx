import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Каталог" };

export default function Page() {
  return (
    <ComingSoon
      title="Каталог"
      text="Каталог ИИ-решений с фильтрами по категориям и отраслям появится на следующем этапе."
    />
  );
}
