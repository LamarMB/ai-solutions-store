import {
  isActiveDoctor,
  type Clinic,
  type Specialty,
} from "@/bot/clinic/types";
import type { ComplaintArea } from "@/bot/conversation/triage";

/**
 * Направления клиники — только из справочника (панель → «Врачи»). Здесь —
 * словарь врачебных специальностей: как пациент называет специалиста и как
 * специальность обычно называется в справочнике. Есть ли такой специалист в
 * клинике, решает справочник и активные врачи, а не этот список.
 */
type Kind = {
  /** Как пациент называет специалиста (начала слов). */
  ask: readonly string[];
  /** Слова в названии специальности справочника (начала слов). */
  title: readonly string[];
  /** Подсказки для записи по правилам: «к зубному», «ребёнка» (не жалоба). */
  hint?: readonly string[];
  /** «нет кардиолога». */
  genitive: string;
  /** id направления демонстрационной клиники (начальные данные базы). */
  seedId?: string;
};

export const SPECIALTY_KINDS = {
  therapist: {
    ask: ["терапевт"],
    title: ["терапевт"],
    genitive: "терапевта",
    seedId: "therapist",
  },
  dentist: {
    ask: ["стоматолог", "дантист"],
    title: ["стоматолог", "дантист"],
    hint: ["зуб"],
    genitive: "стоматолога",
    seedId: "dentist",
  },
  pediatrician: {
    ask: ["педиатр"],
    title: ["педиатр"],
    hint: ["ребен", "детск", "дет"],
    genitive: "педиатра",
    seedId: "pediatrician",
  },
  ent: {
    ask: ["лор", "отоларинголог", "оториноларинголог"],
    title: ["лор", "отоларинголог", "оториноларинголог"],
    hint: ["ухо", "горл", "нос"],
    genitive: "оториноларинголога (ЛОР)",
    seedId: "ent",
  },
  orthopedist: {
    ask: ["ортопед", "травматолог"],
    title: ["ортопед", "травматолог"],
    genitive: "травматолога-ортопеда",
    seedId: "orthopedist",
  },
  cardiologist: {
    ask: ["кардиолог"],
    title: ["кардиолог"],
    genitive: "кардиолога",
  },
  gynecologist: {
    ask: ["гинеколог"],
    title: ["гинеколог"],
    genitive: "гинеколога",
  },
  dermatologist: {
    ask: ["дерматолог", "дерматовенеролог"],
    title: ["дерматолог", "дерматовенеролог"],
    genitive: "дерматолога",
  },
  ophthalmologist: {
    ask: ["окулист", "офтальмолог"],
    title: ["окулист", "офтальмолог"],
    genitive: "офтальмолога",
  },
  neurologist: {
    ask: ["невролог", "невропатолог"],
    title: ["невролог", "невропатолог"],
    genitive: "невролога",
  },
  urologist: {
    ask: ["уролог", "андролог"],
    title: ["уролог", "андролог"],
    genitive: "уролога",
  },
  surgeon: { ask: ["хирург"], title: ["хирург"], genitive: "хирурга" },
  psychologist: {
    ask: ["психолог"],
    title: ["психолог"],
    genitive: "психолога",
  },
  psychiatrist: {
    ask: ["психиатр", "психотерапевт"],
    title: ["психиатр", "психотерапевт"],
    genitive: "психиатра",
  },
  endocrinologist: {
    ask: ["эндокринолог"],
    title: ["эндокринолог"],
    genitive: "эндокринолога",
  },
  gastroenterologist: {
    ask: ["гастроэнтеролог"],
    title: ["гастроэнтеролог"],
    genitive: "гастроэнтеролога",
  },
  mammologist: {
    ask: ["маммолог"],
    title: ["маммолог"],
    genitive: "маммолога",
  },
  allergologist: {
    ask: ["аллерголог"],
    title: ["аллерголог"],
    genitive: "аллерголога",
  },
} as const satisfies Record<string, Kind>;
export type SpecialtyKind = keyof typeof SPECIALTY_KINDS;

/**
 * К какой специальности ведёт жалоба области — административная маршрутизация,
 * не диагноз. Нет такой специальности в справочнике — бот не придумывает
 * замену, а предлагает администратора.
 */
export const AREA_KIND: Record<ComplaintArea, SpecialtyKind> = {
  joint: "orthopedist",
  dental: "dentist",
  ent: "ent",
  child: "pediatrician",
  general: "therapist",
};

