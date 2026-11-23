import { describe, expect, it } from "vitest";
import { parseServerConfig } from "./config";
import { filterIssues, groupIssues, hasActiveFilters, pickInitialIssue } from "./filters";
import { loadOfflineSnapshot, saveOfflineSnapshot, clearOfflineSnapshot } from "./cache";
import { validateLogin } from "./login";
import { priorityFromHuly } from "./priority";
import { buildSessionSecret, parseSessionSecret, redactSecrets } from "./secrets";
import { categoryFromHuly, statusVisual } from "./status";
import { projectHeading } from "./format";
import { configJsonUrl, normalizeServerUrl, normalizeWorkspaceSlug } from "./url";
import { DEFAULT_WORKSPACE_SLUG } from "./types";
import { mockIssues, mockPeople, mockStatuses } from "@/data/mock/fixtures";

describe("server url", () => {
  it("keeps a non-standard port and drops the trailing slash", () => {
    expect(normalizeServerUrl("https://lm.all666.cn:666/")).toBe("https://lm.all666.cn:666");
    expect(configJsonUrl("https://lm.all666.cn:666/")).toBe("https://lm.all666.cn:666/config.json");
  });

  it("rejects credentials embedded in the address", () => {
    expect(() => normalizeServerUrl("https://user:secret@lm.all666.cn:666")).toThrow(/不要写账号或密码/);
  });

  it("reads the workspace slug from a workbench url", () => {
    expect(normalizeWorkspaceSlug(`https://lm.all666.cn:666/workbench/${DEFAULT_WORKSPACE_SLUG}/tracker`)).toBe(
      DEFAULT_WORKSPACE_SLUG,
    );
  });
});

