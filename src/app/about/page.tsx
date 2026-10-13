import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "О компании" };

export default function Page() {
  return (
    <ComingSoon
      title="О компании"
      text="Раздел о компании появится на одном из следующих этапов."
    />
  );
}
