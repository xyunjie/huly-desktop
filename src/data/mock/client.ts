import { parseServerConfig } from "@/domain/config";
import type { DeskClient } from "@/data/client";
import { findWorkspace } from "@/domain/session";
import { addProjectMember, canChangeWorkspaceRole, canRemoveWorkspaceMember } from "@/domain/members";
import { initialMockRole, type WorkspaceRole } from "@/domain/roles";
import { displayPersonName, storedPersonName } from "@/data/huly/mapping";
import { decodeMarkupToMarkdown, extractHulyFileId } from "@/data/huly/markup";
import type {
  AccountAuthInput,
  AccountSession,
  ActivityItem,
  Attachment,
  Comment,
  CommentFormat,
  Component,
  ComponentInput,
  CreateIssueInput,
  InboxNotification,
  Issue,
  IssuePatch,
  IssueTemplate,
  IssueTemplateInput,
  Milestone,
  MilestoneInput,
  Person,
  Project,
  ProjectBundle,
  ProjectPatch,
  ServerEndpoints,
  Session,
  TimeSpendReport,
  WorkspaceChoice,
  WorkspaceMember,
} from "@/domain/types";
import {
  clone,
  mockAttachments,
  mockComments,
  mockComponents,
  mockIssues,
  mockIssueTemplates,
  mockLabels,
  mockMilestones,
  mockNotifications,
  mockPeople,
  mockProjects,
  mockStatuses,
  mockTimeReports,
  mockWorkspaces,
  mockWorkspaceMembers,
} from "./fixtures";

const SAMPLE_CONFIG = {
  ACCOUNTS_URL: "https://accounts.example.invalid",
  COLLABORATOR_URL: "https://collaborator.example.invalid",
  FILES_URL: "https://files.example.invalid",
  UPLOAD_URL: "https://upload.example.invalid",
};

function defaultDelay(): number {
  return import.meta.env.MODE === "test" ? 0 : 400;
}

export class MockDeskClient implements DeskClient {
  readonly mode = "mock" as const;
  readonly commentWrite = true;
  private issues = clone(mockIssues);
  private comments = clone(mockComments);
  private attachments = clone(mockAttachments);
  private milestones = clone(mockMilestones);
  private components = clone(mockComponents);
  private templates = clone(mockIssueTemplates);
  private timeReports = clone(mockTimeReports);
  private notifications = clone(mockNotifications);
  private projects = clone(mockProjects);
  private people = clone(mockPeople);
  private membersByWorkspace: Record<string, WorkspaceMember[]> = clone(mockWorkspaceMembers);
  private invites: { email: string; role: WorkspaceRole }[] = [];
  private sequence = 200;
  private inviteSeq = 1;
  private account: AccountSession | null = null;
  private workspace: WorkspaceChoice | null = null;
  private role: WorkspaceRole;
  private readonly delayMs: number;
  private listeners = new Set<() => void>();

  constructor(options?: { role?: WorkspaceRole; delayMs?: number }) {
    this.role = options?.role ?? initialMockRole();
    this.delayMs = options?.delayMs ?? defaultDelay();
  }

  setActingRole(role: WorkspaceRole): void {
    this.role = role;
  }

