import type { Metadata } from "next";
import { requirePage } from "@/admin/server";
import { Requests } from "@/components/admin/Requests";

export const metadata: Metadata = { title: "Обращения" };

export default async function RequestsPage() {
  await requirePage("requests.handle");
  return <Requests />;
}
