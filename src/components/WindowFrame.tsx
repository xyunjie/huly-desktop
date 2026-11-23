import type { ReactNode } from "react";
import { isTauri } from "@/platform/runtime";
import { UpdateCheckButton } from "./UpdateCheckButton";

export function WindowFrame({ actions, utilities, children }: { actions?: ReactNode; utilities?: ReactNode; children: ReactNode }) {
  const overlay = isTauri();
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
      <header className={`hd-window-toolbar${overlay ? " hd-window-toolbar-native" : ""}`} data-tauri-drag-region>
        {overlay ? null : (
          <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#febc2e" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#28c840" }} />
          </div>
        )}
        {actions}
        {utilities || overlay ? (
          <div className="hd-window-utilities">
            {utilities}
            {overlay ? <UpdateCheckButton /> : null}
          </div>
        ) : null}
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
