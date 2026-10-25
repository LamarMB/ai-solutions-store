/** Ошибка для сотрудника клиники: HTTP-статус и понятный текст. */
export class AdminError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}
