import type { IndustryInput } from "@/catalog/schema";

export const industries = [
  {
    id: "retail",
    title: "Розница и e-commerce",
    description: "Магазины, интернет-магазины и маркетплейсы.",
  },
  {
    id: "logistics",
    title: "Логистика",
    description: "Перевозки, складская логистика и экспедирование.",
  },
  {
    id: "manufacturing",
    title: "Производство",
    description: "Промышленные и производственные предприятия.",
  },
  {
    id: "professional-services",
    title: "Профессиональные услуги",
    description: "Консалтинг, юридические, бухгалтерские и агентские услуги.",
  },
  {
    id: "education",
    title: "Образование",
    description: "Учебные центры, школы и онлайн-образование.",
  },
  {
    id: "healthcare",
    title: "Медицина и клиники",
    description: "Медицинские центры, клиники и частные практики.",
  },
] satisfies IndustryInput[];
