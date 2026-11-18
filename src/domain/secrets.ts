const SECRET_KEYS = ["password", "token", "passwd", "authorization", "secret"];

export interface StoredSession {
  serverUrl: string;
  workspace: string;
  workspaceName?: string;
  email: string;
  /** Account token from login() or an API key. Never a password. */
  token: string;
}

/** JSON stored in the macOS keychain. Password is never part of this object. */
export function buildSessionSecret(input: {
  serverUrl: string;
  workspace: string;
  workspaceName?: string;
  email?: string;
  token: string;
}): string {
  const payload: StoredSession = {
    serverUrl: input.serverUrl,
    workspace: input.workspace,
    email: input.email ?? "",
    token: input.token,
  };
  if (input.workspaceName?.trim()) payload.workspaceName = input.workspaceName.trim();
  return JSON.stringify(payload);
}

export function parseSessionSecret(raw: string): StoredSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("钥匙串里的登录信息无法读取。");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("钥匙串里的登录信息无法读取。");
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === "password" || key.toLowerCase() === "passwd") {
      throw new Error("钥匙串里的登录信息格式不正确。");
    }
  }
  const serverUrl = typeof record.serverUrl === "string" ? record.serverUrl : "";
  const workspace = typeof record.workspace === "string" ? record.workspace : "";
  const workspaceName = typeof record.workspaceName === "string" ? record.workspaceName : undefined;
  const email = typeof record.email === "string" ? record.email : "";
  const token = typeof record.token === "string" ? record.token : "";
  if (!serverUrl || !workspace || !token) {
    throw new Error("钥匙串里的登录信息不完整。");
  }
  const stored: StoredSession = { serverUrl, workspace, email, token };
  if (workspaceName?.trim()) stored.workspaceName = workspaceName.trim();
  return stored;
}

export function redactSecrets(message: string, extraSecrets: string[] = []): string {
  let output = message;
  const secrets = extraSecrets.filter((value) => value.trim().length >= 4);
  for (const secret of secrets) {
    output = output.split(secret).join("[redacted]");
  }
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
  output = output.replace(
    new RegExp(`(${SECRET_KEYS.join("|")})(["']?\\s*[:=]\\s*["']?)[^\\s"',}]+`, "gi"),
    "$1$2[redacted]",
  );
  return output;
}

export function safeErrorMessage(error: unknown, extraSecrets: string[] = []): string {
  const raw = error instanceof Error ? error.message : "操作失败。";
  const cleaned = redactSecrets(raw, extraSecrets).trim();
  return cleaned || "操作失败。";
}
