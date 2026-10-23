import type { Metadata } from "next";
import { Suspense } from "react";
import { adminDeps, requirePage } from "@/admin/server";
import { Schedule } from "@/components/admin/Schedule";

export const metadata: Metadata = { title: "Расписание" };

export default async function SchedulePage() {
  await requirePage("schedule.read");
  return (
    <Suspense>
      <Schedule today={adminDeps().service.today()} />
    </Suspense>
  );
}
