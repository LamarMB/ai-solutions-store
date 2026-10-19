import type { Metadata } from "next";
import { requirePage } from "@/admin/server";
import { Doctors } from "@/components/admin/Doctors";

export const metadata: Metadata = { title: "Врачи" };

export default async function DoctorsPage() {
  await requirePage("doctors.read");
  return <Doctors />;
}
