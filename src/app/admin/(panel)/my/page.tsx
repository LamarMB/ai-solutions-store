import type { Metadata } from "next";
import { adminDeps, requirePage } from "@/admin/server";
import { MyAppointments } from "@/components/admin/MyAppointments";

export const metadata: Metadata = { title: "Мои приёмы" };

export default async function MyPage() {
  await requirePage("own_bookings.read");
  return <MyAppointments today={adminDeps().service.today()} />;
}
