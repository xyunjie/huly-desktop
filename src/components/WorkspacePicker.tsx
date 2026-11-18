import { Button, Radio, Typography } from "antd";
import { useEffect, useState } from "react";
import type { WorkspaceChoice } from "@/domain/types";

export function WorkspacePicker({
  workspaces,
  busy,
  error,
  onEnter,
}: {
  workspaces: WorkspaceChoice[];
  busy: boolean;
  error: string | null;
  onEnter: (workspaceUrl: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(workspaces[0]?.url ?? "");

  useEffect(() => {
    setSelected((current) => (workspaces.some((workspace) => workspace.url === current) ? current : (workspaces[0]?.url ?? "")));
  }, [workspaces]);

  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", overflow: "auto", background: "#f7f8fa", padding: 24 }}>
      <div style={{ width: 400, background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: 32 }}>
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          选择工作区
        </Typography.Title>
        <Typography.Paragraph type="secondary">请选择进入后的默认工作区。</Typography.Paragraph>
        {workspaces.length === 0 ? (
          <Typography.Paragraph type="secondary">这个账号还没有工作区。</Typography.Paragraph>
        ) : (
          <Radio.Group
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}
          >
            {workspaces.map((workspace) => (
              <Radio
                key={workspace.id}
                value={workspace.url}
                style={{
                  margin: 0,
                  padding: "12px 16px",
                  border: workspace.url === selected ? "1px solid #1868db" : "1px solid #f0f0f0",
                  borderRadius: 6,
                  background: workspace.url === selected ? "#f0f5ff" : "#fff",
                }}
              >
                {workspace.name}
              </Radio>
            ))}
          </Radio.Group>
        )}
        {error ? (
          <Typography.Paragraph type="danger" role="alert" style={{ marginTop: 16 }}>
            {error}
          </Typography.Paragraph>
        ) : null}
        <Button
          type="primary"
          block
          size="large"
          style={{ marginTop: 24 }}
          loading={busy}
          disabled={!selected}
          onClick={() => void onEnter(selected)}
        >
          进入工作区
        </Button>
      </div>
    </div>
  );
}
