import { describe, expect, it } from "vitest";
import { clientAddress, createClientKeyHasher } from "@/lib/client-key";

const h = (entries: Record<string, string>) => new Headers(entries);

describe("clientAddress", () => {
  it("берёт последний адрес из X-Forwarded-For — его добавил прокси", () => {
    expect(
      clientAddress(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 10.0.0.5" })),
    ).toBe("10.0.0.5");
  });

  it("подмена первого адреса клиентом не меняет ключ", () => {
    const hash = createClientKeyHasher(Buffer.from("salt"));
    const real = hash(h({ "x-forwarded-for": "203.0.113.7" }));
    for (const spoofed of ["1.1.1.1", "9.9.9.9", "evil"]) {
      expect(hash(h({ "x-forwarded-for": `${spoofed}, 203.0.113.7` }))).toBe(
        real,
      );
    }
  });

  it("без X-Forwarded-For — X-Real-IP, иначе общий ключ", () => {
    expect(clientAddress(h({ "x-real-ip": " 198.51.100.1 " }))).toBe(
      "198.51.100.1",
    );
    expect(clientAddress(h({}))).toBe("unknown");
    expect(clientAddress(h({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});

describe("createClientKeyHasher", () => {
  it("возвращает хэш, а не адрес; соль меняет ключ", () => {
    const headers = h({ "x-forwarded-for": "203.0.113.7" });
    const a = createClientKeyHasher(Buffer.from("a"))(headers);
    const b = createClientKeyHasher(Buffer.from("b"))(headers);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203.0.113.7");
    expect(a).not.toBe(b);
  });
});