  tokenForKeychain(): string {
    return "";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private async pause(): Promise<void> {
    if (this.delayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  async probe(_serverUrl?: string): Promise<ServerEndpoints> {
    return parseServerConfig(SAMPLE_CONFIG);
  }

  async authenticate(input: AccountAuthInput): Promise<AccountSession> {
    if (input.kind !== "mock") {
      throw new Error("示例数据客户端不能连接真实服务器。");
    }
    this.workspace = null;
    this.account = {
      serverUrl: input.serverUrl,
      email: "bill@example.com",
      userName: "Bill Murphy",
      workspaces: clone(mockWorkspaces),
    };
    return clone(this.account);
  }

  async listWorkspaces(): Promise<WorkspaceChoice[]> {
    const account = this.assertAccount();
    return clone(account.workspaces);
  }

  async enterWorkspace(workspaceUrl: string): Promise<Session> {
    const account = this.assertAccount();
    const choice = findWorkspace(account.workspaces, workspaceUrl);
    if (!choice) throw new Error("找不到这个工作区。");
    this.workspace = choice;
    return this.session();
  }

  async switchWorkspace(workspaceUrl: string): Promise<Session> {
    return this.enterWorkspace(workspaceUrl);
  }

  async disconnect(): Promise<void> {
    this.account = null;
    this.workspace = null;
  }

  async listProjects() {
    this.assertWorkspace();
    await this.pause();
    return this.workspaceProjects().map((project) => this.withCounts(project));
  }

  async countIssuesByProject(): Promise<Record<string, { open: number; total: number }>> {
    this.assertWorkspace();
    const counts: Record<string, { open: number; total: number }> = {};
    for (const project of this.workspaceProjects()) {
      counts[project.id] = this.projectCounts(project.id);
    }
    return counts;
  }

  async listPeople(): Promise<Person[]> {
    this.assertWorkspace();
    return clone(this.people);
  }

  async listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    this.assertWorkspace();
    await this.pause();
    return clone(this.currentMembers());
  }

  async updateWorkspaceRole(accountId: string, role: WorkspaceRole): Promise<void> {
    const members = this.currentMembers();
    const target = members.find((member) => member.accountId === accountId);
    if (!target) throw new Error("找不到这个成员。");
    const allowed = canChangeWorkspaceRole({
      actorRole: this.role,
      target,
      nextRole: role,
      members,
    });
    if (!allowed.ok) throw new Error(allowed.reason);
    target.role = role;
  }

  async sendInvite(email: string, role: WorkspaceRole): Promise<void> {
    this.assertManager();
    const address = email.trim();
    if (!address || !address.includes("@")) throw new Error("请填写有效的邮箱。");
    const existing = this.invites.find((invite) => invite.email === address);
    if (existing) existing.role = role;
    else this.invites.push({ email: address, role });
  }

  async resendInvite(email: string, role: WorkspaceRole): Promise<void> {
    await this.sendInvite(email, role);
  }

  async createInviteLink(email: string, role: WorkspaceRole, firstName?: string, lastName?: string): Promise<string> {
    await this.sendInvite(email, role);
    this.inviteSeq += 1;
    const label = [lastName, firstName].filter(Boolean).join(",") || email.trim();
    return `https://example.invalid/invite/mock-${this.inviteSeq}?role=${role}&n=${encodeURIComponent(label)}`;
  }

  async removeWorkspaceMember(accountId: string): Promise<void> {
    const members = this.currentMembers();
    const target = members.find((member) => member.accountId === accountId);
    if (!target) throw new Error("找不到这个成员。");
    const allowed = canRemoveWorkspaceMember({
      actorRole: this.role,
      actorAccountId: "acc-bill",
      target,
      members,
    });
    if (!allowed.ok) throw new Error(allowed.reason);
    const workspaceId = this.assertWorkspace().id;
    this.membersByWorkspace[workspaceId] = members.filter((member) => member.accountId !== accountId);
    for (const project of this.projects) {
      if (project.workspaceId === workspaceId) {
        project.memberIds = (project.memberIds ?? []).filter((id) => id !== accountId);
      }
    }
  }

  async updateProjectMembers(projectId: string, memberIds: string[]): Promise<Project> {
    this.assertManager();
    const project = this.requireProject(projectId);
    const unique: string[] = [];
    for (const id of memberIds) {
      if (!unique.includes(id)) unique.push(id);
    }
    project.memberIds = unique;
    project.modifiedOn = Date.now();
    return this.withCounts(project);
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
    this.assertManager();
    const project = this.requireProject(projectId);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("请填写项目名称。");
      project.name = name;
    }
    if (patch.description !== undefined) project.description = patch.description;
    if (patch.defaultAssigneeId !== undefined) project.defaultAssigneeId = patch.defaultAssigneeId;
    if (patch.archived !== undefined) project.archived = patch.archived;
    project.modifiedOn = Date.now();
    return this.withCounts(project);
  }

  async changeDisplayName(firstName: string, lastName: string): Promise<string> {
    this.assertAccount();
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first && !last) throw new Error("请填写姓名。");
    const display = displayPersonName(storedPersonName(first, last));
    if (this.account) this.account.userName = display;
    const person = this.people.find((item) => item.id === "p-bill");
    if (person) person.name = display;
    for (const members of Object.values(this.membersByWorkspace)) {
      const self = members.find((member) => member.accountId === "acc-bill");
      if (self) self.name = display;
    }
    return display;
  }

