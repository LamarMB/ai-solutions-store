/**
 * Хранилище заявок. Заявка — черновик заказа: позиции «решение + пакет»,
 * чтобы позже добавить корзину и оплату без переписывания.
 */
export type RequestItem = { solutionId: string; packageId: string | null };

export type RequestRecord = {
  id: string;
  createdAt: string;
  items: RequestItem[];
  contact: {
    name: string;
    company?: string;
    method: "email" | "phone";
    value: string;
  };
  message: string;
};

/** Режим приёма: test — данные проверяются, но не сохраняются и не передаются. */
export type IntakeMode = "test";

export interface RequestStore {
  readonly mode: IntakeMode;
  save(record: RequestRecord): Promise<void>;
}

/**
 * Тестовый адаптер: НЕ сохраняет и НЕ передаёт персональные данные.
 * Запоминает только число принятых заявок — для тестов и диагностики.
 */
export class TestRequestStore implements RequestStore {
  readonly mode = "test" as const;
  private accepted = 0;

  async save(record: RequestRecord): Promise<void> {
    void record; // данные намеренно отбрасываются
    this.accepted += 1;
  }

  get acceptedCount() {
    return this.accepted;
  }
}

let store: RequestStore | undefined;

/**
 * Текущее хранилище. Постоянное хранилище пока не настроено, поэтому всегда
 * тестовый адаптер. Подключение реального — отдельным решением (docs/requests.md).
 */
export function getRequestStore(): RequestStore {
  store ??= new TestRequestStore();
  return store;
}
