import type { Metadata } from "next";
import { Suspense } from "react";
import { adminDeps } from "@/admin/server";
import { Schedule } from "@/components/admin/Schedule";

export const metadata: Metadata = { title: "Расписание" };

export default function SchedulePage() {
  return (
    <Suspense>
      <Schedule today={adminDeps().service.today()} />
    </Suspense>
  );
}
