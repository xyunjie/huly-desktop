import { Button, Checkbox, Collapse, Form, Input, Segmented, Typography } from "antd";
import { useEffect, useState } from "react";
import { validateLogin, type LoginDraft } from "@/domain/login";
import { redactSecrets } from "@/domain/secrets";
import { DEFAULT_SERVER_URL } from "@/domain/types";

export function LoginScreen({
  mock,
  busy,
  error,
  initialCa = "",
  onEnter,
}: {
  mock: boolean;
  busy: boolean;
  error: string | null;
  initialCa?: string;
  onEnter: (draft: LoginDraft, cert: { caPem: string; trustServerCert: boolean }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LoginDraft>({
    serverUrl: DEFAULT_SERVER_URL,
    method: "password",
    email: "",
    password: "",
    token: "",
    mock,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [caPem, setCaPem] = useState(initialCa);
  const [trustServerCert, setTrustServerCert] = useState(false);

  useEffect(() => {
    setDraft((current) => ({ ...current, mock }));
  }, [mock]);

  useEffect(() => {
    if (initialCa) setCaPem((current) => current || initialCa);
  }, [initialCa]);

  function update<K extends keyof LoginDraft>(key: K, value: LoginDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function enter() {
    setLocalError(null);
    const checked = validateLogin(draft);
    if (!checked.ok) {
      setLocalError(redactSecrets(checked.message, [draft.password, draft.token]));
      return;
    }
    void onEnter(draft, { caPem, trustServerCert });
  }

  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", overflow: "auto", background: "#f7f8fa", padding: 24 }}>
      <Form
        layout="vertical"
        requiredMark={false}
        style={{ width: 400, background: "#fff", border: "1px solid #f0f0f0", borderRadius: 8, padding: "32px 32px 20px" }}
        onFinish={enter}
      >
        <img src="/favicon.svg" width={48} height={48} alt="" style={{ display: "block", margin: "0 auto 10px" }} />
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4, textAlign: "center" }}>
          Huly Desk
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: "center", marginBottom: 24 }}>
          登录
        </Typography.Paragraph>
        <Segmented
          block
          value={draft.method}
          onChange={(value) => update("method", value as LoginDraft["method"])}
          options={[
            { label: "邮箱密码", value: "password" },
            { label: "API key（令牌）", value: "token" },
          ]}
        />
        {draft.method === "password" ? (
          <>
            <Form.Item label="邮箱" style={{ marginTop: 16, marginBottom: 12 }}>
              <Input
                type="email"
                autoComplete="username"
                aria-label="邮箱"
                placeholder="邮箱@example.com"
                value={draft.email}
                onChange={(event) => update("email", event.target.value)}
              />
            </Form.Item>
            <Form.Item label="密码" style={{ marginBottom: 16 }}>
              <Input.Password
                autoComplete="current-password"
                aria-label="密码"
                value={draft.password}
                onChange={(event) => update("password", event.target.value)}
              />
            </Form.Item>
          </>
        ) : (
          <Form.Item label="API key（令牌）" style={{ marginTop: 16, marginBottom: 16 }}>
            <Input.Password autoComplete="off" aria-label="API key（令牌）" value={draft.token} onChange={(event) => update("token", event.target.value)} />
          </Form.Item>
        )}
        {localError || error ? (
          <Typography.Paragraph type="danger" role="alert">
            {redactSecrets(localError || error || "", [draft.password, draft.token])}
          </Typography.Paragraph>
        ) : null}
        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" htmlType="button" data-testid="login-submit" block size="large" loading={busy} onClick={enter}>
            登录
          </Button>
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: "advanced",
              label: "高级设置",
              children: (
                <>
                  <Form.Item label="服务器地址" style={{ marginBottom: 12 }}>
                    <Input
                      value={draft.serverUrl}
                      spellCheck={false}
                      onChange={(event) => update("serverUrl", event.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label="证书" style={{ marginBottom: 8 }}>
                    <Input.TextArea
                      value={caPem}
                      onChange={(event) => setCaPem(event.target.value)}
                      placeholder="可选：粘贴 CA 或服务器证书 PEM"
                      autoSize={{ minRows: 3, maxRows: 6 }}
                    />
                  </Form.Item>
                  <Checkbox checked={trustServerCert} onChange={(event) => setTrustServerCert(event.target.checked)}>
                    信任此地址的证书（仅用于本次连接）
                  </Checkbox>
                </>
              ),
            },
          ]}
        />
      </Form>
    </div>
  );
}
