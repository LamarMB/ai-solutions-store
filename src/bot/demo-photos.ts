import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqliteStore } from "@/bot/storage/sqlite";

/**
 * Демо-портреты для вымышленной клиники «Демо-Мед». Изображения созданы ИИ и
 * не изображают реальных сотрудников; в приложении они подписаны как
 * демонстрационные. Привязка — только по команде (`npm run doctors:demo-photos`)
 * и только к врачу, у которого совпадают и id, и имя из начальных данных, —
 * чтобы не приписать чужое лицо врачу настоящей клиники.
 */
export const DEMO_DOCTOR_PHOTOS: {
  doctorId: string;
  name: string;
  file: string;
}[] = [
  { doctorId: "testova", name: "Анна Тестова", file: "anna-testova.webp" },
  { doctorId: "primerov", name: "Павел Примеров", file: "pavel-primerov.webp" },
  {
    doctorId: "demonstrova",
    name: "Мария Демонстрова",
    file: "maria-demonstrova.webp",
  },
  { doctorId: "maketov", name: "Игорь Макетов", file: "igor-maketov.webp" },
  {
    doctorId: "obraztsova",
    name: "Елена Образцова",
    file: "elena-obraztsova.webp",
  },
  { doctorId: "vymyslov", name: "Олег Вымыслов", file: "oleg-vymyslov.webp" },
];

export const DEMO_PHOTOS_DIR = join(
  process.cwd(),
  "assets",
  "demo-doctor-photos",
);

export type DemoPhotoResult = {
  doctorId: string;
  result: "set" | "kept" | "skipped_name" | "missing_doctor" | "invalid";
};

export function bindDemoPhotos(
  store: SqliteStore,
  at: string,
  {
    force = false,
    dir = DEMO_PHOTOS_DIR,
  }: { force?: boolean; dir?: string } = {},
): DemoPhotoResult[] {
  const doctors = store.clinic.load().doctors;
  return DEMO_DOCTOR_PHOTOS.map(({ doctorId, name, file }) => {
    const doctor = doctors.find((d) => d.id === doctorId);
    if (!doctor) return { doctorId, result: "missing_doctor" };
    if (doctor.name !== name) return { doctorId, result: "skipped_name" };
    // Загруженное в панели фото не заменяется без --force.
    if (!force && store.photos.meta(doctorId))
      return { doctorId, result: "kept" };
    const saved = store.photos.set(
      doctorId,
      readFileSync(join(dir, file)),
      "demo_ai",
      at,
      null,
    );
    return { doctorId, result: saved.ok ? "set" : "invalid" };
  });
}
