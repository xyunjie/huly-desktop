import type { AccountAuthInput, DataMode } from "./types";
import { normalizeServerUrl } from "./url";

export interface LoginDraft {
  serverUrl: string;
  method: "password" | "token";
  email: string;
  password: string;
  token: string;
  mock: boolean;
}

export type LoginResult = { ok: true; value: AccountAuthInput } | { ok: false; message: string };

export function validateLogin(draft: LoginDraft): LoginResult {
  try {
    const serverUrl = normalizeServerUrl(draft.serverUrl);
    if (draft.mock) {
      return { ok: true, value: { kind: "mock", serverUrl } };
    }
    if (draft.method === "password") {
      const email = draft.email.trim();
      if (!email || !email.includes("@")) {
        return { ok: false, message: "请填写有效的邮箱。" };
      }
      if (!draft.password) {
        return { ok: false, message: "请填写密码。密码不会写入钥匙串。" };
      }
      return { ok: true, value: { kind: "password", serverUrl, email, password: draft.password } };
    }
    const token = draft.token.trim();
    if (!token) {
      return { ok: false, message: "请填写 API key（令牌）。" };
    }
    return { ok: true, value: { kind: "token", serverUrl, token } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "无法校验登录信息。" };
  }
}

export function explainConnectionError(error: unknown, method?: LoginDraft["method"]): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.toLowerCase();
  if (/workspace .* not found|workspacenotfound|找不到这个工作区/.test(message)) {
    return "找不到这个工作区。";
  }
  if (/tfa|two.factor|两步验证/.test(message)) {
    return "该账号需要两步验证，请先在网页端完成后再登录。";
  }
  if (/登录已过期|令牌无效|token invalid|invalid token/.test(message)) {
    return "登录已过期，请重新登录。";
  }
  if (method === "password" && /account\s*not\s*found|invalid\s*password|wrong password|login failed/.test(message)) {
    return "用户名或密码错误";
  }
  if (/login failed|invalid password|unauthorized|密码/.test(message)) {
    return "登录没有通过。请检查邮箱和密码，或改用 API key（令牌）。";
  }
  if (/certificate|cert|tls|ssl|self.signed|unable to verify/.test(message)) {
    return "证书不受信任。若实例使用自签或内网 CA，请在高级设置中贴上 PEM，并在 Mac 的钥匙串中信任同一张证书。";
  }
  if (/failed to fetch config|config\.json|failed to fetch/.test(message)) {
    return "读不到服务器的 /config.json。请确认地址、端口，以及这台电脑能访问该实例。";
  }
  if (/network|econnrefused|enotfound|timed out|timeout|连接不到/.test(message)) {
    return "连接不到服务器。请确认地址和端口，以及 config.json 里的账户、协作地址从这台电脑也能访问。";
  }
  if (raw.trim()) return raw.trim();
  return "连接失败。";
}

export function initialDataMode(): DataMode {
  if (import.meta.env.VITE_HD_MOCK === "1" || import.meta.env.VITE_DATA_MODE === "mock") return "mock";
  if (typeof window !== "undefined") {
    try {
      if (new URLSearchParams(window.location.search).get("mock") === "1") return "mock";
    } catch {
      /* ignore malformed URLs */
    }
  }
  return "huly";
}
