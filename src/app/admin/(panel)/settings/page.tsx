import type { Metadata } from "next";
import { Settings } from "@/components/admin/Settings";

export const metadata: Metadata = { title: "Настройки" };

export default function SettingsPage() {
  return <Settings />;
}
