import type { Metadata } from "next";
import { requirePage } from "@/admin/server";
import { Staff } from "@/components/admin/Staff";

export const metadata: Metadata = { title: "Сотрудники" };

export default async function StaffPage() {
  const session = await requirePage("staff.manage");
  return <Staff currentLogin={session.login} />;
}