  addProjectMember(projectId: string, accountId: string): string[] {
    const project = this.requireProject(projectId);
    project.memberIds = addProjectMember(project.memberIds ?? [], accountId);
    return [...(project.memberIds ?? [])];
  }

  async loadProject(projectId: string): Promise<ProjectBundle> {
    this.assertWorkspace();
    const project = this.projects.find((item) => item.id === projectId);
    if (!project || project.workspaceId !== this.workspace?.id || project.archived) {
      throw new Error("找不到这个项目。");
    }
    await this.pause();
    return {
      statuses: clone(mockStatuses),
      milestones: clone(this.milestones.filter((item) => item.projectId === projectId)),
      components: clone(this.components.filter((item) => item.projectId === projectId)),
      labels: clone(mockLabels),
      issues: clone(this.issues.filter((issue) => issue.projectId === projectId)),
    };
  }

  async findIssueByIdentifier(identifier: string): Promise<Issue | null> {
    const projects = new Set(this.workspaceProjects().map((project) => project.id));
    const key = identifier.toUpperCase();
    const issue = this.issues.find((item) => projects.has(item.projectId) && (item.identifier.toUpperCase() === key || item.id === identifier));
    return issue ? clone(issue) : null;
  }

  async listAssigned(personId: string): ReturnType<DeskClient["listAssigned"]> {
    this.assertWorkspace();
    await this.pause();
    const projectIds = new Set(
      this.projects
        .filter((project) => project.workspaceId === this.workspace?.id && !project.archived)
        .map((project) => project.id),
    );
    const issues = this.issues.filter((issue) => issue.assigneeId === personId && projectIds.has(issue.projectId));
    return clone({ issues, statuses: mockStatuses });
  }

  async updateIssue(id: string, patch: IssuePatch): Promise<Issue> {
    this.assertWorkspace();
    const issue = this.issues.find((item) => item.id === id);
    if (!issue) throw new Error("找不到这个任务。");
    if (patch.title !== undefined) issue.title = patch.title.trim() || issue.title;
    if (patch.descriptionMarkup !== undefined) {
      issue.descriptionMarkup = patch.descriptionMarkup;
      issue.description = decodeMarkupToMarkdown(patch.descriptionMarkup);
    } else if (patch.description !== undefined) {
      issue.description = patch.description;
      issue.descriptionMarkup = undefined;
    }
    if (patch.statusId !== undefined) issue.statusId = patch.statusId;
    if (patch.priority !== undefined) issue.priority = patch.priority;
    if (patch.assigneeId !== undefined) issue.assigneeId = patch.assigneeId;
    if (patch.milestoneId !== undefined) issue.milestoneId = patch.milestoneId;
    if (patch.componentId !== undefined) issue.componentId = patch.componentId;
    if (patch.dueDate !== undefined) issue.dueDate = patch.dueDate;
    if (patch.labelIds !== undefined) issue.labelIds = [...patch.labelIds];
    if (patch.estimationHours !== undefined) {
      issue.estimationHours = patch.estimationHours;
      issue.remainingTime = Math.max(0, patch.estimationHours - (issue.reportedTime ?? 0));
    }
    if (patch.blockedBy !== undefined) issue.blockedBy = [...patch.blockedBy];
    if (patch.relations !== undefined) issue.relations = [...patch.relations];
    if (patch.parentId !== undefined) {
      if (!patch.parentId) {
        issue.parentIds = [];
      } else {
        if (patch.parentId === id) throw new Error("任务不能把自己设为上级任务。");
        const parent = this.issues.find((item) => item.id === patch.parentId);
        if (!parent) throw new Error("找不到指定的上级任务。");
        if (parent.parentIds.includes(id)) throw new Error("不能把自己的子任务设为上级任务。");
        issue.parentIds = [...parent.parentIds, parent.id];
      }
    }
    issue.modifiedOn = Date.now();
    this.emit();
    return clone(issue);
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    this.assertWorkspace();
    const project = this.projects.find(
      (item) => item.id === input.projectId && item.workspaceId === this.workspace?.id && !item.archived,
    );
    if (!project) throw new Error("找不到这个项目。");
    if (!input.title.trim()) throw new Error("请填写标题。");
    let parentIds: string[] = [];
    if (input.parentId) {
      const parent = this.issues.find((item) => item.id === input.parentId);
      if (!parent) throw new Error("找不到指定的上级任务。");
      parentIds = [...parent.parentIds, parent.id];
    }
    this.sequence += 1;
    const issue: Issue = {
      id: `i-new-${this.sequence}`,
      projectId: project.id,
      identifier: `${project.identifier}-${this.sequence}`,
      number: this.sequence,
      title: input.title.trim(),
      description: input.description.trim(),
      statusId: input.statusId || project.defaultStatusId || mockStatuses[1]?.id || "st-todo",
      priority: input.priority,
      assigneeId: input.assigneeId,
      labelIds: [...input.labelIds],
      milestoneId: input.milestoneId,
      componentId: input.componentId,
      dueDate: input.dueDate ?? null,
      parentIds,
      estimationHours: input.estimationHours,
      reportedTime: 0,
      remainingTime: input.estimationHours,
      blockedBy: [],
      relations: [],
      rank: `z${this.sequence}`,
      modifiedOn: Date.now(),
    };
    this.issues.push(issue);
    this.emit();
    return clone(issue);
  }

