import { Typography } from "antd";
import type { ReactNode } from "react";
import { isTauri } from "@/platform/runtime";

export function WindowFrame({ status, children }: { status?: ReactNode; children: ReactNode }) {
  const overlay = isTauri();
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
      <header
        data-tauri-drag-region
        style={{
          height: 28,
          flex: "none",
          display: "flex",
          alignItems: "center",
          paddingLeft: overlay ? 80 : 12,
          paddingRight: 12,
          borderBottom: "1px solid #f0f0f0",
          userSelect: "none",
        }}
      >
        {overlay ? null : (
          <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 12, height: 28 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
          </div>
        )}
        <Typography.Text strong data-tauri-drag-region style={{ lineHeight: "28px" }}>
          Huly Desk
        </Typography.Text>
        {status ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>{status}</div>
        ) : null}
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
