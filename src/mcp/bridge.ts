import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DeskClient } from "@/data/client";
import { dispatchMcp, isMcpNotification, type McpRequest } from "./dispatcher";

export interface McpConfig {
  port: number;
  token: string;
}

export async function getMcpConfig(): Promise<McpConfig | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  try {
    return await invoke<McpConfig>("mcp_get_config");
  } catch {
    return null;
  }
}

export async function regenerateMcpToken(): Promise<McpConfig | null> {
  try {
    const token = await invoke<{ token: string }>("mcp_regenerate_token");
    const config = await getMcpConfig();
    return config ? { ...config, token: token.token } : null;
  } catch {
    return null;
  }
}

export interface McpClientStatus {
  installed: boolean;
  note: string;
}

export async function getMcpClientStatus(client: string): Promise<McpClientStatus | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  try {
    return await invoke<McpClientStatus>("mcp_client_status", { client });
  } catch {
    return null;
  }
}

/** One-click add: deep link / CLI / direct config write (with backup). */
export async function addMcpToClient(client: string, url: string, token: string): Promise<string> {
  return invoke<string>("mcp_add_to_client", { client, url, token });
}

/**
 * Wire MCP requests from the Rust HTTP server to the dispatcher using the
 * live client. No-op outside Tauri (browser preview mode).
 */
export function connectMcpBridge(getClient: () => DeskClient | null): () => void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return () => undefined;
  let bound = false;
  const ready = (async () => {
    const unlisten = await listen<{ seq: number; body: McpRequest }>("mcp-request", async (event) => {
      const client = getClient();
      if (!client) {
        await invoke("mcp_respond", {
          seq: event.payload.seq,
          body: {
            jsonrpc: "2.0",
            id: event.payload.body.id ?? null,
            error: { code: -32002, message: "尚未连接工作区。" },
          },
        }).catch(() => undefined);
        return;
      }
      const response = await dispatchMcp(event.payload.body, client);
      if (!response && isMcpNotification(event.payload.body)) return;
      await invoke("mcp_respond", {
        seq: event.payload.seq,
        body: response ?? { jsonrpc: "2.0", id: event.payload.body.id ?? null, result: {} },
      }).catch(() => undefined);
    });
    await invoke("mcp_bind_window").catch(() => undefined);
    bound = true;
    return unlisten;
  })();
  return () => {
    void ready.then((unlisten) => {
      if (bound) unlisten();
    });
  };
}