describe("session secret", () => {
  it("stores the token and never a password field", () => {
    const raw = buildSessionSecret({
      serverUrl: "https://lm.all666.cn:666",
      workspace: DEFAULT_WORKSPACE_SLUG,
      email: "bill@example.com",
      token: "account-token-value",
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["email", "serverUrl", "token", "workspace"]);
    expect(parsed.password).toBeUndefined();
    expect(parseSessionSecret(raw).token).toBe("account-token-value");
  });

  it("rejects a payload that contains a password", () => {
    expect(() => parseSessionSecret(JSON.stringify({ serverUrl: "https://x", workspace: "ws", token: "t", password: "nope" }))).toThrow(
      /格式不正确/,
    );
  });

  it("redacts bearer tokens and password assignments", () => {
    const message = redactSecrets("Login failed password=hunter2 Authorization: Bearer abcdefgh", ["abcdefgh"]);
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("abcdefgh");
  });
});

describe("config.json", () => {
  it("reads the account and collaborator endpoints", () => {
    expect(
      parseServerConfig({
        ACCOUNTS_URL: "https://accounts.example",
        COLLABORATOR_URL: "https://collab.example",
        FILES_URL: "https://files.example",
      }),
    ).toMatchObject({
      accountsUrl: "https://accounts.example",
      collaboratorUrl: "https://collab.example",
    });
  });
});

describe("huly mapping", () => {
  it("maps official priority numbers", () => {
    expect(priorityFromHuly(0)).toBe("none");
    expect(priorityFromHuly(1)).toBe("urgent");
    expect(priorityFromHuly(2)).toBe("high");
    expect(priorityFromHuly(3)).toBe("medium");
    expect(priorityFromHuly(4)).toBe("low");
  });

  it("maps tracker statuses and 0.7 task categories", () => {
    expect(categoryFromHuly({ id: "tracker:status:Backlog" })).toBe("backlog");
    expect(categoryFromHuly({ id: "tracker:status:Todo" })).toBe("todo");
    expect(categoryFromHuly({ id: "tracker:status:InProgress" })).toBe("in-progress");
    expect(categoryFromHuly({ categoryId: "task:statusCategory:UnStarted" })).toBe("backlog");
    expect(categoryFromHuly({ categoryId: "task:statusCategory:ToDo" })).toBe("todo");
    expect(categoryFromHuly({ categoryId: "task:statusCategory:Active" })).toBe("in-progress");
    expect(categoryFromHuly({ categoryId: "task:statusCategory:Won" })).toBe("done");
    expect(categoryFromHuly({ categoryId: "task:statusCategory:Lost" })).toBe("canceled");
  });

  it("assigns distinct visual styles to todo, in-progress, review, and done", () => {
    const todo = statusVisual({ name: "待开始", category: "todo", color: "#1c7ed6" });
    const doing = statusVisual({ name: "进行中", category: "in-progress", color: "#f08c00" });
    const review = statusVisual({ name: "待复核", category: "todo", color: "#1c7ed6" });
    const done = statusVisual({ name: "完成", category: "done", color: "#2f9e44" });
    expect(todo.kind).toBe("todo");
    expect(doing.kind).toBe("in-progress");
    expect(review.kind).toBe("review");
    expect(done.kind).toBe("done");
    expect(new Set([todo.color, doing.color, review.color, done.color]).size).toBe(4);
  });
});

describe("issue filters", () => {
  it("searches by title and identifier and hides sub-issues", () => {
    const found = filterIssues(mockIssues, {
      search: "CORE-128",
      statusId: "all",
      assigneeId: "all",
      priority: "all",
      labelId: "all",
      groupBy: "status",
    });
    expect(found.map((issue) => issue.identifier)).toEqual(["CORE-128"]);
    const all = filterIssues(mockIssues, {
      search: "",
      statusId: "all",
      assigneeId: "all",
      priority: "all",
      labelId: "all",
      groupBy: "status",
    });
    expect(all.some((issue) => issue.identifier === "CORE-141")).toBe(false);
  });

  it("filters by assignee, priority and label", () => {
    const found = filterIssues(mockIssues, {
      search: "",
      statusId: "all",
      assigneeId: "p-zhang",
      priority: "high",
      labelId: "lb-bug",
      groupBy: "none",
    });
    expect(found.map((issue) => issue.identifier)).toEqual(["CORE-128"]);
  });

  it("groups by status name", () => {
    const visible = filterIssues(
      mockIssues.filter((issue) => issue.projectId === "proj-core"),
      {
        search: "",
        statusId: "all",
        assigneeId: "all",
        priority: "all",
        labelId: "all",
        groupBy: "status",
      },
    );
    const groups = groupIssues(visible, "status", mockStatuses, mockPeople);
    expect(groups.map((group) => group.title)).toEqual(["待办池", "待办", "进行中", "完成"]);
    expect(pickInitialIssue(visible, mockStatuses)?.identifier).toBe("CORE-128");
  });

  it("filters by milestone and due date", () => {
    const now = new Date("2026-11-21T10:00:00").getTime();
    const overdue = filterIssues(
      mockIssues,
      {
        search: "",
        statusId: "all",
        assigneeId: "all",
        priority: "all",
        labelId: "all",
        milestoneId: "ms-02",
        dueFilter: "overdue",
        groupBy: "status",
      },
      { now },
    );
    expect(overdue.map((issue) => issue.identifier)).toEqual(["CORE-125", "CORE-129"]);

    const noDue = filterIssues(
      mockIssues,
      {
        search: "",
        statusId: "all",
        assigneeId: "all",
        priority: "all",
        labelId: "all",
        milestoneId: "none",
        dueFilter: "no-due",
        groupBy: "status",
      },
      { now },
    );
    expect(noDue.some((issue) => issue.identifier === "CORE-131")).toBe(true);
    expect(hasActiveFilters({ search: "", statusId: "all", assigneeId: "all", priority: "all", labelId: "all", milestoneId: "ms-02", dueFilter: "all", groupBy: "status" })).toBe(true);
    expect(hasActiveFilters({ search: "", statusId: "all", assigneeId: "all", priority: "all", labelId: "all", milestoneId: "all", dueFilter: "all", groupBy: "status" })).toBe(false);
  });
});

describe("offline cache", () => {
  it("saves, loads and clears workspace snapshots without secrets", () => {
    saveOfflineSnapshot("https://lm.all666.cn:666", "company", {
      savedAt: 12345,
      projects: [],
      people: mockPeople,
      members: [],
      bundles: {},
      mine: [],
    });
    const loaded = loadOfflineSnapshot("https://lm.all666.cn:666", "company");
    expect(loaded?.savedAt).toBe(12345);
    expect(loaded?.people).toHaveLength(mockPeople.length);
    clearOfflineSnapshot("https://lm.all666.cn:666", "company");
    expect(loadOfflineSnapshot("https://lm.all666.cn:666", "company")).toBeNull();
  });
});

describe("login validation", () => {
  it("does not put the password into the error text", () => {
    const result = validateLogin({
      serverUrl: "https://lm.all666.cn:666/",
      method: "password",
      email: "not-an-email",
      password: "hunter2-secret",
      token: "",
      mock: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("hunter2-secret");
  });

  it("accepts mock mode without credentials or a workspace slug", () => {
    const result = validateLogin({
      serverUrl: "https://lm.all666.cn:666/",
      method: "password",
      email: "",
      password: "",
      token: "",
      mock: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("mock");
      expect(result.value.serverUrl).toBe("https://lm.all666.cn:666");
    }
  });

  it("requires an API key when that method is selected", () => {
    const result = validateLogin({
      serverUrl: "https://lm.all666.cn:666/",
      method: "token",
      email: "",
      password: "",
      token: "",
      mock: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe("project heading", () => {
  it("does not repeat an identifier that is already in the name", () => {
    expect(projectHeading("5093", "5093-在线考试系统")).toBe("5093-在线考试系统");
    expect(projectHeading("CORE", "核心平台")).toBe("CORE 核心平台");
    expect(projectHeading("5090_", "5090_物联汇聚平台")).toBe("5090_物联汇聚平台");
  });
});
