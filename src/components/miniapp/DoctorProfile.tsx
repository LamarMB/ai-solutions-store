"use client";

import { useState } from "react";
import { DoctorPortrait } from "@/components/miniapp/art";
import { SlotPicker } from "@/components/miniapp/BookingFlow";
import { rub, type ClinicInfo, type Doctor } from "@/components/miniapp/client";
import { MaIcon } from "@/components/miniapp/icons";
import { Button, Card, StickyFooter, TopBar } from "@/components/miniapp/ui";

/**
 * Карточка врача: только данные клиники из базы (имя, направление, описание,
 * стоимость и длительность приёма) и реальное свободное время. Стажа, рейтингов
 * и отзывов в базе нет — они не показываются.
 */
export function DoctorProfile({
  clinic,
  doctor,
  onBack,
  onBook,
}: {
  clinic: ClinicInfo;
  doctor: Doctor;
  onBack: () => void;
  onBook: (slot: { date?: string; time?: string }) => void;
}) {
  const [slot, setSlot] = useState<{ date: string; time: string }>();
  return (
    <div className="miniapp-screen flex min-h-dvh flex-col">
      <div className="bg-hero rounded-b-[32px]">
        <TopBar onBack={onBack} transparent />
        <div className="flex justify-center pt-2 pb-8">
          <DoctorPortrait
            name={doctor.name}
            specialtyId={doctor.specialtyId}
            size="lg"
          />
        </div>
      </div>
      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        <Card raised className="-mt-5 p-5">
          <h1 className="font-display text-[1.625rem] leading-tight font-semibold break-words">
            {doctor.name}
          </h1>
          <p className="text-accent mt-1 font-semibold">{doctor.specialty}</p>
          {doctor.about && (
            <p className="text-small text-muted mt-3">{doctor.about}</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="bg-surface-2 rounded-field p-3">
              <p className="text-caption text-muted">Стоимость приёма</p>
              <p className="mt-0.5 font-semibold">
                {doctor.priceRub !== null ? rub(doctor.priceRub) : "Уточняйте"}
              </p>
            </div>
            <div className="bg-surface-2 rounded-field p-3">
              <p className="text-caption text-muted">Длительность</p>
              <p className="mt-0.5 font-semibold">{doctor.slotMinutes} мин</p>
            </div>
          </div>
        </Card>

        <h2 className="mt-8 mb-3 text-[1.125rem] font-semibold">
          Ближайшее время для записи
        </h2>
        <SlotPicker
          doctor={doctor}
          today={clinic.today}
          value={slot}
          onChange={setSlot}
        />
        <p className="text-caption text-muted mt-4 flex gap-2">
          <MaIcon name="shield" size={16} className="shrink-0" />
          Демо: врач и расписание вымышленные. Свободное время — из расписания
          клиники в реальном времени.
        </p>
      </main>
      <StickyFooter>
        <Button size="lg" block onClick={() => onBook(slot ?? {})}>
          {slot ? `Записаться на ${slot.time}` : "Записаться"}
        </Button>
      </StickyFooter>
    </div>
  );
}
