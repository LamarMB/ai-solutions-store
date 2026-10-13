import type { SolutionInput } from "@/catalog/schema";
import { clinicAiAdministrator } from "@/content/solutions/clinic-ai-administrator";
import { crmAiIntegration } from "@/content/solutions/crm-ai-integration";
import { documentDataExtraction } from "@/content/solutions/document-data-extraction";

/** Все решения каталога. Новое решение добавляется отдельным файлом и сюда. */
export const solutions = [
  clinicAiAdministrator,
  documentDataExtraction,
  crmAiIntegration,
] satisfies SolutionInput[];
