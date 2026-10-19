import type { RedFlag } from "@/bot/conversation/safety";
import type { ComplaintArea } from "@/bot/conversation/triage";

/** Подписи для врача. Это слова пациента, разобранные правилами, — не диагноз. */
export const MEDICAL_AREA_TITLES: Record<ComplaintArea, string> = {
  joint: "суставы, спина, травмы",
  dental: "зубы",
  ent: "ухо, горло, нос",
  child: "ребёнок",
  general: "общее недомогание",
};

export const RED_FLAG_TITLES: Record<RedFlag, string> = {
  deformity: "заметная деформация",
  cannot_bear_weight: "трудно наступать или двигать",
  severe_swelling: "сильный отёк",
  heavy_bleeding: "сильное кровотечение",
  sudden_numbness: "внезапное онемение или слабость",
  severe_trauma: "серьёзная травма",
  chest_pain: "боль или давление в груди",
  breathing_difficulty: "затруднённое дыхание",
  fainting: "потеря сознания",
  stroke_signs: "признаки инсульта",
};
