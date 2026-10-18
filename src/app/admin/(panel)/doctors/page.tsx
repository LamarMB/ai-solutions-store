import type { Metadata } from "next";
import { Doctors } from "@/components/admin/Doctors";

export const metadata: Metadata = { title: "Врачи" };

export default function DoctorsPage() {
  return <Doctors />;
}