/** Слова без регистра, ё/е и дефисов: «Травматолог-ортопед» → два слова. */
const words = (text: string) =>
  text
    .toLowerCase()
    .replaceAll("ё", "е")
    .split(/[^a-zа-я0-9]+/)
    .filter(Boolean);
const startsAny = (list: string[], stems: readonly string[]) =>
  stems.some((stem) => list.some((w) => w.startsWith(stem)));

/** Слова названий специальностей, которые ничего не говорят о специалисте. */
const GENERIC_TITLE_WORDS = new Set([
  "врач",
  "врачи",
  "прием",
  "детский",
  "детская",
  "взрослый",
  "взрослая",
  "специалист",
  "консультация",
  "общей",
  "общий",
  "практики",
]);

/** Направления с принимающими (не отключёнными) врачами. */
export const activeSpecialties = (clinic: Clinic): Specialty[] =>
  clinic.specialties.filter((s) =>
    clinic.doctors.some((d) => d.specialtyId === s.id && isActiveDoctor(d)),
  );

/** Специальности справочника, подходящие под вид: по названию или id начальных данных. */
function specialtiesOfKind(clinic: Clinic, kind: SpecialtyKind): Specialty[] {
  const k: Kind = SPECIALTY_KINDS[kind];
  return clinic.specialties.filter(
    (s) => s.id === k.seedId || startsAny(words(s.title), k.title),
  );
}

/** Активное направление вида: первое в справочнике. */
export function specialtyForKind(
  clinic: Clinic,
  kind: SpecialtyKind,
): Specialty | undefined {
  const active = new Set(activeSpecialties(clinic).map((s) => s.id));
  return specialtiesOfKind(clinic, kind).find((s) => active.has(s.id));
}

/** Направление для области жалобы — только из справочника и только с врачами. */
export const specialtyForArea = (clinic: Clinic, area: ComplaintArea) =>
  specialtyForKind(clinic, AREA_KIND[area]);

/**
 * Специалист, которого пациент назвал в тексте, и есть ли он в клинике:
 * available — направление с принимающими врачами; inactive — направление в
 * справочнике есть, но все врачи отключены; absent — такого направления нет.
 */
export type RequestedSpecialty =
  | { status: "available"; specialty: Specialty }
  | { status: "inactive"; specialty: Specialty }
  | { status: "absent"; genitive: string };

export function requestedSpecialty(
  text: string,
  clinic: Clinic,
): RequestedSpecialty | undefined {
  const list = words(text);
  const active = new Set(activeSpecialties(clinic).map((s) => s.id));
  const verdict = (found: Specialty[]): RequestedSpecialty | undefined => {
    const live = found.find((s) => active.has(s.id));
    if (live) return { status: "available", specialty: live };
    if (found[0]) return { status: "inactive", specialty: found[0] };
    return undefined;
  };
  for (const kind of Object.keys(SPECIALTY_KINDS) as SpecialtyKind[]) {
    if (!startsAny(list, SPECIALTY_KINDS[kind].ask)) continue;
    return (
      verdict(specialtiesOfKind(clinic, kind)) ?? {
        status: "absent",
        genitive: SPECIALTY_KINDS[kind].genitive,
      }
    );
  }
  // Специальность, которой нет в словаре («Флеболог»), — по словам её названия.
  const own = clinic.specialties.filter((s) =>
    words(s.title).some(
      (w) =>
        w.length >= 6 &&
        !GENERIC_TITLE_WORDS.has(w) &&
        list.some((p) => p.startsWith(w.slice(0, -1))),
    ),
  );
  return verdict(own);
}

/**
 * Подсказка направления для записи по правилам («к стоматологу», «запишите
 * ребёнка») — только активное направление справочника.
 */
export function specialtyHint(
  text: string,
  clinic: Clinic,
): string | undefined {
  const requested = requestedSpecialty(text, clinic);
  if (requested) {
    return requested.status === "available"
      ? requested.specialty.id
      : undefined;
  }
  const list = words(text);
  for (const kind of Object.keys(SPECIALTY_KINDS) as SpecialtyKind[]) {
    const k: Kind = SPECIALTY_KINDS[kind];
    if (k.hint && startsAny(list, k.hint))
      return specialtyForKind(clinic, kind)?.id;
  }
  return undefined;
}
