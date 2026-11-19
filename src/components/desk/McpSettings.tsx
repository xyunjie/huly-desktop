import { CopyOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Collapse, Space, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { PageTitle } from "./PageTitle";
import { getMcpConfig, regenerateMcpToken, type McpConfig } from "@/mcp/bridge";

const SNIPPETS: { label: string; build: (url: string, token: string) => string }[] = [
  {
    label: "Claude Code",
    build: (url, token) => `claude mcp add --transport http huly-desk ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    label: "OpenCode（opencode.json）",
    build: (url, token) =>
      `{\n  "mcp": {\n    "huly-desk": {\n      "type": "remote",\n      "url": "${url}",\n      "headers": { "Authorization": "Bearer ${token}" }\n    }\n  }\n}`,
  },
  {
    label: "Codex Desktop（~/.codex/config.toml）",
    build: (url, token) => `[mcp_servers.huly_desk]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`,
  },
  {
    label: "Cursor / 其他 MCP 客户端",
    build: (url, token) => JSON.stringify({ mcpServers: { "huly-desk": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
  },
];

function copy(text: string, label: string) {
  void navigator.clipboard.writeText(text);
  message.success(`已复制${label}。`);
}

export function McpPage() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PageTitle>MCP 管理</PageTitle>
      <div style={{ padding: "24px 20px", maxWidth: 720, display: "grid", gap: 16, alignContent: "start" }}>
        <McpSettings />
      </div>
    </div>
  );
}

function McpSettings() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    void getMcpConfig().then(setConfig);
  }, []);

  const url = config?.port ? `http://127.0.0.1:${config.port}/mcp` : "";
  const shortToken = config ? `${config.token.slice(0, 8)}…${config.token.slice(-4)}` : "";

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="mcp-settings">
      <Space>
        <RobotOutlined />
        <Typography.Text strong>AI 助手（MCP）</Typography.Text>
        {config ? (
          config.port ? (
            <Tag color="green">运行中</Tag>
          ) : (
            <Tag color="orange">正在启动</Tag>
          )
        ) : (
          <Tag>仅桌面端可用</Tag>
        )}
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        让 Claude Code、Codex、OpenCode 等 AI 工具读取任务、修改状态和添加评论。服务只监听本机 127.0.0.1。
      </Typography.Paragraph>
      {config && config.port ? (
        <>
          <div style={{ display: "grid", gap: 8 }}>
            <Space>
              <Typography.Text type="secondary">服务地址</Typography.Text>
              <Typography.Text copyable={{ text: url }}>{url}</Typography.Text>
            </Space>
            <Space>
              <Typography.Text type="secondary">访问令牌</Typography.Text>
              <Typography.Text copyable={{ text: config.token }}>{shortToken}</Typography.Text>
            </Space>
          </div>
          <Typography.Text type="secondary">客户端接入配置（点击展开，一键复制）</Typography.Text>
          <Collapse
            size="small"
            items={SNIPPETS.map(({ label, build }) => ({
              key: label,
              label,
              children: (
                <Space direction="vertical" style={{ width: "100%" }} size={8}>
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      background: "#fafafa",
                      border: "1px solid #f0f0f0",
                      borderRadius: 6,
                      fontSize: 12,
                      whiteSpace: "pre",
                      overflowX: "auto",
                    }}
                  >
                    {build(url, config.token)}
                  </pre>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copy(build(url, config.token), label)}>
                    复制{label}配置
                  </Button>
                </Space>
              ),
            }))}
          />
          <Space>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={spinning}
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
              重新生成令牌
            </Button>
            <Typography.Text type="secondary">令牌保存在系统钥匙串</Typography.Text>
          </Space>
        </>
      ) : null}
    </div>
  );
}
