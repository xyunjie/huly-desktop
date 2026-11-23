import { Channel, invoke } from "@tauri-apps/api/core";
import { parseServerConfig } from "@/domain/config";
import { buildSessionSecret, parseSessionSecret, type StoredSession } from "@/domain/secrets";
import type { ServerEndpoints } from "@/domain/types";
import { configJsonUrl } from "@/domain/url";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  installUnavailable: string | null;
}

export type UpdateProgress =
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" };

export function checkForUpdates(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>("check_for_updates");
}

export function installUpdate(version: string, onProgress: (progress: UpdateProgress) => void): Promise<void> {
  const channel = new Channel<UpdateProgress>(onProgress);
  return invoke("install_update", { version, onProgress: channel });
}

export async function windowCommand(action: "close" | "minimize" | "toggleMaximize"): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();
  if (action === "close") await current.close();
  if (action === "minimize") await current.minimize();
  if (action === "toggleMaximize") await current.toggleMaximize();
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  if (!isTauri()) return null;
  try {
    const raw = await invoke<string | null>("keychain_load_session");
    if (!raw) return null;
    return parseSessionSecret(raw);
  } catch {
    return null;
  }
}

export async function saveStoredSession(input: {
  serverUrl: string;
  workspace: string;
  workspaceName?: string;
  email?: string;
  token: string;
}): Promise<"saved" | "unavailable"> {
  if (!input.token.trim()) return "unavailable";
  if (!isTauri()) return "unavailable";
  try {
    await invoke("keychain_save_session", { secret: buildSessionSecret(input) });
    return "saved";
  } catch {
    return "unavailable";
  }
}

export async function clearStoredSession(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("keychain_clear_session");
  } catch {
    /* The in-memory session is already dropped. */
  }
}

export async function loadStoredCa(): Promise<string> {
  if (!isTauri()) return "";
  try {
    return (await invoke<string | null>("keychain_load_ca")) ?? "";
  } catch {
    return "";
  }
}

export async function saveStoredCa(pem: string): Promise<void> {
  if (!isTauri()) return;
  const trimmed = pem.trim();
  if (!trimmed) {
    await invoke("keychain_clear_ca");
    return;
  }
  await invoke("keychain_save_ca", { pem: trimmed });
}

export async function probeServer(
  serverUrl: string,
  options: { caPem?: string; trustServerCert?: boolean },
): Promise<ServerEndpoints> {
  if (isTauri()) {
    return invoke<ServerEndpoints>("probe_server", {
      url: serverUrl,
      caPem: options.caPem?.trim() || null,
      trustServerCert: Boolean(options.trustServerCert),
    });
  }
  const response = await fetch(configJsonUrl(serverUrl));
  if (!response.ok) {
    throw new Error(`Failed to fetch config (${response.status})`);
  }
  return parseServerConfig(await response.json());
}
