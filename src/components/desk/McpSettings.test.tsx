import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { addMcpToClient, getMcpClientStatus, getMcpConfig, isMcpDesktop, regenerateMcpToken } from "@/mcp/bridge";
import { McpPage } from "./McpSettings";

vi.mock("@/mcp/bridge");

it("allows updating a stale client configuration after rotating the token", async () => {
  let token = "original-token";
  let installedToken = token;
  vi.mocked(isMcpDesktop).mockReturnValue(true);
  vi.mocked(getMcpConfig).mockImplementation(async () => ({ port: 41790, token }));
  vi.mocked(getMcpClientStatus).mockImplementation(async (client) => ({
    state: client === "codex" ? (token === installedToken ? "current" : "stale") : "missing",
    path: `/${client}/config`,
    note: null,
  }));
  vi.mocked(regenerateMcpToken).mockImplementation(async () => {
    token = "rotated-token";
    return { port: 41790, token };
  });
  vi.mocked(addMcpToClient).mockImplementation(async () => {
    installedToken = token;
    return "已更新配置";
  });

  render(<McpPage />);
  await screen.findByText("配置与服务一致");
  expect(screen.queryByText(/手动配置/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "复制配置" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认轮换" }));
  const update = await screen.findByRole("button", { name: "更新配置" });
  expect(update).toBeEnabled();
  fireEvent.click(update);
  await waitFor(() => expect(addMcpToClient).toHaveBeenCalledWith("codex"));
  await screen.findByText("配置与服务一致");
});
