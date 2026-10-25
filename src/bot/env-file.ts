/**
 * Меняет или добавляет переменные в тексте .env, сохраняя остальные строки и
 * комментарии. Значения не экранируются: ключи VK и OpenAI не содержат пробелов.
 */
export function upsertEnv(
  text: string,
  values: Record<string, string>,
): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const rest = new Map(Object.entries(values));
  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !rest.has(match[1])) return line;
    const value = rest.get(match[1])!;
    rest.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  while (updated.length > 0 && updated.at(-1) === "") updated.pop();
  for (const [key, value] of rest) updated.push(`${key}=${value}`);
  return `${updated.join("\n")}\n`;
}
