/** Read a value from a CJS Huly package whether Vite unwraps `default` or not. */
export function moduleBinding<T>(mod: unknown, key: string): T {
  if (!mod || (typeof mod !== "object" && typeof mod !== "function")) {
    throw new Error(`无法读取 Huly 模块导出 ${key}。`);
  }
  const record = mod as Record<string, unknown>;
  if (record[key] != null) return record[key] as T;
  const nested = record.default;
  if (nested && typeof nested === "object") {
    const value = (nested as Record<string, unknown>)[key];
    if (value != null) return value as T;
  }
  throw new Error(`Huly 模块缺少导出 ${key}。`);
}

export function readPlugin<T extends object>(mod: unknown): T {
  const visited = new Set<unknown>();
  let value = mod;
  while (value && typeof value === "object" && !visited.has(value)) {
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (record.class && typeof record.class === "object") return record as T;
    value = record.default;
  }
  throw new Error("无法读取 Huly 插件标识。");
}
