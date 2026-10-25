import type { Metadata } from "next";
import { InviteForm } from "@/components/admin/InviteForm";

export const metadata: Metadata = { title: "Приглашение" };

export default function InvitePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="border-border bg-surface rounded-panel w-full max-w-sm border p-6 sm:p-8">
        <h1 className="text-h2 font-semibold">Приглашение в панель</h1>
        <p className="text-small text-muted mt-1 mb-6">
          Задайте пароль для своей учётной записи. Ссылка одноразовая.
        </p>
        <InviteForm />
      </div>
    </main>
  );
}