  async listComments(issueId: string): Promise<Comment[]> {
    this.assertWorkspace();
    return clone(this.comments.filter((comment) => comment.issueId === issueId));
  }

  async loadIssueTimeline(issue: Issue) {
    return { comments: await this.listComments(issue.id), activity: await this.listActivity(issue.id) };
  }

  async listEditorTemplates() {
    this.assertWorkspace();
    return [{ id: "editor-review", title: "复核结论", body: "**复核结果**\n\n- 验证步骤：\n- 结论：" }];
  }

  async listActivity(issueId: string): Promise<ActivityItem[]> {
    this.assertWorkspace();
    const issue = this.issues.find((item) => item.id === issueId);
    if (!issue) return [];
    const status = mockStatuses.find((item) => item.id === issue.statusId);
    return [
      {
        id: `act-${issue.id}-status`,
        issueId,
        kind: "update",
        authorId: issue.assigneeId,
        authorName: this.people.find((p) => p.id === issue.assigneeId)?.name || "系统",
        body: status ? `状态 设置为 ${status.name}` : "创建了此任务",
        createdOn: issue.modifiedOn || Date.now(),
      },
    ];
  }

  async hydrateIssue(issue: Issue): Promise<Issue> {
    return clone(issue);
  }

  async addComment(issueId: string, body: string, format: CommentFormat = "markdown"): Promise<Comment> {
    this.assertWorkspace();
    const text = (format === "markup" ? decodeMarkupToMarkdown(body) : body).trim();
    if (!text && format !== "markup") throw new Error("评论不能为空。");
    const comment: Comment = {
      id: `c-${this.comments.length + 1}`,
      issueId,
      authorId: this.account ? "p-bill" : null,
      authorName: this.account?.userName ?? "我",
      body: text,
      nativeMarkup: format === "markup" ? body : undefined,
      createdOn: Date.now(),
    };
    this.comments.push(comment);
    this.emit();
    return clone(comment);
  }

  async listAttachments(issueId: string): Promise<Attachment[]> {
    this.assertWorkspace();
    return clone(this.attachments.filter((item) => item.issueId === issueId));
  }

  async resolveImageSrc(src: string): Promise<string | null> {
    const fileId = extractHulyFileId(src);
    return this.attachments.find((item) => item.fileId === fileId)?.blobUrl ?? null;
  }

  async uploadAttachment(issueId: string, file: File): Promise<Attachment> {
    this.assertWorkspace();
    const blobUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : undefined;
    const item: Attachment = {
      id: `att-${Date.now()}-${this.attachments.length + 1}`,
      issueId,
      fileId: `blob-${Date.now()}`,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified || Date.now(),
      blobUrl,
    };
    this.attachments.unshift(item);
    return clone(item);
  }

