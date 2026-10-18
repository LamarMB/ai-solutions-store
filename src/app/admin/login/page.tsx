import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/admin/server";
import { LoginForm } from "@/components/admin/LoginForm";

export const metadata: Metadata = { title: "Вход" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="border-border bg-surface rounded-panel w-full max-w-sm border p-6 sm:p-8">
        <h1 className="text-h2 font-semibold">Панель клиники</h1>
        <p className="text-small text-muted mt-1 mb-6">
          Вход для администраторов. Учётную запись создаёт владелец сервера.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
