import { CheckCircleFilled, DownOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { PageTitle } from "./PageTitle";
import { getMcpConfig, regenerateMcpToken, type McpConfig } from "@/mcp/bridge";

interface ClientSpec {
  key: string;
  name: string;
  desc: string;
  path: string;
  build: (url: string, token: string) => string;
}

const CLIENTS: ClientSpec[] = [
  {
    key: "claude-code",
    name: "Claude Code",
    desc: "通过命令行添加（用户级，所有项目可用）",
    path: "终端执行",
    build: (url, token) => `claude mcp add --transport http huly-desk ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    key: "codex",
    name: "Codex",
    desc: "直接写入配置文件（修改前建议备份）",
    path: "~/.codex/config.toml",
    build: (url, token) => `[mcp_servers.huly_desk]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`,
  },
  {
    key: "opencode",
    name: "OpenCode",
    desc: "直接写入配置文件",
    path: "opencode.json",
    build: (url, token) =>
      `{\n  "mcp": {\n    "huly-desk": {\n      "type": "remote",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }\n    }\n  }\n}`,
  },
  {
    key: "cursor",
    name: "Cursor",
    desc: "直接写入配置文件",
    path: "~/.cursor/mcp.json",
    build: (url, token) => JSON.stringify({ mcpServers: { "huly-desk": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
  {
    key: "claude-desktop",
    name: "Claude Desktop",
    desc: "直接写入配置文件（修改前建议备份）",
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
    build: (url, token) => JSON.stringify({ mcpServers: { "huly-desk": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
  {
    key: "windsurf",
    name: "Windsurf",
    desc: "直接写入配置文件",
    path: "~/.codeium/windsurf/mcp_config.json",
    build: (url, token) => JSON.stringify({ mcpServers: { "huly-desk": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
];

function copy(text: string, label: string) {
  void navigator.clipboard.writeText(text);
  message.success(`已复制${label}。`);
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
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void getMcpConfig().then(setConfig);
  }, []);

  const url = config?.port ? `http://127.0.0.1:${config.port}/mcp` : "";
  const shortToken = config ? `${config.token.slice(0, 10)}…${config.token.slice(-4)}` : "";

  return (
    <div style={{ display: "grid", gap: 24 }} data-testid="mcp-settings">
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <RobotOutlined style={{ fontSize: 20, color: "#6366f1" }} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          MCP 服务
        </Typography.Title>
        {config ? (
          config.port ? (
            <Tag icon={<CheckCircleFilled />} color="success">
              运行中
            </Tag>
          ) : (
            <Tag color="orange">正在启动</Tag>
          )
        ) : (
          <Tag>仅桌面端可用</Tag>
        )}
      </header>

      <Card testid="mcp-server-card">
        <Row>
          <Label>说明</Label>
          <Typography.Text type="secondary">
            让 AI 客户端读取任务、修改状态和添加评论。服务只监听本机 127.0.0.1，令牌保存在系统钥匙串。
          </Typography.Text>
        </Row>
        <Row>
          <Label>服务地址</Label>
          <Typography.Text copyable={{ text: url }} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
            {url || "—"}
          </Typography.Text>
        </Row>
        <Row>
          <Label>访问令牌</Label>
          <Typography.Text copyable={{ text: config?.token ?? "" }} style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}>
            {shortToken || "—"}
          </Typography.Text>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={spinning}
            style={{ marginLeft: "auto" }}
            onClick={async () => {
              setSpinning(true);
              const next = await regenerateMcpToken();
              if (next) {
                setConfig(next);
                message.success("已重新生成令牌，旧令牌立即失效。");
              } else {
                message.error("生成失败。");
              }
              setSpinning(false);
            }}
          >
            重新生成
          </Button>
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
        <Typography.Text type="secondary">选择你使用的客户端，复制配置加入对应文件后即可连接。</Typography.Text>
      </div>

      <Card testid="mcp-clients-card">
        {CLIENTS.map((client, index) => {
          const open = expanded === client.key;
          return (
            <div key={client.key} style={{ borderBottom: index === CLIENTS.length - 1 ? "none" : "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontWeight: 600 }}>{client.name}</span>
                    <span
                      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: "#8e8e93", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {client.path}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>{client.desc}</div>
                </div>
                <Button size="small" type="text" onClick={() => copy(config && url ? client.build(url, config.token) : "", client.name)}>
                  复制配置
                </Button>
                <Button
                  size="small"
                  type="text"
                  aria-label={`${open ? "收起" : "展开"} ${client.name} 配置`}
                  aria-expanded={open}
                  icon={<DownOutlined style={{ fontSize: 10, transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }} />}
                  onClick={() => setExpanded(open ? null : client.key)}
                />
              </div>
              {open && config && url ? (
                <pre
                  style={{
                    margin: "0 20px 12px",
                    padding: "10px 12px",
                    background: "#fafafa",
                    border: "1px solid #f0f0f0",
                    borderRadius: 8,
                    fontSize: 12,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {client.build(url, config.token)}
                </pre>
              ) : null}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
