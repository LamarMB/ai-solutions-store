import type { Metadata } from "next";
import { Suspense } from "react";
import { adminDeps } from "@/admin/server";
import { Bookings } from "@/components/admin/Bookings";

export const metadata: Metadata = { title: "Записи" };

export default function BookingsPage() {
  return (
    <Suspense>
      <Bookings today={adminDeps().service.today()} />
    </Suspense>
  );
}