  async downloadAttachment(attachment: Attachment): Promise<void> {
    this.assertWorkspace();
    const href =
      attachment.blobUrl ?? this.attachments.find((item) => item.fileId === attachment.fileId)?.blobUrl ??
      (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(new Blob([`示例附件：${attachment.name}`], { type: "text/plain" }))
        : null);
    if (!href || typeof document === "undefined") return;
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = attachment.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async deleteAttachment(_issueId: string, attachmentId: string): Promise<void> {
    this.assertWorkspace();
    this.attachments = this.attachments.filter((item) => item.id !== attachmentId);
  }

  async createMilestone(projectId: string, input: MilestoneInput): Promise<Milestone> {
    this.assertWorkspace();
    const name = input.name.trim();
    if (!name) throw new Error("请填写里程碑名称。");
    const milestone: Milestone = {
      id: `ms-${Date.now()}-${this.milestones.length + 1}`,
      projectId,
      name,
      description: input.description?.trim() ?? "",
      status: input.status ?? "planned",
      targetDate: input.targetDate ?? null,
    };
    this.milestones.push(milestone);
    return clone(milestone);
  }

  async updateMilestone(id: string, patch: Partial<MilestoneInput>): Promise<Milestone> {
    this.assertWorkspace();
    const item = this.milestones.find((m) => m.id === id);
    if (!item) throw new Error("找不到这个里程碑。");
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("请填写里程碑名称。");
      item.name = name;
    }
    if (patch.description !== undefined) item.description = patch.description;
    if (patch.status !== undefined) item.status = patch.status;
    if (patch.targetDate !== undefined) item.targetDate = patch.targetDate;
    return clone(item);
  }

  async deleteMilestone(id: string): Promise<void> {
    this.assertWorkspace();
    this.milestones = this.milestones.filter((item) => item.id !== id);
    for (const issue of this.issues) {
      if (issue.milestoneId === id) issue.milestoneId = null;
    }
  }

  async createComponent(projectId: string, input: ComponentInput): Promise<Component> {
    this.assertWorkspace();
    const name = input.name.trim();
    if (!name) throw new Error("请填写组件名称。");
    const component: Component = {
      id: `cp-${Date.now()}-${this.components.length + 1}`,
      projectId,
      name,
      description: input.description?.trim() ?? "",
      leadId: input.leadId ?? null,
    };
    this.components.push(component);
    return clone(component);
  }

