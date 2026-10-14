import type { SolutionInput } from "@/catalog/schema";
import { clinicAiAdministrator } from "@/content/solutions/clinic-ai-administrator";
import { crmAiIntegration } from "@/content/solutions/crm-ai-integration";
import { documentDataExtraction } from "@/content/solutions/document-data-extraction";
import { aiAccountingDepartment } from "@/content/solutions/ai-accounting-department";
import { documentReconciliation } from "@/content/solutions/document-reconciliation";
import { patientRequestRouting } from "@/content/solutions/patient-request-routing";
import { aiSalesManager } from "@/content/solutions/ai-sales-manager";
import { leadQualification } from "@/content/solutions/lead-qualification";
import { restaurantOrderAssistant } from "@/content/solutions/restaurant-order-assistant";
import { restaurantSalesAnalytics } from "@/content/solutions/restaurant-sales-analytics";
import { corporateKnowledgeSearch } from "@/content/solutions/corporate-knowledge-search";
import { aiRecruiter } from "@/content/solutions/ai-recruiter";
import { hrAssistant } from "@/content/solutions/hr-assistant";

/** Все решения каталога. Новое решение добавляется отдельным файлом и сюда. */
export const solutions = [
  clinicAiAdministrator,
  documentDataExtraction,
  crmAiIntegration,
  aiAccountingDepartment,
  documentReconciliation,
  patientRequestRouting,
  aiSalesManager,
  leadQualification,
  restaurantOrderAssistant,
  restaurantSalesAnalytics,
  corporateKnowledgeSearch,
  aiRecruiter,
  hrAssistant,
] satisfies SolutionInput[];
