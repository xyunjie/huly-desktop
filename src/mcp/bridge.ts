import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeskClient } from "@/data/client";
import { dispatchMcp, type McpRequest } from "./dispatcher";

export interface McpConfig {
  port: number;
  token: string;
}

export function isMcpDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getMcpConfig(): Promise<McpConfig> {
  return invoke<McpConfig>("mcp_get_config");
}

export function regenerateMcpToken(): Promise<McpConfig> {
  return invoke<McpConfig>("mcp_regenerate_token");
}

export interface McpClientStatus {
  state: "missing" | "current" | "stale" | "invalid";
  path: string;
  note: string | null;
}

export function getMcpClientStatus(client: string): Promise<McpClientStatus> {
  return invoke<McpClientStatus>("mcp_client_status", { client });
}

export function addMcpToClient(client: string): Promise<string> {
  return invoke<string>("mcp_add_to_client", { client });
}

/**
 * Wire MCP requests from the Rust HTTP server to the dispatcher using the
 * live client. No-op outside Tauri (browser preview mode).
 */
export function connectMcpBridge(getWorkspace: () => { client: DeskClient } | null): () => void {
  if (!isMcpDesktop()) return () => undefined;
  let stopped = false;
  const ready = listen<{ seq: number; body: McpRequest }>("mcp-request", async ({ payload: { seq, body } }) => {
    if (stopped) return;
    const workspace = getWorkspace();
    const response = await dispatchMcp(body, workspace?.client ?? null, () => !stopped && workspace === getWorkspace());
    await invoke("mcp_respond", { seq, body: response }).catch(() => undefined);
  });
  void ready.then(() => stopped ? undefined : invoke("mcp_bind_window")).catch(() => undefined);
  return () => {
    stopped = true;
    void ready.then((unlisten) => unlisten(), () => undefined);
  };
}