  async updateComponent(id: string, patch: Partial<ComponentInput>): Promise<Component> {
    this.assertWorkspace();
    const item = this.components.find((c) => c.id === id);
    if (!item) throw new Error("找不到这个组件。");
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("请填写组件名称。");
      item.name = name;
    }
    if (patch.description !== undefined) item.description = patch.description;
    if (patch.leadId !== undefined) item.leadId = patch.leadId;
    return clone(item);
  }

  async deleteComponent(id: string): Promise<void> {
    this.assertWorkspace();
    this.components = this.components.filter((item) => item.id !== id);
    for (const issue of this.issues) {
      if (issue.componentId === id) issue.componentId = null;
    }
  }

  async listTemplates(projectId: string): Promise<IssueTemplate[]> {
    this.assertWorkspace();
    return clone(this.templates.filter((item) => item.projectId === projectId));
  }

  async createTemplate(projectId: string, input: IssueTemplateInput): Promise<IssueTemplate> {
    this.assertWorkspace();
    const title = input.title.trim();
    if (!title) throw new Error("请填写模板名称。");
    const template: IssueTemplate = {
      id: `tpl-${Date.now()}-${this.templates.length + 1}`,
      projectId,
      ...input,
      title,
    };
    this.templates.push(template);
    return clone(template);
  }

  async updateTemplate(id: string, patch: Partial<IssueTemplateInput>): Promise<IssueTemplate> {
    this.assertWorkspace();
    const item = this.templates.find((tpl) => tpl.id === id);
    if (!item) throw new Error("找不到这个模板。");
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error("请填写模板名称。");
      item.title = title;
    }
    if (patch.description !== undefined) item.description = patch.description;
    if (patch.priority !== undefined) item.priority = patch.priority;
    if (patch.assigneeId !== undefined) item.assigneeId = patch.assigneeId;
    if (patch.milestoneId !== undefined) item.milestoneId = patch.milestoneId;
    if (patch.componentId !== undefined) item.componentId = patch.componentId;
    if (patch.labelIds !== undefined) item.labelIds = [...patch.labelIds];
    if (patch.estimationHours !== undefined) item.estimationHours = patch.estimationHours;
    return clone(item);
  }

  async deleteTemplate(id: string): Promise<void> {
    this.assertWorkspace();
    this.templates = this.templates.filter((item) => item.id !== id);
  }

  async listTimeReports(issueId: string): Promise<TimeSpendReport[]> {
    this.assertWorkspace();
    return clone(this.timeReports.filter((item) => item.issueId === issueId));
  }

  async reportTime(
    issueId: string,
    input: { hours: number; date: number; description: string; employeeId?: string | null },
  ): Promise<TimeSpendReport> {
    this.assertWorkspace();
    if (!Number.isFinite(input.hours) || input.hours <= 0) throw new Error("请填写大于 0 的工时数。");
    const employeeId = input.employeeId ?? "p-bill";
    const person = employeeId ? this.people.find((p) => p.id === employeeId) : undefined;
    const report: TimeSpendReport = {
      id: `tr-${Date.now()}-${this.timeReports.length + 1}`,
      issueId,
      employeeId,
      employeeName: person?.name || this.account?.userName || "我",
      date: input.date,
      value: input.hours,
      description: input.description.trim(),
    };
    this.timeReports.unshift(report);
    const issue = this.issues.find((item) => item.id === issueId);
    if (issue) {
      issue.reportedTime = (issue.reportedTime ?? 0) + input.hours;
      if (typeof issue.estimationHours === "number") {
        issue.remainingTime = Math.max(0, issue.estimationHours - issue.reportedTime);
      }
    }
    return clone(report);
  }

  async deleteTimeReport(issueId: string, reportId: string): Promise<void> {
    this.assertWorkspace();
    const target = this.timeReports.find((item) => item.id === reportId);
    this.timeReports = this.timeReports.filter((item) => item.id !== reportId);
    if (target) {
      const issue = this.issues.find((item) => item.id === issueId);
      if (issue) {
        issue.reportedTime = Math.max(0, (issue.reportedTime ?? 0) - target.value);
        if (typeof issue.estimationHours === "number") {
          issue.remainingTime = Math.max(0, issue.estimationHours - issue.reportedTime);
        }
      }
    }
  }

  async listNotifications(): Promise<InboxNotification[]> {
    this.assertWorkspace();
    return clone(this.notifications);
  }

  async markNotificationRead(id: string): Promise<void> {
    this.assertWorkspace();
    const item = this.notifications.find((n) => n.id === id);
    if (item) item.isViewed = true;
  }

  async markAllNotificationsRead(): Promise<void> {
    this.assertWorkspace();
    for (const item of this.notifications) {
      item.isViewed = true;
    }
  }

  private session(): Session {
    const account = this.assertAccount();
    const workspace = this.assertWorkspace();
    return {
      mode: "mock",
      serverUrl: account.serverUrl,
      workspace: workspace.url,
      workspaceName: workspace.name,
      workspaces: clone(account.workspaces),
      email: account.email,
      userId: "p-bill",
      accountId: "acc-bill",
      userName: account.userName,
      role: this.role,
    };
  }

  private currentMembers(): WorkspaceMember[] {
    const workspace = this.assertWorkspace();
    if (!this.membersByWorkspace[workspace.id]) this.membersByWorkspace[workspace.id] = [];
    return this.membersByWorkspace[workspace.id] ?? [];
  }

  private workspaceProjects(): Project[] {
    const workspaceId = this.assertWorkspace().id;
    return this.projects.filter((project) => project.workspaceId === workspaceId && !project.archived);
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.find((item) => item.id === projectId && item.workspaceId === this.workspace?.id);
    if (!project) throw new Error("找不到这个项目。");
    return project;
  }

  private projectCounts(projectId: string): { open: number; total: number } {
    const issues = this.issues.filter((issue) => issue.projectId === projectId && issue.parentIds.length === 0);
    const closed = new Set(
      mockStatuses.filter((status) => status.category === "done" || status.category === "canceled").map((status) => status.id),
    );
    return {
      total: issues.length,
      open: issues.filter((issue) => !closed.has(issue.statusId)).length,
    };
  }

  private withCounts(project: Project): Project {
    const counts = this.projectCounts(project.id);
    return { ...clone(project), issueCount: counts.total, openCount: counts.open };
  }

  private assertManager(): void {
    this.assertWorkspace();
    if (this.role !== "OWNER" && this.role !== "MAINTAINER" && this.role !== "ADMIN") {
      throw new Error("暂不支持");
    }
  }

  private assertAccount(): AccountSession {
    if (!this.account) throw new Error("尚未登录。");
    return this.account;
  }

  private assertWorkspace(): WorkspaceChoice {
    this.assertAccount();
    if (!this.workspace) throw new Error("尚未连接。");
    return this.workspace;
  }
}
