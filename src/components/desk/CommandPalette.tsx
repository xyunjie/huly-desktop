import { Input, List, Modal, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { buildCommands, filterCommands } from "@/domain/commands";
import type { Issue } from "@/domain/types";

export function CommandPalette({
  open,
  issues,
  view,
  onOpenChange,
  onRun,
}: {
  open: boolean;
  issues: Issue[];
  view: "list" | "board";
  onOpenChange: (open: boolean) => void;
  onRun: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => filterCommands(buildCommands(issues, view), query), [issues, view, query]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  return (
    <Modal open={open} title="命令面板" footer={null} onCancel={() => onOpenChange(false)} destroyOnHidden>
      <Input
        autoFocus
        value={query}
        placeholder="输入命令或任务编号…"
        onChange={(event) => setQuery(event.target.value)}
        style={{ marginBottom: 8 }}
      />
      <List
        size="small"
        dataSource={commands}
        locale={{ emptyText: "没有匹配的命令。" }}
        style={{ maxHeight: 360, overflow: "auto" }}
        renderItem={(command) => (
          <List.Item
            style={{ cursor: "pointer" }}
            onClick={() => {
              onRun(command.id);
              onOpenChange(false);
            }}
            extra={command.hint ? <Typography.Text type="secondary">{command.hint}</Typography.Text> : null}
          >
            {command.title}
          </List.Item>
        )}
      />
    </Modal>
  );
}
