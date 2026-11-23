import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { MockDeskClient } from "@/data/mock/client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it("shows the same assigned subtask and count in My Tasks and its project", async () => {
  vi.stubEnv("VITE_DATA_MODE", "mock");
  const enterWorkspace = MockDeskClient.prototype.enterWorkspace;
  vi.spyOn(MockDeskClient.prototype, "enterWorkspace").mockImplementation(async function (this: MockDeskClient, url) {
    const session = await enterWorkspace.call(this, url);
    await this.updateIssue("i-141", { assigneeId: session.userId });
    return session;
  });
  render(<App />);
  fireEvent.click(screen.getByTestId("login-submit"));
  fireEvent.click(await screen.findByRole("button", { name: "进入工作区" }));
  await screen.findByRole("row", { name: /核心平台/ });
  fireEvent.click(screen.getByTestId("nav-mine"));

  expect(await screen.findByText("2 条（含子任务）")).toBeVisible();
  expect(screen.getByRole("row", { name: /CORE-141 待办/ })).toBeVisible();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "项目筛选" }));
  fireEvent.click(await screen.findByText("核心平台"));
  expect(screen.getByText("1 条（含子任务）")).toBeVisible();
  expect(screen.getByText("CORE-141")).toBeVisible();
  expect(screen.queryByText("5090_-5")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("nav-projects"));
  const project = await screen.findByRole("row", { name: /核心平台/ });
  fireEvent.click(within(project).getByRole("button", { name: "进入项目" }));
  expect(await screen.findByText(/条顶层任务/)).toBeVisible();
  expect(screen.queryByText("CORE-141")).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "指派人筛选" }));
  fireEvent.click(await screen.findByText("指派给我"));

  expect(screen.getByText("1 条（含子任务）")).toBeVisible();
  expect(screen.getByText("CORE-141")).toBeVisible();
}, 20_000);
