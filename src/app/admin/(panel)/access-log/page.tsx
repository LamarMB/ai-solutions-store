import type { Metadata } from "next";
import { requirePage } from "@/admin/server";
import { AccessLog } from "@/components/admin/AccessLog";

export const metadata: Metadata = { title: "Журнал доступа" };

export default async function AccessLogPage() {
  await requirePage("medical_log.read");
  return <AccessLog />;
}
