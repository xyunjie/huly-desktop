import { CloudDownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Modal, Progress, Space, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdates, installUpdate, type UpdateCheck, type UpdateProgress } from "@/platform/runtime";

function updateError(reason: unknown, fallback: string) {
  const text = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : fallback;
  return /^Command (check_for_updates|install_update) not found\.?$/.test(text)
    ? "桌面后台仍在运行旧版本。请退出并重新启动 Huly Desk 后再试。"
    : text;
}

export function UpdateCheckButton() {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const checkInFlight = useRef(false);

  const check = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      setResult(await checkForUpdates());
    } catch (reason) {
      setError(updateError(reason, "无法检查更新，请稍后重试。"));
    } finally {
      checkInFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const updateVersion = result?.updateAvailable ? result.latestVersion : null;
  const installable = updateVersion !== null && !result?.installUnavailable;
  const buttonLabel = updateVersion ? "发现新版本" : "检查更新";

  async function install() {
    if (!updateVersion || !installable || progress) return;
    setError(null);
    setProgress({ phase: "downloading", downloaded: 0, total: null });
    try {
      await installUpdate(updateVersion, setProgress);
    } catch (reason) {
      setError(updateError(reason, "安装更新失败，请重试。"));
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <Button
        size="small"
        type={updateVersion ? "default" : "text"}
        icon={<CloudDownloadOutlined />}
        title={buttonLabel}
        aria-label={buttonLabel}
        disabled={!!progress}
        onClick={() => {
          setOpen(true);
          if (!installable || error) void check();
        }}
      >
        {updateVersion ? buttonLabel : null}
      </Button>
      <Modal
        open={open}
        title="检查更新"
        closable={!progress}
        keyboard={!progress}
        maskClosable={!progress}
        onCancel={() => { if (!progress) setOpen(false); }}
        footer={[
          <Button key="close" disabled={!!progress} onClick={() => setOpen(false)}>关闭</Button>,
          installable ? (
            <Button key="download" type="primary" loading={!!progress} onClick={() => void install()}>
              下载并安装
            </Button>
          ) : error && !result ? (
            <Button key="retry" type="primary" onClick={() => void check()}>重试</Button>
          ) : null,
        ]}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {checking ? <Typography.Text role="status">正在检查更新</Typography.Text> : null}
          {result ? (
            <>
              <Typography.Text>当前版本：v{result.currentVersion}</Typography.Text>
              {updateVersion ? (
                <Alert type={installable ? "info" : "warning"} showIcon message={`发现新版本 v${updateVersion}`}
                  description={result.installUnavailable ?? "安装完成后应用会自动重启，请先保存手头的工作。"} />
              ) : (
                <Typography.Text role="status">{result.latestVersion ? "当前版本无需更新。" : "GitHub 暂无公开正式版。"}</Typography.Text>
              )}
            </>
          ) : null}
          {progress?.phase === "downloading" ? (
            <>
              <Typography.Text role="status">正在下载更新…</Typography.Text>
              {progress.total ? <Progress aria-label="下载更新进度" percent={Math.min(100, Math.floor(progress.downloaded * 100 / progress.total))} status="active" /> : null}
            </>
          ) : progress?.phase === "installing" ? <Typography.Text role="status">正在安装，即将重启…</Typography.Text> : null}
          {error ? <Alert type="error" showIcon message={error} /> : null}
        </Space>
      </Modal>
    </>
  );
}
