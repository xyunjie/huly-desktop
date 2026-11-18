import type { ServerEndpoints } from "./types";

export function parseServerConfig(value: unknown): ServerEndpoints {
  if (!value || typeof value !== "object") {
    throw new Error("config.json 不是对象。");
  }
  const record = value as Record<string, unknown>;
  const accountsUrl = readUrl(record, "ACCOUNTS_URL");
  const collaboratorUrl = readUrl(record, "COLLABORATOR_URL");
  if (!accountsUrl || !collaboratorUrl) {
    throw new Error("config.json 缺少 ACCOUNTS_URL 或 COLLABORATOR_URL。");
  }
  return {
    accountsUrl,
    collaboratorUrl,
    filesUrl: readUrl(record, "FILES_URL"),
    uploadUrl: readUrl(record, "UPLOAD_URL"),
  };
}

function readUrl(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
