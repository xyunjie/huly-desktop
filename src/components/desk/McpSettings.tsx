import { CheckOutlined, CopyOutlined, ReloadOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Tooltip, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { getMcpConfig, regenerateMcpToken, type McpConfig } from "@/mcp/bridge";

const SNIPPETS: Record<string, (url: string, token: string) => string> = {
  "Claude Code": (url, token) => `claude mcp add --transport http huly-desk ${url} --header "Authorization: Bearer ${token}"`,
  "OpenCode / Codex（config）": (url, token) =>
    [
      "/* opencode.json */",
      '{ "mcp": { "huly-desk": { "type": "remote", "url": "' + url + '", "headers": { "Authorization": "Bearer ' + token + '" } } } }',
    ].join("\n"),
  "Codex Desktop（config.toml）": (url, token) =>
    [
      "# ~/.codex/config.toml",
      "[mcp_servers.huly_desk]",
      `url = "${url}"`,
      `http_headers = { "Authorization" = "Bearer ${token}" }`,
    ].join("\n"),
  "Cursor / 其他 MCP 客户端": (url, token) =>
    JSON.stringify({ mcpServers: { "huly-desk": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
};

export function McpSettings() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    void getMcpConfig().then(setConfig);
  }, []);

  const url = config ? `http://127.0.0.1:${config.port}/mcp` : "";

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="mcp-settings">
      <Space>
        <RobotOutlined />
        <Typography.Text strong>AI 助手（MCP）</Typography.Text>
        {config ? <Tag color="green">运行中 · 127.0.0.1:{config.port}</Tag> : <Tag>仅桌面端可用</Tag>}
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        让 Claude Code、Codex、OpenCode 等 AI 工具通过本地 MCP 服务读取任务、修改状态和添加评论。服务只监听本机。
      </Typography.Paragraph>
      {config ? (
        <>
          {Object.entries(SNIPPETS).map(([label, build]) => (
            <div key={label} style={{ display: "grid", gap: 4 }}>
              <Typography.Text type="secondary">{label}</Typography.Text>
              <Space align="start" style={{ width: "100%" }}>
                <Typography.Text
                  code
                  copyable={false}
                  style={{ whiteSpace: "pre-wrap", flex: 1, maxWidth: 320 }}
                >
                  {build(url, config.token)}
                </Typography.Text>
                <Tooltip title="复制">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label={`复制 ${label} 配置`}
                    onClick={() => {
                      void navigator.clipboard.writeText(build(url, config.token));
                      message.success("已复制。");
                    }}
                  />
                </Tooltip>
              </Space>
            </div>
          ))}
          <Space>
            <Button
              icon={<ReloadOutlined />}
              loading={spinning}
              onClick={async () => {
                setSpinning(true);
                const next = await regenerateMcpToken();
                if (next) {
                  setConfig(next);
                  message.success("已重新生成令牌。旧令牌立即失效。");
                } else {
                  message.error("生成失败。");
                }
                setSpinning(false);
              }}
            >
              重新生成令牌
            </Button>
            <Typography.Text type="secondary">
              <CheckOutlined /> 令牌保存在系统钥匙串
            </Typography.Text>
          </Space>
        </>
      ) : null}
    </div>
  );
}
