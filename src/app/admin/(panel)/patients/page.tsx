import type { Metadata } from "next";
import { requirePage } from "@/admin/server";
import { Patients } from "@/components/admin/Patients";

export const metadata: Metadata = { title: "Данные пациента" };

export default async function PatientsPage() {
  await requirePage("patient_data.manage");
  return <Patients />;
}
