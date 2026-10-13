import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Отрасли" };

export default function Page() {
  return (
    <ComingSoon
      title="Отрасли"
      text="Подборки решений по отраслям появятся вместе с каталогом."
    />
  );
}
