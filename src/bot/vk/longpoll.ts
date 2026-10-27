import { FATAL_VK_CODES, sleep, VkApiError, type VkApi } from "@/bot/vk/api";

export type VkUpdate = {
  type: string;
  object: Record<string, unknown>;
  group_id?: number;
  event_id?: string;
};

type Server = { server: string; key: string; ts: string };

export type LongPollOptions = {
  api: VkApi;
  groupId: number;
  onUpdate: (update: VkUpdate) => Promise<void>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  /** Сколько секунд сервер держит запрос, если событий нет. */
  waitSeconds?: number;
  maxBackoffMs?: number;
  /** Вызывается после каждого успешного ответа сервера — для отметки «бот на связи». */
  onPoll?: () => void;
  /**
   * Параллельная обработка: событие передаётся в очередь и не ждёт
   * предыдущих (порядок одного пациента обеспечивает очередь). Промис —
   * завершение обработки. Без dispatch — строго по одному через onUpdate.
   */
  dispatch?: (update: VkUpdate) => Promise<void>;
  /** Обратное давление: следующий запрос событий — когда в очереди есть место. */
  waitForCapacity?: (signal: AbortSignal) => Promise<void>;
  /** ts, с которого продолжить после перезапуска (сохранённый onCommit). */
  initialTs?: string;
  /**
   * ts, до которого все события обработаны полностью, — его можно сохранить:
   * после перезапуска необработанные события придут снова.
   */
  onCommit?: (ts: string) => void;
};

/**
 * Цикл Bots Long Poll. Восстанавливается сам:
 * - failed 1 — обновить ts; failed 2 — новый ключ, прежний ts; failed 3 — новый ключ и ts;
 * - сеть или сервер недоступны — пауза с ростом до maxBackoffMs, затем новый ключ
 *   с прежним ts, чтобы получить события, накопившиеся за время обрыва.
 * Останавливается по signal или при ошибке доступа (неверный токен, нет прав).
 */
export async function runLongPoll(
  options: LongPollOptions,
  signal: AbortSignal,
): Promise<void> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const pause = options.sleep ?? sleep;
  const log = options.log ?? (() => {});
  const wait = options.waitSeconds ?? 25;
  const maxBackoff = options.maxBackoffMs ?? 60_000;
  let server: Server | undefined;
  let ts: string | undefined = options.initialTs;
  let backoff = 1000;
  // Пачки в обработке: ts фиксируется, когда пачка и все предыдущие завершены.
  const batches: { ts: string; pending: number }[] = [];
  const commit = () => {
    let last: string | undefined;
    while (batches.length > 0 && batches[0].pending === 0)
      last = batches.shift()!.ts;
    if (last !== undefined) options.onCommit?.(last);
  };

  while (!signal.aborted) {
    try {
      if (!server) {
        const fresh = await options.api.call<Server>(
          "groups.getLongPollServer",
          {
            group_id: options.groupId,
          },
        );
        server = fresh;
        ts ??= String(fresh.ts);
        log("long poll: connected");
      }
      const url = `${server.server}?act=a_check&key=${encodeURIComponent(server.key)}&ts=${encodeURIComponent(ts!)}&wait=${wait}`;
      const response = await doFetch(url, {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout((wait + 10) * 1000),
        ]),
      });
      if (!response.ok) throw new Error(`long poll http ${response.status}`);
      const body = (await response.json()) as {
        ts?: string | number;
        updates?: VkUpdate[];
        failed?: number;
      };
      if (body.failed === 1) {
        ts = String(body.ts);
        continue;
      }
      if (body.failed === 2) {
        server = undefined;
        continue;
      }
      if (body.failed === 3) {
        log("long poll: history lost, reconnecting");
        server = undefined;
        ts = undefined;
        continue;
      }
      backoff = 1000;
      options.onPoll?.();
      if (options.dispatch) {
        const updates = body.updates ?? [];
        const batch = {
          ts: body.ts !== undefined ? String(body.ts) : ts!,
          pending: updates.length,
        };
        batches.push(batch);
        for (const update of updates) {
          void options.dispatch(update).finally(() => {
            batch.pending -= 1;
            commit();
          });
        }
        commit();
        // Следующая пачка запрашивается сразу; сохраняется только ts
        // полностью обработанных пачек (onCommit).
        ts = batch.ts;
        await options.waitForCapacity?.(signal);
        continue;
      }
      for (const update of body.updates ?? []) {
        if (signal.aborted) break;
        await options.onUpdate(update);
      }
      // ts сдвигается только после обработки: при падении события придут снова.
      if (body.ts !== undefined) {
        ts = String(body.ts);
        options.onCommit?.(ts);
      }
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof VkApiError && FATAL_VK_CODES.has(error.code)) {
        throw error;
      }
      log(
        `long poll: ${error instanceof Error ? error.message : "error"}; retry in ${Math.round(backoff / 1000)} s`,
      );
      server = undefined;
      // Пауза прерывается остановкой бота.
      await Promise.race([
        pause(backoff),
        new Promise((resolve) =>
          signal.addEventListener("abort", resolve, { once: true }),
        ),
      ]);
      backoff = Math.min(backoff * 2, maxBackoff);
    }
  }
}
