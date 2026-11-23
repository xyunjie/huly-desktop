import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { checkForUpdates, installUpdate } from "@/platform/runtime";
import { UpdateCheckButton } from "./UpdateCheckButton";

vi.mock("@/platform/runtime");

beforeEach(() => vi.resetAllMocks());

it("downloads and installs the detected release only after confirmation", async () => {
  vi.mocked(checkForUpdates).mockResolvedValue({ currentVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, installUnavailable: null });
  vi.mocked(installUpdate).mockImplementation(async (_version, notify) => {
    notify({ phase: "downloading", downloaded: 100, total: 200 });
    throw "测试：验签失败";
  });
  render(<UpdateCheckButton />);
  expect(checkForUpdates).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  expect(await screen.findByText("发现新版本 v1.1.0")).toBeInTheDocument();
  expect(screen.getByText("当前版本：v1.0.0")).toBeInTheDocument();
  expect(installUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "下载并安装" }));
  await waitFor(() => expect(installUpdate).toHaveBeenCalledWith("1.1.0", expect.any(Function)));
  expect(await screen.findByText("测试：验签失败")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载并安装" })).toBeEnabled();
});

it("does not offer to install a release missing a signed update", async () => {
  vi.mocked(checkForUpdates).mockResolvedValue({ currentVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, installUnavailable: "该发布缺少签名更新包。" });
  render(<UpdateCheckButton />);
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  expect(await screen.findByText("该发布缺少签名更新包。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下载并安装" })).not.toBeInTheDocument();
});

it("shows a network failure separately and lets the user retry", async () => {
  vi.mocked(checkForUpdates)
    .mockRejectedValueOnce("无法连接 GitHub，请检查网络后重试。")
    .mockResolvedValueOnce({ currentVersion: "1.0.0", latestVersion: "1.0.0", updateAvailable: false, installUnavailable: null });
  render(<UpdateCheckButton />);
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  expect(await screen.findByText(/无法连接 GitHub/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
  expect(await screen.findByText(/当前版本无需更新/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下载并安装" })).not.toBeInTheDocument();
});
