import { describe, expect, it } from "vitest";
import {
  fieldErrors,
  formDataToInput,
  normalizePhone,
  RequestFormSchema,
} from "@/requests/schema";

const valid = {
  name: "Анна",
  company: "",
  contactMethod: "email",
  contact: "Anna@Example.com",
  message: "Нужно автоматизировать обработку счетов.",
  consent: true,
  solutionId: "",
  packageId: "",
};

const errorsOf = (input: Record<string, unknown>) => {
  const r = RequestFormSchema.safeParse(input);
  return r.success ? {} : fieldErrors(r.error);
};

describe("RequestFormSchema", () => {
  it("принимает минимальную корректную заявку и нормализует данные", () => {
    const r = RequestFormSchema.parse(valid);
    expect(r.contact).toBe("anna@example.com");
    expect(r.company).toBeUndefined();
    expect(r.solutionId).toBeUndefined();
  });

  it("телефон: принимает форматы с пробелами и скобками, хранит цифры", () => {
    const r = RequestFormSchema.parse({
      ...valid,
      contactMethod: "phone",
      contact: "+7 (900) 123-45-67",
    });
    expect(r.contact).toBe("+79001234567");
  });

  it.each([
    ["короткое имя", { name: "А" }, "name"],
    ["пустое описание", { message: "   " }, "message"],
    ["короткое описание", { message: "коротко" }, "message"],
    ["нет согласия", { consent: false }, "consent"],
    ["неверный email", { contact: "not-an-email" }, "contact"],
    [
      "неверный телефон",
      { contactMethod: "phone", contact: "12-34" },
      "contact",
    ],
    ["пустой контакт", { contact: "" }, "contact"],
    ["неизвестный способ связи", { contactMethod: "fax" }, "contactMethod"],
    ["слишком длинная компания", { company: "x".repeat(151) }, "company"],
  ])("отклоняет: %s", (_, patch, field) => {
    expect(errorsOf({ ...valid, ...patch })).toHaveProperty(field);
  });

  it("ошибка контакта видна одновременно с другими ошибками", () => {
    const errors = errorsOf({ ...valid, name: "", contact: "bad" });
    expect(Object.keys(errors).sort()).toEqual(["contact", "name"]);
  });

  it("отклоняет лишние поля", () => {
    expect(
      RequestFormSchema.safeParse({ ...valid, role: "admin" }).success,
    ).toBe(false);
  });

  it("normalizePhone", () => {
    expect(normalizePhone(" +7 (900) 1-2 ")).toBe("+790012");
  });
});

describe("formDataToInput", () => {
  it("читает поля и флажок согласия", () => {
    const fd = new FormData();
    fd.set("name", "Анна");
    fd.set("consent", "on");
    const input = formDataToInput(fd);
    expect(input.name).toBe("Анна");
    expect(input.consent).toBe(true);
    expect(input.contact).toBe("");
  });

  it("игнорирует посторонние поля FormData", () => {
    const fd = new FormData();
    fd.set("isAdmin", "true");
    expect(formDataToInput(fd)).not.toHaveProperty("isAdmin");
  });
});
