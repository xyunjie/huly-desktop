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
  fireEvent.click(await screen.findByText("进入工作区"));
  await screen.findByTestId("project-table");
  fireEvent.click(screen.getByTestId("nav-mine"));

  expect(await screen.findByText("2 条（含子任务）")).toBeInTheDocument();
  expect(within(screen.getByText("CORE-141").closest('[role="row"]')!).getByText("待办")).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText("项目筛选", { selector: "input" }));
  fireEvent.click(await screen.findByText("核心平台"));
  expect(screen.getByText("1 条（含子任务）")).toBeInTheDocument();
  expect(screen.getByText("CORE-141")).toBeInTheDocument();
  expect(screen.queryByText("5090_-5")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTestId("nav-projects"));
  const table = await screen.findByTestId("project-table");
  const project = within(table).getByText("核心平台").closest("tr")!;
  fireEvent.click(within(project).getByText("进入项目"));
  expect(await screen.findByText(/条顶层任务/)).toBeInTheDocument();
  expect(screen.queryByText("CORE-141")).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText("指派人筛选", { selector: "input" }));
  fireEvent.click(await screen.findByText("指派给我"));

  expect(screen.getByText("1 条（含子任务）")).toBeInTheDocument();
  expect(screen.getByText("CORE-141")).toBeInTheDocument();
});
