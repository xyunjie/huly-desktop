import { Typography } from "antd";
import type { ReactNode } from "react";
import { isTauri } from "@/platform/runtime";
import { UpdateCheckButton } from "./UpdateCheckButton";

export function WindowFrame({ status, children }: { status?: ReactNode; children: ReactNode }) {
  const overlay = isTauri();
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
      <header
        data-tauri-drag-region
        style={{
          height: 36,
          flex: "none",
          display: "flex",
          alignItems: "center",
          paddingLeft: overlay ? 84 : 16,
          paddingRight: 12,
          borderBottom: "1px solid #f0f0f0",
          userSelect: "none",
          gap: 12,
        }}
      >
        {overlay ? null : (
          <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 8, height: 28 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
          </div>
        )}
        <Typography.Text type="secondary" data-tauri-drag-region style={{ lineHeight: "36px", fontSize: 12 }}>
          Huly Desk
        </Typography.Text>
        {status || overlay ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            {status}
            {overlay ? <UpdateCheckButton /> : null}
          </div>
        ) : null}
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}
