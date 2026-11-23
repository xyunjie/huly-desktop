import { CheckCircleFilled, LinkOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Alert, Button, Popconfirm, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { PageTitle } from "./PageTitle";
import { addMcpToClient, getMcpClientStatus, getMcpConfig, isMcpDesktop, regenerateMcpToken, type McpClientStatus, type McpConfig } from "@/mcp/bridge";

const CLIENTS = [
  { key: "claude-code", name: "Claude Code" },
  { key: "codex", name: "Codex" },
  { key: "opencode", name: "OpenCode" },
  { key: "cursor", name: "Cursor" },
];

const STATUS = {
  missing: { label: "未配置", color: "default" },
  current: { label: "配置与服务一致", color: "success" },
  stale: { label: "需要更新", color: "warning" },
  invalid: { label: "无法读取配置", color: "error" },
};

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 88, flex: "none", color: "#8e8e93", fontSize: 13, lineHeight: "32px" }}>{children}</div>
  );
}

function Row({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "10px 20px", borderBottom: last ? "none" : "1px solid #f0f0f0", alignItems: "center" }}>
      {children}
    </div>
  );
}

function Card({ children, testid }: { children: React.ReactNode; testid?: string }) {
  return (
    <section
      data-testid={testid}
      style={{ background: "#fff", border: "1px solid #ececee", borderRadius: 10, overflow: "hidden" }}
    >
      {children}
    </section>
  );
}

export function McpPage() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageTitle>MCP 管理</PageTitle>
      <div style={{ padding: "20px", maxWidth: 860, width: "100%", margin: "0 auto", display: "grid", gap: 20, alignContent: "start", overflow: "auto" }}>
        <McpSettings />
      </div>
    </div>
  );
}

function McpSettings() {
  const desktop = isMcpDesktop();
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, McpClientStatus | undefined>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getMcpConfig().then(
      (next) => { if (active) setConfig(next); },
      (reason: unknown) => { if (active) setError(errorText(reason)); },
    );
    return () => { active = false; };
  }, [desktop]);

  const url = config ? `http://127.0.0.1:${config.port}/mcp` : "";
  const shortToken = config ? `${config.token.slice(0, 10)}…${config.token.slice(-4)}` : "";
  const busy = spinning || adding !== null;

  function refreshStatuses() {
    setStatuses({});
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    if (!config) return;
    let active = true;
    void Promise.all(CLIENTS.map(async ({ key }) => {
      try {
        return [key, await getMcpClientStatus(key)] as const;
      } catch (reason) {
        return [key, { state: "invalid", path: "", note: errorText(reason) } satisfies McpClientStatus] as const;
      }
    })).then((entries) => { if (active) setStatuses(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [config, revision]);

  async function rotateToken() {
    setSpinning(true);
    try {
      const next = await regenerateMcpToken();
      setStatuses({});
      setError(null);
      setConfig(next);
      message.success("旧令牌已失效。请更新已配置的客户端。");
    } catch (reason) {
      message.error(errorText(reason));
    } finally {
      setSpinning(false);
    }
  }

  if (!desktop) return <Alert type="info" message="MCP 服务仅在 Huly Desk 桌面端可用。" />;

  return (
    <div style={{ display: "grid", gap: 24 }} data-testid="mcp-settings">
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <RobotOutlined style={{ fontSize: 20, color: "#6366f1" }} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          MCP 服务
        </Typography.Title>
        {config ? <Tag icon={<CheckCircleFilled />} color="success">运行中</Tag>
          : error ? <Tag color="error">不可用</Tag> : <Tag>正在读取服务状态</Tag>}
      </header>

      {error ? <Alert showIcon type="error" message="无法使用 MCP 服务" description={error} /> : null}

      <Card testid="mcp-server-card">
        <Row>
          <Label>说明</Label>
          <Typography.Text type="secondary">
            让本机 AI 客户端读取当前工作区的任务、修改状态和添加评论。请保持 Huly Desk 打开并连接工作区；不要分享令牌或含令牌的配置文件。
          </Typography.Text>
        </Row>
        <Row>
          <Label>服务地址</Label>
          <Typography.Text copyable={url ? { text: url } : false} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
            {url || "—"}
          </Typography.Text>
        </Row>
        <Row>
          <Label>访问令牌</Label>
          <Typography.Text copyable={config && !spinning ? { text: config.token } : false} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
            {shortToken || "—"}
          </Typography.Text>
          <Popconfirm title="重新生成 MCP 令牌？" description="旧令牌会立即失效，已配置的客户端需要更新。" okText="确认轮换" cancelText="取消" onConfirm={rotateToken}>
            <Button size="small" icon={<ReloadOutlined aria-hidden />} loading={spinning} disabled={busy || (!config && !error)} style={{ marginLeft: "auto" }}>
              重新生成
            </Button>
          </Popconfirm>
        </Row>
        <Row last>
          <Label>可用工具</Label>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            list_projects、list_issues、get_issue（只读）；update_issue_status、add_comment（写入）
          </Typography.Text>
        </Row>
      </Card>

      <div>
        <Typography.Title level={5} style={{ marginBottom: 4 }}>
          AI 客户端
        </Typography.Title>
        <Typography.Text type="secondary">
          点击「一键添加」即可配置，修改已有配置前会自动备份。
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined aria-hidden />}
            style={{ padding: "0 4px", height: "auto" }}
            disabled={!config || busy}
            onClick={refreshStatuses}
          >
            刷新状态
          </Button>
        </Typography.Text>
      </div>

      <Card testid="mcp-clients-card">
        {CLIENTS.map((client, index) => {
          const status = statuses[client.key];
          const badge = status && STATUS[status.state];
          return (
            <div key={client.key} style={{ borderBottom: index === CLIENTS.length - 1 ? "none" : "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontWeight: 600 }}>{client.name}</span>
                    <span title={status?.path}
                      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: "#8e8e93", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {status?.path}
                    </span>
                    {badge ? (
                      <Tag
                        color={badge.color}
                        style={{ marginInlineEnd: 0, fontSize: 12 }}
                      >
                        {badge.label}
                      </Tag>
                    ) : null}
                  </div>
                  {status?.note ? <Typography.Text type="danger">{status.note}</Typography.Text> : null}
                </div>
                <Button
                  size="small"
                  type="primary"
                  icon={<LinkOutlined aria-hidden />}
                  loading={adding === client.key}
                  disabled={busy || !status || status.state === "current" || status.state === "invalid"}
                  onClick={async () => {
                    setAdding(client.key);
                    try {
                      const result = await addMcpToClient(client.key);
                      message.success(result);
                    } catch (reason) {
                      message.error(errorText(reason));
                    } finally {
                      refreshStatuses();
                      setAdding(null);
                    }
                  }}
                >
                  {status?.state === "stale" ? "更新配置" : "一键添加"}
                </Button>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
