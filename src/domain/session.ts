import type { StoredSession } from "./secrets";
import type { WorkspaceChoice } from "./types";

export const ACCOUNT_EXPIRED_MESSAGE = "登录已过期，请重新登录。";
export const NO_WORKSPACE_MESSAGE = "这个账号还没有工作区。";

export type LaunchPlan =
  | { action: "login"; message: string }
  | { action: "pick"; workspaces: WorkspaceChoice[] }
  | { action: "enter"; workspace: WorkspaceChoice };

export function findWorkspace(workspaces: WorkspaceChoice[], idOrUrl: string | null | undefined): WorkspaceChoice | null {
  const key = idOrUrl?.trim() ?? "";
  if (!key) return null;
  return workspaces.find((workspace) => workspace.url === key || workspace.id === key) ?? null;
}

export function mapAccountWorkspace(raw: {
  uuid?: unknown;
  name?: unknown;
  url?: unknown;
  isDisabled?: unknown;
}): WorkspaceChoice | null {
  if (raw.isDisabled === true) return null;
  const id = typeof raw.uuid === "string" ? raw.uuid.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !url) return null;
  return { id, url, name: name || url };
}

export function planSessionLaunch(input: {
  stored: StoredSession | null;
  workspaces: WorkspaceChoice[];
  accountInvalid?: boolean;
}): LaunchPlan {
  if (input.accountInvalid) {
    return { action: "login", message: ACCOUNT_EXPIRED_MESSAGE };
  }
  if (input.workspaces.length === 0) {
    return { action: "login", message: NO_WORKSPACE_MESSAGE };
  }
  if (!input.stored?.workspace) {
    return { action: "pick", workspaces: input.workspaces };
  }
  const match = findWorkspace(input.workspaces, input.stored.workspace);
  if (!match) {
    return { action: "pick", workspaces: input.workspaces };
  }
  return { action: "enter", workspace: match };
}

export class AccountSessionError extends Error {
  readonly code = "account-session" as const;
  constructor(message = ACCOUNT_EXPIRED_MESSAGE) {
    super(message);
    this.name = "AccountSessionError";
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function isAccountTokenInvalid(error: unknown): boolean {
  if (error instanceof AccountSessionError) return true;
  const message = errorText(error).toLowerCase();
  return /登录已过期|令牌无效|token invalid|invalid token|unauthoriz|unauthoris|forbidden|not authenticated|authentication failed|invalid password|login failed|status code 401| 401\b/.test(
    message,
  );
}

export function isRenewableWorkspaceFailure(error: unknown): boolean {
  const message = errorText(error).toLowerCase();
  return /expired|token|unauthoriz|unauthoris|forbidden|not authenticated|websocket|status code 401| 401\b|workspace .* not found|workspacenotfound/.test(
    message,
  );
}

export async function withWorkspaceRenewal<T>(options: {
  run: () => Promise<T>;
  renew: () => Promise<void>;
}): Promise<T> {
  try {
    return await options.run();
  } catch (error) {
    if (!isRenewableWorkspaceFailure(error)) throw error;
    try {
      await options.renew();
      return await options.run();
    } catch (renewed) {
      if (isAccountTokenInvalid(renewed) || isAccountTokenInvalid(error)) {
        throw new AccountSessionError();
      }
      throw renewed;
    }
  }
}
