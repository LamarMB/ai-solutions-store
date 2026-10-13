import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("склеивает классы и пропускает пустые значения", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("возвращает пустую строку без классов", () => {
    expect(cn()).toBe("");
  });
});
