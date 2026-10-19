import type { Metadata } from "next";
import { requirePage } from "@/admin/server";
import { Dashboard } from "@/components/admin/Dashboard";

export const metadata: Metadata = { title: "Главная" };

export default async function AdminHomePage() {
  await requirePage("dashboard.read");
  return <Dashboard />;
}
