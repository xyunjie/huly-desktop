import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_URL } from "@/domain/types";
import { MockDeskClient } from "./client";

async function openCompany() {
  const client = new MockDeskClient();
  const account = await client.authenticate({ kind: "mock", serverUrl: DEFAULT_SERVER_URL });
  expect(account.workspaces.map((workspace) => workspace.name)).toEqual(["公司", "研发", "客户成功"]);
  const session = await client.enterWorkspace("company");
  expect(session.workspaceName).toBe("公司");
  return client;
}

describe("mock desk client", () => {
  it("creates an issue and moves it between columns", async () => {
    const client = await openCompany();
    const created = await client.createIssue({
      projectId: "proj-core",
      title: "补一条示例任务",
      description: "只存在于内存。",
      statusId: "st-todo",
      priority: "medium",
      assigneeId: "p-bill",
      milestoneId: null,
      componentId: null,
      labelIds: ["lb-doc"],
    });
    expect(created.identifier.startsWith("CORE-")).toBe(true);
    const moved = await client.updateIssue(created.id, { statusId: "st-doing" });
    expect(moved.statusId).toBe("st-doing");
    const bundle = await client.loadProject("proj-core");
    expect(bundle.issues.some((issue) => issue.id === created.id && issue.statusId === "st-doing")).toBe(true);
  });

  it("does not keep a password on the client", async () => {
    const client = await openCompany();
    expect(JSON.stringify(client)).not.toContain("hunter2");
    expect(client.tokenForKeychain()).toBe("");
  });

  it("adds a comment only inside the sample data", async () => {
    const client = await openCompany();
    const comment = await client.addComment("i-128", "先在客户端加锁。");
    const comments = await client.listComments("i-128");
    expect(comments.map((item) => item.id)).toContain(comment.id);
  });

  it("lets an owner manage members, invites, names and project membership in memory", async () => {
    const client = await openCompany();
    const session = await client.enterWorkspace("company");
    expect(session.role).toBe("OWNER");
    const members = await client.listWorkspaceMembers();
    expect(members.map((member) => member.role)).toContain("OWNER");
    await client.updateWorkspaceRole("acc-li", "MAINTAINER");
    expect((await client.listWorkspaceMembers()).find((member) => member.accountId === "acc-li")?.role).toBe("MAINTAINER");
    await expect(client.removeWorkspaceMember("acc-bill")).rejects.toThrow(/不能移除自己/);
    await client.sendInvite("new@example.com", "USER");
    const link = await client.createInviteLink("new@example.com", "USER", "新", "同事");
    expect(link).toContain("https://example.invalid/invite/");
    const renamed = await client.changeDisplayName("William", "Murphy");
    expect(renamed).toBe("William Murphy");
    const updated = await client.updateProjectMembers("proj-core", ["acc-bill", "acc-chen"]);
    expect(updated.memberIds).toEqual(["acc-bill", "acc-chen"]);
    const archived = await client.updateProject("proj-core", { archived: true, name: "核心平台" });
    expect(archived.archived).toBe(true);
    expect((await client.listProjects()).map((project) => project.id)).not.toContain("proj-core");
  });

  it("hides management when the acting role is USER", async () => {
    const client = new MockDeskClient({ role: "USER", delayMs: 0 });
    await client.authenticate({ kind: "mock", serverUrl: DEFAULT_SERVER_URL });
    const session = await client.enterWorkspace("company");
    expect(session.role).toBe("USER");
    await expect(client.updateProject("proj-nanchang", { name: "不可改" })).rejects.toThrow(/暂不支持/);
    await expect(client.removeWorkspaceMember("acc-li")).rejects.toThrow(/暂不支持/);
  });

  it("lists projects for the selected workspace and can switch", async () => {
    const client = await openCompany();
    const company = await client.listProjects();
    expect(company.map((project) => project.identifier)).toEqual(["CORE", "509南昌", "5090_"]);
    const switched = await client.switchWorkspace("rd");
    expect(switched.workspaceName).toBe("研发");
    expect((await client.listProjects()).map((project) => project.identifier)).toEqual(["APP"]);
  });

  it("supports phase 1-3 issue editing, sub-issues, milestones, components, templates, time reports and notifications", async () => {
    const client = await openCompany();

    const updatedDesc = await client.updateIssue("i-128", {
      description: "## 新描述\n已补全排查细节",
      blockedBy: ["i-129"],
      relations: ["i-130"],
      estimationHours: 6,
    });
    expect(updatedDesc.description).toContain("新描述");
    expect(updatedDesc.blockedBy).toEqual(["i-129"]);
    expect(updatedDesc.relations).toEqual(["i-130"]);
    expect(updatedDesc.estimationHours).toBe(6);

    const sub = await client.createIssue({
      projectId: "proj-core",
      title: "子任务验证",
      description: "",
      statusId: "st-todo",
      priority: "medium",
      assigneeId: null,
      milestoneId: null,
      componentId: null,
      labelIds: [],
      parentId: "i-128",
    });
    expect(sub.parentIds).toEqual(["i-128"]);

    const reparented = await client.updateIssue(sub.id, { parentId: null });
    expect(reparented.parentIds).toEqual([]);

    const ms = await client.createMilestone("proj-core", { name: "v0.4", status: "planned" });
    const msUpdated = await client.updateMilestone(ms.id, { status: "in-progress" });
    expect(msUpdated.status).toBe("in-progress");
    await client.deleteMilestone(ms.id);

    const cp = await client.createComponent("proj-core", { name: "存储", leadId: "p-zhang" });
    expect(cp.name).toBe("存储");
    await client.deleteComponent(cp.id);

    const tpl = await client.createTemplate("proj-core", {
      title: "新模板",
      description: "模板正文",
      priority: "high",
      assigneeId: null,
      milestoneId: null,
      componentId: null,
      labelIds: ["lb-bug"],
      estimationHours: 3,
    });
    expect((await client.listTemplates("proj-core")).some((item) => item.id === tpl.id)).toBe(true);
    await client.deleteTemplate(tpl.id);

    const report = await client.reportTime("i-128", { hours: 2, date: Date.now(), description: "联调" });
    expect((await client.listTimeReports("i-128")).some((item) => item.id === report.id)).toBe(true);
    await client.deleteTimeReport("i-128", report.id);

    const notifs = await client.listNotifications();
    expect(notifs.some((item) => !item.isViewed)).toBe(true);
    await client.markAllNotificationsRead();
    expect((await client.listNotifications()).every((item) => item.isViewed)).toBe(true);
  });
});
