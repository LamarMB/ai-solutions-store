import type { Metadata } from "next";
import { Dashboard } from "@/components/admin/Dashboard";

export const metadata: Metadata = { title: "Главная" };

export default function AdminHomePage() {
  return <Dashboard />;
}
