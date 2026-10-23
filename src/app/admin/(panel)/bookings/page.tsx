import type { Metadata } from "next";
import { Suspense } from "react";
import { adminDeps, requirePage } from "@/admin/server";
import { Bookings } from "@/components/admin/Bookings";

export const metadata: Metadata = { title: "Записи" };

export default async function BookingsPage() {
  await requirePage("bookings.read");
  return (
    <Suspense>
      <Bookings today={adminDeps().service.today()} />
    </Suspense>
  );
}
