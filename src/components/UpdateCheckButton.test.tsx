import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { checkForUpdates, installUpdate } from "@/platform/runtime";
import { UpdateCheckButton } from "./UpdateCheckButton";

vi.mock("@/platform/runtime");

it("checks once at startup and installs only after confirmation", async () => {
  vi.mocked(checkForUpdates).mockResolvedValue({ currentVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true, installUnavailable: null });
  vi.mocked(installUpdate).mockResolvedValue(undefined);
  render(<StrictMode><UpdateCheckButton /></StrictMode>);
  fireEvent.click(await screen.findByRole("button", { name: "发现新版本" }));
  const install = await screen.findByRole("button", { name: "下载并安装" });
  expect(checkForUpdates).toHaveBeenCalledTimes(1);
  expect(installUpdate).not.toHaveBeenCalled();
  fireEvent.click(install);
  await waitFor(() => expect(installUpdate).toHaveBeenCalledWith("1.1.0", expect.any(Function)));
});
