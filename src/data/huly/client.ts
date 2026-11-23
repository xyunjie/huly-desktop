import * as accountClient from "@hcengineering/account-client";
import apiClient, { type PlatformClient } from "@hcengineering/api-client";
import * as collaboratorClient from "@hcengineering/collaborator-client";
import contactPlugin from "@hcengineering/contact";
import corePlugin, * as coreNs from "@hcengineering/core";
import rankPlugin from "@hcengineering/rank";
import tagsPlugin from "@hcengineering/tags";
import taskPlugin from "@hcengineering/task";
import trackerPlugin from "@hcengineering/tracker";
import type { LoginInfo, LoginInfoByToken, WorkspaceLoginInfo } from "@hcengineering/account-client";
import { parseServerConfig } from "@/domain/config";
import { safeErrorMessage } from "@/domain/secrets";
import {
  findWorkspace,
  mapAccountWorkspace,
  withWorkspaceRenewal,
} from "@/domain/session";
import { ISSUE_ATTACHMENT_LIMIT, type DeskClient } from "@/data/client";
import { canChangeWorkspaceRole, canRemoveWorkspaceMember } from "@/domain/members";
import {
  emailFromSocial,
  mergeWorkspaceMembers,
  normalizeMemberRows,
  type MemberRoleRow,
  type PersonInfoLite,
  type SocialEmail,
} from "@/domain/memberDirectory";
import { parseWorkspaceRole, type WorkspaceRole } from "@/domain/roles";
import { categoryFromHuly } from "@/domain/status";
import type {
  AccountAuthInput,
  AccountSession,
  Attachment,
  Comment,
  CommentFormat,
  Component,
  ComponentInput,
  CreateIssueInput,
  EditorTemplate,
  InboxNotification,
  Issue,
  IssuePatch,
  IssueTemplate,
  IssueTemplateInput,
  IssueTimeline,
  Milestone,
  MilestoneInput,
  Person,
  Project,
  ProjectBundle,
  ProjectPatch,
  ServerEndpoints,
  Session,
  Status,
  TimeSpendReport,
  WorkspaceChoice,
  WorkspaceMember,
} from "@/domain/types";
import { moduleBinding, readPlugin } from "./interop";
import { loadActivityFeed } from "./activity";
import { presentNotifications } from "./notifications";
import {
  decodeMarkupToMarkdown,
  encodeMarkdownToMarkup,
  extractHulyFileId,
  isHulyFileId,
  isInlineMarkupJson,
  sameDescriptionMarkup,
} from "./markup";
import {
  attachLabels,
  descriptionIsRef,
  displayPersonName,
  hulyMilestoneStatus,
  hulyPriority,
  isParentReference,
  mapAttachment,
  mapComponent,
  mapIssue,
  mapIssueTemplate,
  mapLabels,
  mapMilestone,
  mapPerson,
  mapProject,
  mapStatus,
  mapStatuses,
  mapTimeReport,
  matchCurrentPerson,
  storedPersonName,
  type RawAttachment,
  type RawInboxNotification,
  type RawIssue,
  type RawIssueTemplate,
  type RawNamed,
  type RawPerson,
  type RawProject,
  type RawStatus,
  type RawTag,
  type RawTimeReport,
} from "./mapping";

interface Plugins {
  tracker: {
    class: {
      Project: string;
      Issue: string;
      IssueTemplate: string;
      IssueStatus: string;
      Milestone: string;
      Component: string;
      TimeSpendReport: string;
    };
    taskTypes: { Issue: string; SubIssue?: string };
    ids: { NoParent: string };
    category: { Other: string };
  };
  task: { class: { ProjectType: string } };
  tags: { class: { TagElement: string; TagReference: string } };
  contact: {
    class: { Person: string; SocialIdentity?: string; Channel?: string };
    mixin?: { Employee?: string };
  };
  core: { space: { Space: string } };
  sorting: { Ascending: number; Descending: number };
  generateId: () => string;
  makeRank: (prev?: string, next?: string) => string;
  connect: typeof apiClient.connect;
  BrowserWebSocketFactory: typeof apiClient.BrowserWebSocketFactory;
  loadServerConfig: typeof apiClient.loadServerConfig;
  getAccountClient: typeof accountClient.getClient;
}

function loadPlugins(): Plugins {
  return {
    tracker: readPlugin(trackerPlugin),
    task: readPlugin(taskPlugin),
    tags: readPlugin(tagsPlugin),
    contact: readPlugin(contactPlugin),
    core: readPlugin(corePlugin),
    sorting: moduleBinding<{ Ascending: number; Descending: number }>(coreNs, "SortingOrder"),
    generateId: moduleBinding(coreNs, "generateId"),
    makeRank: moduleBinding(rankPlugin, "makeRank"),
    connect: moduleBinding(apiClient, "connect"),
    BrowserWebSocketFactory: moduleBinding(apiClient, "BrowserWebSocketFactory"),
    loadServerConfig: moduleBinding(apiClient, "loadServerConfig"),
    getAccountClient: moduleBinding(accountClient, "getClient"),
  };
}

export class HulyDeskClient implements DeskClient {
  readonly mode = "huly" as const;
  readonly commentWrite = true;
  #plugins: Plugins | null = null;
  #client: PlatformClient | null = null;
  #accountToken = "";
  #serverUrl = "";
  #accountsUrl = "";
  #endpoints: ServerEndpoints | null = null;
  #email = "";
  #userName = "";
  #userId: string | null = null;
  #workspaces: WorkspaceChoice[] = [];
  #workspace: WorkspaceChoice | null = null;
  #workspaceUuid = "";
  #workspaceRole: WorkspaceRole = "USER";
  #accountId: string | null = null;
  #workspaceToken = "";
  #peopleCache: Person[] = [];
  #statusCache: Status[] = [];
  #socialAuthorMap = new Map<string, string>();
  #socialLoaded = false;
  #imageCache = new Map<string, Promise<string | null>>();
  #listeners = new Set<() => void>();
  #notifyTimer: ReturnType<typeof setTimeout> | null = null;

  tokenForKeychain(): string {
    return this.#accountToken;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  private scheduleNotify(): void {
    if (this.#listeners.size === 0) return;
    if (this.#notifyTimer) clearTimeout(this.#notifyTimer);
    this.#notifyTimer = setTimeout(() => {
      this.#notifyTimer = null;
      for (const listener of this.#listeners) listener();
    }, 900);
  }

  async probe(serverUrl: string): Promise<ServerEndpoints> {
    const plugins = this.plugins();
    const config = await plugins.loadServerConfig(serverUrl);
    return parseServerConfig(config);
  }

  async authenticate(input: AccountAuthInput): Promise<AccountSession> {
    if (input.kind === "mock") {
      throw new Error("真实客户端不能打开示例数据。");
    }
    const plugins = this.plugins();
    const password = input.kind === "password" ? input.password : "";
    let accountToken = "";
    try {
      const config = await plugins.loadServerConfig(input.serverUrl);
      const endpoints = parseServerConfig(config);
      this.#serverUrl = input.serverUrl;
      this.#accountsUrl = endpoints.accountsUrl;
      this.#endpoints = endpoints;
      if (input.kind === "password") {
        const login = await plugins.getAccountClient(endpoints.accountsUrl).login(input.email, input.password);
        accountToken = readAccountToken(login);
        this.#email = input.email;
        this.#userName = login.name?.trim() || input.email;
        this.#accountId = login.account || this.#accountId;
      } else {
        accountToken = input.token.trim();
        if (!accountToken) throw new Error("请填写 API key（令牌）。");
        const info = await plugins.getAccountClient(endpoints.accountsUrl, accountToken).getLoginInfoByToken();
        const login = usableLoginInfo(info);
        this.#email = this.#email || "";
        this.#userName = login.name?.trim() || "已登录";
        this.#accountId = login.account || this.#accountId;
      }
      const person = await plugins
        .getAccountClient(endpoints.accountsUrl, accountToken)
        .getPerson()
        .catch(() => null);
      if (person) {
        const formatted = displayPersonName(`${person.lastName},${person.firstName}`);
        if (formatted) this.#userName = formatted;
      }
      this.#accountToken = accountToken;
      this.#workspaces = await this.fetchWorkspaces();
      this.#workspace = null;
      await this.closePlatform();
      return {
        serverUrl: this.#serverUrl,
        email: this.#email,
        userName: this.#userName,
        workspaces: this.#workspaces.map((workspace) => ({ ...workspace })),
      };
    } catch (error) {
      this.#accountToken = "";
      throw new Error(safeErrorMessage(error, [accountToken, password, input.kind === "token" ? input.token : ""]));
    }
  }

  async listWorkspaces(): Promise<WorkspaceChoice[]> {
    this.assertAccount();
    this.#workspaces = await this.fetchWorkspaces();
    return this.#workspaces.map((workspace) => ({ ...workspace }));
  }

  async enterWorkspace(workspaceUrl: string): Promise<Session> {
    this.assertAccount();
    const choice = findWorkspace(this.#workspaces, workspaceUrl);
    if (!choice) throw new Error("找不到这个工作区。");
    try {
      await withWorkspaceRenewal({
        run: () => this.openPlatform(choice),
        renew: () => this.closePlatform(),
      });
      return await this.currentSession();
    } catch (error) {
      throw new Error(safeErrorMessage(error, [this.#accountToken]));
    }
  }

  async switchWorkspace(workspaceUrl: string): Promise<Session> {
    await this.closePlatform();
    return this.enterWorkspace(workspaceUrl);
  }

  async disconnect(): Promise<void> {
    await this.closePlatform();
    if (this.#notifyTimer) {
      clearTimeout(this.#notifyTimer);
      this.#notifyTimer = null;
    }
    this.#accountToken = "";
    this.#workspaceToken = "";
    this.#serverUrl = "";
    this.#accountsUrl = "";
    this.#endpoints = null;
    this.#email = "";
    this.#userName = "";
    this.#userId = null;
    this.#workspaces = [];
    this.#workspace = null;
    this.#workspaceUuid = "";
    this.#workspaceRole = "USER";
    this.#accountId = null;
    this.#peopleCache = [];
    this.#statusCache = [];
    this.#socialAuthorMap.clear();
    this.#socialLoaded = false;
  }

  async listProjects() {
    const projects = await this.api().findAll<RawProject>(this.plugins().tracker.class.Project, {});
    return projects.filter((project) => !project.archived).map(mapProject);
  }

  async countIssuesByProject(): Promise<Record<string, { open: number; total: number }>> {
    const plugins = this.plugins();
    const issues = await this.api()
      .findAll<RawIssue>(plugins.tracker.class.Issue, {}, { limit: 5000 })
      .catch(() => [] as RawIssue[]);
    const counts: Record<string, { open: number; total: number }> = {};
    for (const issue of issues) {
      const parent = issue.attachedTo;
      if (parent && isParentReference(parent, issue._id)) continue;
      if ((issue.parents ?? []).some((item) => isParentReference(item.parentId, issue._id))) continue;
      const bucket = counts[issue.space] ?? { open: 0, total: 0 };
      bucket.total += 1;
      const category = categoryFromHuly({ id: issue.status });
      if (category !== "done" && category !== "canceled") bucket.open += 1;
      counts[issue.space] = bucket;
    }
    return counts;
  }

  async listPeople(): Promise<Person[]> {
    const people = await this.safePeople();
    this.#peopleCache = people.map(mapPerson);
    return this.#peopleCache;
  }

  async listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    const people = (await this.safePeople()).map(mapPerson);
    this.#peopleCache = people;
    const employees = (await this.safeEmployees()).map(mapPerson);
    const emails = await this.safeSocialEmails();
    let roles: MemberRoleRow[] = [];
    try {
      roles = normalizeMemberRows(await this.workspaceAccountApi().getWorkspaceMembers());
    } catch {
      try {
        roles = normalizeMemberRows(await this.accountApi().getWorkspaceMembers());
      } catch {
        roles = [];
      }
    }
    const profiles: PersonInfoLite[] = [];
    if (roles.length > 0) {
      const infos = await Promise.all(
        roles.map(async (row) => {
          const info = await this.workspaceAccountApi()
            .getPersonInfo(row.accountId)
            .catch(() => this.accountApi().getPersonInfo(row.accountId).catch(() => null));
          if (!info) return null;
          const email = (info.socialIds ?? [])
            .map((item) => emailFromSocial(item))
            .find((value): value is string => Boolean(value));
          const name = displayPersonName(storedPersonName(info.firstName ?? "", info.lastName ?? ""));
          return { accountId: row.accountId, name: name || undefined, email };
        }),
      );
      for (const profile of infos) {
        if (profile) profiles.push(profile);
      }
    }
    return mergeWorkspaceMembers({ roles, people, employees, emails, profiles });
  }

  async updateWorkspaceRole(accountId: string, role: WorkspaceRole): Promise<void> {
    const members = await this.listWorkspaceMembers();
    const target = members.find((member) => member.accountId === accountId);
    if (!target) throw new Error("找不到这个成员。");
    const allowed = canChangeWorkspaceRole({
      actorRole: this.#workspaceRole,
      target,
      nextRole: role,
      members,
    });
    if (!allowed.ok) throw new Error(allowed.reason);
    await this.workspaceAccountApi().updateWorkspaceRole(accountId, role);
  }

  async sendInvite(email: string, role: WorkspaceRole): Promise<void> {
    const address = email.trim();
    if (!address || !address.includes("@")) throw new Error("请填写有效的邮箱。");
    await this.workspaceAccountApi().sendInvite(address, role);
  }

  async resendInvite(email: string, role: WorkspaceRole): Promise<void> {
    const address = email.trim();
    if (!address || !address.includes("@")) throw new Error("请填写有效的邮箱。");
    await this.workspaceAccountApi().resendInvite(address, role);
  }

  async createInviteLink(email: string, role: WorkspaceRole, firstName = "", lastName = ""): Promise<string> {
    const address = email.trim();
    if (!address || !address.includes("@")) throw new Error("请填写有效的邮箱。");
    return this.workspaceAccountApi().createInviteLink(address, role, false, firstName, lastName);
  }

  async removeWorkspaceMember(accountId: string): Promise<void> {
    const members = await this.listWorkspaceMembers();
    const target = members.find((member) => member.accountId === accountId);
    if (!target) throw new Error("找不到这个成员。");
    const allowed = canRemoveWorkspaceMember({
      actorRole: this.#workspaceRole,
      actorAccountId: this.#accountId ?? "",
      target,
      members,
    });
    if (!allowed.ok) throw new Error(allowed.reason);
    await this.workspaceAccountApi().leaveWorkspace(accountId);
  }

  async updateProjectMembers(projectId: string, memberIds: string[]): Promise<Project> {
    return this.updateProjectRecord(projectId, { members: [...new Set(memberIds)] });
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
    const operations: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("请填写项目名称。");
      operations.name = name;
    }
    if (patch.description !== undefined) operations.description = patch.description;
    if (patch.defaultAssigneeId !== undefined) operations.defaultAssignee = patch.defaultAssigneeId;
    if (patch.archived !== undefined) operations.archived = patch.archived;
    return this.updateProjectRecord(projectId, operations);
  }

  async changeDisplayName(firstName: string, lastName: string): Promise<string> {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first && !last) throw new Error("请填写姓名。");
    await this.accountApi().changeUsername(first, last);
    const display = displayPersonName(storedPersonName(first, last));
    this.#userName = display || this.#userName;
    return this.#userName;
  }

  async loadProject(projectId: string, { targetIssueId, limit }: { targetIssueId?: string; limit?: number } = {}): Promise<ProjectBundle> {
    const plugins = this.plugins();
    const client = this.api();
    const project = await client.findOne<RawProject>(
      plugins.tracker.class.Project,
      { _id: projectId },
      { lookup: { type: plugins.task.class.ProjectType } },
    );
    if (!project) throw new Error("找不到这个项目。");
    const rawIssues = [...await client.findAll<RawIssue>(
      plugins.tracker.class.Issue,
      { space: projectId },
      { limit, sort: { rank: plugins.sorting.Ascending } },
    )];
    if (targetIssueId && !rawIssues.some((issue) => issue._id === targetIssueId)) {
      const target = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: targetIssueId, space: projectId });
      if (target) rawIssues.push(target);
    }
    const statusIds = [
      ...new Set([
        ...(project.$lookup?.type?.statuses ?? []).map((status) => status._id),
        ...rawIssues.map((issue) => issue.status).filter((id): id is string => Boolean(id)),
      ]),
    ];
    const statusDocs = statusIds.length
      ? await client
          .findAll<RawStatus>(plugins.tracker.class.IssueStatus, { _id: { $in: statusIds } })
          .catch(() => [] as RawStatus[])
      : [];
    const references = await client
      .findAll<RawTag>(plugins.tags.class.TagReference, {
        attachedToClass: plugins.tracker.class.Issue,
        space: projectId,
      })
      .catch(() => [] as RawTag[]);
    const tags = await client
      .findAll<RawTag>(plugins.tags.class.TagElement, { targetClass: plugins.tracker.class.Issue })
      .catch(() => [] as RawTag[]);
    const milestones = await client
      .findAll<RawNamed>(plugins.tracker.class.Milestone, { space: projectId })
      .catch(() => [] as RawNamed[]);
    const components = await client
      .findAll<RawNamed>(plugins.tracker.class.Component, { space: projectId })
      .catch(() => [] as RawNamed[]);
    const issues = attachLabels(rawIssues.map((issue) => mapIssue(issue, plainDescription(issue.description))), references);
    const statuses = mapStatuses(project, statusDocs);
    this.#statusCache = statuses;
    return {
      statuses,
      milestones: milestones.map(mapMilestone),
      components: components.map(mapComponent),
      labels: mapLabels(tags),
      issues,
    };
  }

  async findIssueByIdentifier(identifier: string): Promise<Issue | null> {
    const api = this.api();
    const issueClass = this.plugins().tracker.class.Issue;
    const uppercase = identifier.toUpperCase();
    const issue = await api.findOne<RawIssue>(issueClass, { identifier })
      ?? (identifier === uppercase ? undefined : await api.findOne<RawIssue>(issueClass, { identifier: uppercase }))
      ?? await api.findOne<RawIssue>(issueClass, { _id: identifier });
    return issue ? mapIssue(issue, plainDescription(issue.description)) : null;
  }

  async listAssigned(personId: string): ReturnType<DeskClient["listAssigned"]> {
    const plugins = this.plugins();
    const client = this.api();
    const rawIssues = await client.findAll<RawIssue>(
      plugins.tracker.class.Issue,
      { assignee: personId },
      { sort: { modifiedOn: plugins.sorting.Descending } },
    );
    const statusIds = [...new Set(rawIssues.map((issue) => issue.status).filter(Boolean))];
    const statusDocs = statusIds.length
      ? await client.findAll<RawStatus>(plugins.tracker.class.IssueStatus, { _id: { $in: statusIds } })
          .catch(() => [] as RawStatus[])
      : [];
    return {
      issues: rawIssues.map((issue) => mapIssue(issue, plainDescription(issue.description))),
      statuses: statusDocs.map((doc) => mapStatus(doc._id, doc)),
    };
  }

  async hydrateIssue(issue: Issue): Promise<Issue> {
    if (!descriptionIsRef(issue.descriptionRef)) return issue;
    try {
      const markup = await this.api().fetchMarkup(
        this.plugins().tracker.class.Issue,
        issue.id,
        "description",
        issue.descriptionRef,
        "markup",
      );
      if (typeof markup !== "string") throw new Error("描述内容不是有效的 Huly 文档。");
      return { ...issue, description: decodeMarkupToMarkdown(markup), descriptionMarkup: markup, descriptionUnavailable: false };
    } catch {
      return { ...issue, descriptionUnavailable: true };
    }
  }

  async updateIssue(id: string, patch: IssuePatch): Promise<Issue> {
    const plugins = this.plugins();
    const client = this.api();
    const current = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: id });
    if (!current) throw new Error("找不到这个任务。");
    const operations: Record<string, unknown> = {};
    if (patch.title !== undefined) operations.title = patch.title.trim();
    if (patch.statusId !== undefined) operations.status = patch.statusId;
    if (patch.priority !== undefined) operations.priority = hulyPriority(patch.priority);
    if (patch.assigneeId !== undefined) operations.assignee = patch.assigneeId;
    if (patch.milestoneId !== undefined) operations.milestone = patch.milestoneId;
    if (patch.componentId !== undefined) operations.component = patch.componentId;
    if (patch.dueDate !== undefined) operations.dueDate = patch.dueDate;
    if (patch.estimationHours !== undefined) {
      operations.estimation = patch.estimationHours;
      operations.remainingTime = Math.max(0, patch.estimationHours - (current.reportedTime ?? 0));
    }
    if (patch.blockedBy !== undefined) {
      operations.blockedBy = patch.blockedBy.map((refId) => ({
        _id: refId,
        _class: plugins.tracker.class.Issue,
      }));
    }
    if (patch.relations !== undefined) {
      operations.relations = patch.relations.map((refId) => ({
        _id: refId,
        _class: plugins.tracker.class.Issue,
      }));
    }
    if (patch.parentId !== undefined) {
      if (!patch.parentId) {
        operations.attachedTo = plugins.tracker.ids.NoParent || current.space;
        operations.attachedToClass = plugins.tracker.class.Project;
        operations.collection = "issues";
        operations.parents = [];
      } else {
        if (patch.parentId === id) throw new Error("任务不能把自己设为上级任务。");
        const parent = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: patch.parentId });
        if (!parent) throw new Error("找不到指定的上级任务。");
        if ((parent.parents ?? []).some((item) => item.parentId === id)) {
          throw new Error("不能把自己的子任务设为上级任务。");
        }
        operations.attachedTo = parent._id;
        operations.attachedToClass = plugins.tracker.class.Issue;
        operations.collection = "subIssues";
        operations.parents = [
          ...(parent.parents ?? []),
          { parentId: parent._id, identifier: parent.identifier, parentTitle: parent.title },
        ];
      }
    }
    if (patch.descriptionMarkup !== undefined) {
      const markup = patch.descriptionMarkup;
      const issueClass = plugins.tracker.class.Issue;
      if (!isInlineMarkupJson(markup)) throw new Error("描述内容不是有效的 Huly 文档。");
      if (descriptionIsRef(current.description)) {
        if (!this.#endpoints || !this.#workspaceUuid || !this.#workspaceToken) throw new Error("尚未连接协作服务。");
        const latest = await client.fetchMarkup(issueClass, id, "description", current.description, "markup");
        if (!sameDescriptionMarkup(latest, patch.previousDescriptionMarkup)) {
          throw new Error("描述已在其他窗口更新。请复制你修改的内容并重新打开任务，避免覆盖他人的修改。");
        }
        // Existing collaborative documents must be updated, not recreated with a new snapshot.
        const getClient = moduleBinding<typeof collaboratorClient.getClient>(collaboratorClient, "getClient");
        await getClient(this.#workspaceUuid, this.#workspaceToken, this.#endpoints.collaboratorUrl)
          .updateMarkup({ objectClass: issueClass, objectId: id, objectAttr: "description" }, markup);
      } else {
        if (typeof current.description === "string" && isInlineMarkupJson(current.description) && !sameDescriptionMarkup(current.description, patch.previousDescriptionMarkup)) {
          throw new Error("描述已在其他窗口更新。请复制修改的内容，再重新打开任务。");
        }
        operations.description = await client.uploadMarkup(issueClass, id, "description", markup, "markup");
      }
    } else if (patch.description !== undefined) {
      if (patch.description.trim()) {
        // Upload markup explicitly to bypass api-client 0.7.423 missing `await` in processMarkup.
        operations.description = await client.uploadMarkup(
          plugins.tracker.class.Issue,
          id,
          "description",
          patch.description,
          "markdown",
        );
      } else {
        operations.description = null;
      }
    }
    if (Object.keys(operations).length > 0) {
      await client.updateDoc(plugins.tracker.class.Issue, current.space, id, operations);
    }
    if (patch.labelIds) {
      await this.syncLabels(current.space, id, patch.labelIds);
    }
    const updated = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: id });
    if (!updated) throw new Error("任务已更新，但重新读取失败。");
    const mapped = mapIssue(updated, patch.description ?? plainDescription(updated.description));
    if (patch.descriptionMarkup !== undefined) {
      mapped.descriptionMarkup = patch.descriptionMarkup;
      mapped.description = decodeMarkupToMarkdown(patch.descriptionMarkup);
      mapped.descriptionUnavailable = false;
    }
    if (patch.labelIds) mapped.labelIds = [...patch.labelIds];
    return mapped;
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const plugins = this.plugins();
    const client = this.api();
    const title = input.title.trim();
    if (!title) throw new Error("请填写标题。");
    const project = await client.findOne<RawProject>(plugins.tracker.class.Project, { _id: input.projectId });
    if (!project) throw new Error("找不到这个项目。");
    const issueId = plugins.generateId();
    const incResult = await client.updateDoc(
      plugins.tracker.class.Project,
      plugins.core.space.Space,
      project._id,
      { $inc: { sequence: 1 } },
      true,
    );
    const sequence = readSequence(incResult) ?? (project.sequence ?? 0) + 1;
    const last = await client.findOne<RawIssue>(
      plugins.tracker.class.Issue,
      { space: project._id },
      { sort: { rank: plugins.sorting.Descending } },
    );

    let attachedTo = project._id;
    let attachedToClass = plugins.tracker.class.Project;
    let collection = "issues";
    let kind = plugins.tracker.taskTypes.Issue;
    let parents: { parentId: string; identifier?: string; parentTitle?: string }[] = [];

    if (input.parentId) {
      const parent = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: input.parentId });
      if (!parent) throw new Error("找不到指定的上级任务。");
      attachedTo = parent._id;
      attachedToClass = plugins.tracker.class.Issue;
      collection = "subIssues";
      kind = plugins.tracker.taskTypes.SubIssue || plugins.tracker.taskTypes.Issue;
      parents = [
        ...(parent.parents ?? []),
        { parentId: parent._id, identifier: parent.identifier, parentTitle: parent.title },
      ];
    }

    const descriptionRef = input.description.trim()
      ? await client.uploadMarkup(plugins.tracker.class.Issue, issueId, "description", input.description, "markdown")
      : null;

    const estimation = typeof input.estimationHours === "number" ? input.estimationHours : 0;

    await client.addCollection(
      plugins.tracker.class.Issue,
      project._id,
      attachedTo,
      attachedToClass,
      collection,
      {
        title,
        description: descriptionRef,
        status: input.statusId || project.defaultIssueStatus,
        number: sequence,
        kind,
        identifier: `${project.identifier ?? "ISSUE"}-${sequence}`,
        priority: hulyPriority(input.priority),
        assignee: input.assigneeId,
        component: input.componentId,
        milestone: input.milestoneId,
        estimation,
        remainingTime: estimation,
        reportedTime: 0,
        reports: 0,
        subIssues: 0,
        parents,
        childInfo: [],
        dueDate: input.dueDate ?? null,
        rank: plugins.makeRank(last?.rank, undefined),
      },
      issueId,
    );
    if (input.labelIds.length > 0) {
      await this.syncLabels(project._id, issueId, input.labelIds);
    }
    const created = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: issueId });
    if (!created) throw new Error("任务已创建，但重新读取失败。");
    const mapped = mapIssue(created, input.description.trim());
    mapped.labelIds = [...input.labelIds];
    return mapped;
  }

  async loadIssueTimeline(issue: Issue, options?: { commentsOnly?: boolean }): Promise<IssueTimeline> {
    const client = this.api();
    const [activityModule, chunterModule] = await Promise.all([
      import("@hcengineering/activity"), import("@hcengineering/chunter"), this.ensureAuthorDirectory(),
    ]);
    const activity = readPlugin<typeof activityModule.default>(activityModule);
    const chunter = readPlugin<typeof chunterModule.default>(chunterModule);
    const refUrl = this.#serverUrl && this.#workspaceUuid
      ? `${this.#serverUrl.replace(/\/+$/, "")}/browse?workspace=${encodeURIComponent(this.#workspaceUuid)}`
      : undefined;
    return loadActivityFeed(client, issue, { ...activity.class, ...chunter.class }, {
      commentsOnly: options?.commentsOnly,
      descending: this.plugins().sorting.Descending,
      statuses: this.#statusCache,
      people: this.#peopleCache,
      resolveAuthor: (ref) => this.resolveAuthorName(ref),
      readDescriptionSnapshot: (ref) => {
        if (this.#client !== client) return Promise.reject(new Error("工作区已切换。"));
        return this.readDescriptionSnapshot(ref);
      },
      refUrl,
    });
  }

  async listEditorTemplates(): Promise<EditorTemplate[]> {
    const rows = await this.api().findAll<{ _id: string; title?: string; message?: string }>("templates:class:MessageTemplate", {});
    return rows.filter((row) => typeof row.message === "string" && row.message.trim())
      .map((row) => ({ id: row._id, title: row.title?.trim() || "未命名模板", body: row.message! }));
  }

  async readDescriptionSnapshot(ref: string): Promise<string> {
    // Fetch this immutable blob, not the live collaborative document.
    if (!/^[a-z\d][a-z\d.:_-]{0,255}$/i.test(ref)) throw new Error("历史描述引用无效。");
    const url = this.resolveStorageUrl("files", ref);
    if (!url || !this.#workspaceToken) throw new Error("历史描述暂不可用。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.#workspaceToken}` }, credentials: "omit", redirect: "error", signal: controller.signal,
      });
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) throw new Error("无法读取历史描述。");
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  async addComment(issueId: string, body: string, format: CommentFormat = "markdown"): Promise<Comment> {
    const text = body.trim();
    if (!text) throw new Error("评论不能为空。");
    const plugins = this.plugins();
    const client = this.api();
    const issue = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: issueId });
    if (!issue) throw new Error("找不到这个任务。");
    const chunter = readPlugin<{ class: { ChatMessage: string } }>(await import("@hcengineering/chunter"));
    const commentId = plugins.generateId();
    const markup = format === "markup" ? text : encodeMarkdownToMarkup(text);
    if (!isInlineMarkupJson(markup)) throw new Error("评论内容格式有误。");
    await client.addCollection(
      chunter.class.ChatMessage,
      issue.space,
      issueId,
      plugins.tracker.class.Issue,
      "comments",
      { message: markup, attachments: 0 },
      commentId,
    );
    return {
      id: commentId,
      issueId,
      authorId: this.#userId,
      authorName: this.#userName || "我",
      body: format === "markup" ? decodeMarkupToMarkdown(markup) : text,
      nativeMarkup: markup,
      createdOn: Date.now(),
    };
  }

  async listAttachments(issueId: string, options?: { commentIds?: string[]; fileId?: string }): Promise<Attachment[]> {
    const client = this.api();
    const attachmentPlugin = readPlugin<{ class: { Attachment: string } }>(await import("@hcengineering/attachment"));
    const rows = await client.findAll<RawAttachment>(
      attachmentPlugin.class.Attachment,
      {
        attachedTo: options?.commentIds?.length ? { $in: [issueId, ...options.commentIds] } : issueId,
        ...(options?.fileId ? { file: options.fileId } : {}),
      },
      { limit: ISSUE_ATTACHMENT_LIMIT, sort: { lastModified: this.plugins().sorting.Descending } },
    );
    return rows.map((row) => mapAttachment(row, issueId));
  }

  workspaceFileId(src: string): string | null {
    return extractHulyFileId(src, this.#serverUrl);
  }

  async fetchWorkspaceFile(fileId: string, signal: AbortSignal): Promise<Response> {
    if (!isHulyFileId(fileId)) throw new Error("文件 ID 无效。");
    const url = this.resolveStorageUrl("files", fileId);
    if (!url || !this.#workspaceToken) throw new Error("工作区的文件服务尚未就绪。");
    try {
      return await fetch(url, {
        headers: { Authorization: `Bearer ${this.#workspaceToken}` }, credentials: "omit", redirect: "error", signal,
      });
    } catch {
      throw new Error("无法连接工作区的文件服务。");
    }
  }

  async uploadAttachment(issueId: string, file: File): Promise<Attachment> {
    const plugins = this.plugins();
    const client = this.api();
    const issue = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: issueId });
    if (!issue) throw new Error("找不到这个任务。");
    const uploadUrl = this.resolveStorageUrl("upload");
    if (!uploadUrl) throw new Error("服务器未配置 UPLOAD_URL，无法上传附件。");

    const formData = new FormData();
    formData.append("file", file, file.name);
    const token = this.#workspaceToken || this.#accountToken;
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`附件上传失败（HTTP ${response.status}）。`);
    }
    const payload = (await response.json()) as Array<{ id?: string; error?: string; metadata?: { size?: number; contentType?: string; lastModified?: number } }>;
    const first = payload[0];
    if (!first?.id) {
      throw new Error(first?.error ? `附件上传失败：${first.error}` : "附件上传没有返回文件标识。");
    }

    const attachmentPlugin = readPlugin<{ class: { Attachment: string } }>(await import("@hcengineering/attachment"));
    const attachmentId = plugins.generateId();
    await client.addCollection(
      attachmentPlugin.class.Attachment,
      issue.space,
      issueId,
      plugins.tracker.class.Issue,
      "attachments",
      {
        name: file.name,
        file: first.id,
        size: first.metadata?.size ?? file.size,
        type: first.metadata?.contentType || file.type || "application/octet-stream",
        lastModified: first.metadata?.lastModified ?? file.lastModified ?? Date.now(),
      },
      attachmentId,
    );

    return {
      id: attachmentId,
      issueId,
      fileId: first.id,
      name: file.name,
      size: first.metadata?.size ?? file.size,
      type: first.metadata?.contentType || file.type || "application/octet-stream",
      lastModified: first.metadata?.lastModified ?? file.lastModified ?? Date.now(),
    };
  }

  async downloadAttachment(attachment: Attachment): Promise<void> {
    const filesUrl = this.resolveStorageUrl("files", attachment.fileId);
    if (!filesUrl) throw new Error("服务器未配置 FILES_URL，无法下载附件。");
    const token = this.#workspaceToken || this.#accountToken;
    const response = await fetch(filesUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`附件下载失败（HTTP ${response.status}）。`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async deleteAttachment(issueId: string, attachmentId: string): Promise<void> {
    const plugins = this.plugins();
    const client = this.api();
    const issue = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: issueId });
    if (!issue) throw new Error("找不到这个任务。");
    const attachmentPlugin = readPlugin<{ class: { Attachment: string } }>(await import("@hcengineering/attachment"));
    await client.removeCollection(
      attachmentPlugin.class.Attachment,
      issue.space,
      attachmentId,
      issueId,
      plugins.tracker.class.Issue,
      "attachments",
    );
  }

  async createMilestone(projectId: string, input: MilestoneInput): Promise<Milestone> {
    const name = input.name.trim();
    if (!name) throw new Error("请填写里程碑名称。");
    const plugins = this.plugins();
    const id = await this.api().createDoc(plugins.tracker.class.Milestone, projectId, {
      label: name,
      description: input.description?.trim() ?? "",
      status: hulyMilestoneStatus(input.status),
      targetDate: input.targetDate ?? null,
      comments: 0,
      attachments: 0,
    });
    const created = await this.api().findOne<RawNamed>(plugins.tracker.class.Milestone, { _id: id });
    return mapMilestone(
      created ?? {
        _id: id,
        space: projectId,
        label: name,
        description: input.description?.trim() ?? "",
        status: hulyMilestoneStatus(input.status),
        targetDate: input.targetDate ?? null,
      },
    );
  }

  async updateMilestone(id: string, patch: Partial<MilestoneInput>): Promise<Milestone> {
    const plugins = this.plugins();
    const current = await this.api().findOne<RawNamed>(plugins.tracker.class.Milestone, { _id: id });
    if (!current) throw new Error("找不到这个里程碑。");
    const ops: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("请填写里程碑名称。");
      ops.label = name;
    }
    if (patch.description !== undefined) ops.description = patch.description;
    if (patch.status !== undefined) ops.status = hulyMilestoneStatus(patch.status);
    if (patch.targetDate !== undefined) ops.targetDate = patch.targetDate;
    if (Object.keys(ops).length > 0) {
      await this.api().updateDoc(plugins.tracker.class.Milestone, current.space || "", id, ops);
    }
    const updated = await this.api().findOne<RawNamed>(plugins.tracker.class.Milestone, { _id: id });
    return mapMilestone(updated ?? { ...current, ...ops });
  }

  async deleteMilestone(id: string): Promise<void> {
    const plugins = this.plugins();
    const current = await this.api().findOne<RawNamed>(plugins.tracker.class.Milestone, { _id: id });
    if (!current) return;
    await this.api().removeDoc(plugins.tracker.class.Milestone, current.space || "", id);
  }

  async createComponent(projectId: string, input: ComponentInput): Promise<Component> {
    const name = input.name.trim();
    if (!name) throw new Error("请填写组件名称。");
    const plugins = this.plugins();
    const id = await this.api().createDoc(plugins.tracker.class.Component, projectId, {
      label: name,
      description: input.description?.trim() ?? "",
      lead: input.leadId ?? null,
      comments: 0,
      attachments: 0,
    });
    const created = await this.api().findOne<RawNamed>(plugins.tracker.class.Component, { _id: id });
    return mapComponent(
      created ?? {
        _id: id,
        space: projectId,
        label: name,
        description: input.description?.trim() ?? "",
        lead: input.leadId ?? null,
      },
    );
  }

  async updateComponent(id: string, patch: Partial<ComponentInput>): Promise<Component> {
    const plugins = this.plugins();
    const current = await this.api().findOne<RawNamed>(plugins.tracker.class.Component, { _id: id });
    if (!current) throw new Error("找不到这个组件。");
    const ops: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("请填写组件名称。");
      ops.label = name;
    }
    if (patch.description !== undefined) ops.description = patch.description;
    if (patch.leadId !== undefined) ops.lead = patch.leadId;
    if (Object.keys(ops).length > 0) {
      await this.api().updateDoc(plugins.tracker.class.Component, current.space || "", id, ops);
    }
    const updated = await this.api().findOne<RawNamed>(plugins.tracker.class.Component, { _id: id });
    return mapComponent(updated ?? { ...current, ...ops });
  }

  async deleteComponent(id: string): Promise<void> {
    const plugins = this.plugins();
    const current = await this.api().findOne<RawNamed>(plugins.tracker.class.Component, { _id: id });
    if (!current) return;
    await this.api().removeDoc(plugins.tracker.class.Component, current.space || "", id);
  }

  async listTemplates(projectId: string): Promise<IssueTemplate[]> {
    try {
      const plugins = this.plugins();
      const rows = await this.api().findAll<RawIssueTemplate>(
        plugins.tracker.class.IssueTemplate,
        { space: projectId },
        { limit: 100 },
      );
      return rows.map(mapIssueTemplate);
    } catch {
      return [];
    }
  }

  async createTemplate(projectId: string, input: IssueTemplateInput): Promise<IssueTemplate> {
    const title = input.title.trim();
    if (!title) throw new Error("请填写模板名称。");
    const plugins = this.plugins();
    const id = await this.api().createDoc(plugins.tracker.class.IssueTemplate, projectId, {
      title,
      description: input.description,
      priority: hulyPriority(input.priority),
      assignee: input.assigneeId,
      milestone: input.milestoneId,
      component: input.componentId,
      labels: input.labelIds,
      estimation: input.estimationHours ?? 0,
      children: [],
      comments: 0,
      attachments: 0,
      relations: [],
    });
    const created = await this.api().findOne<RawIssueTemplate>(plugins.tracker.class.IssueTemplate, { _id: id });
    return mapIssueTemplate(
      created ?? {
        _id: id,
        space: projectId,
        title,
        description: input.description,
        priority: hulyPriority(input.priority),
        assignee: input.assigneeId,
        milestone: input.milestoneId,
        component: input.componentId,
        labels: input.labelIds,
        estimation: input.estimationHours ?? 0,
      },
    );
  }

  async updateTemplate(id: string, patch: Partial<IssueTemplateInput>): Promise<IssueTemplate> {
    const plugins = this.plugins();
    const current = await this.api().findOne<RawIssueTemplate>(plugins.tracker.class.IssueTemplate, { _id: id });
    if (!current) throw new Error("找不到这个模板。");
    const ops: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error("请填写模板名称。");
      ops.title = title;
    }
    if (patch.description !== undefined) ops.description = patch.description;
    if (patch.priority !== undefined) ops.priority = hulyPriority(patch.priority);
    if (patch.assigneeId !== undefined) ops.assignee = patch.assigneeId;
    if (patch.milestoneId !== undefined) ops.milestone = patch.milestoneId;
    if (patch.componentId !== undefined) ops.component = patch.componentId;
    if (patch.labelIds !== undefined) ops.labels = patch.labelIds;
    if (patch.estimationHours !== undefined) ops.estimation = patch.estimationHours;
    if (Object.keys(ops).length > 0) {
      await this.api().updateDoc(plugins.tracker.class.IssueTemplate, current.space || "", id, ops);
    }
    const updated = await this.api().findOne<RawIssueTemplate>(plugins.tracker.class.IssueTemplate, { _id: id });
    return mapIssueTemplate(updated ?? { ...current, ...ops });
  }

  async deleteTemplate(id: string): Promise<void> {
    const plugins = this.plugins();
    const current = await this.api().findOne<RawIssueTemplate>(plugins.tracker.class.IssueTemplate, { _id: id });
    if (!current) return;
    await this.api().removeDoc(plugins.tracker.class.IssueTemplate, current.space || "", id);
  }

  async listTimeReports(issueId: string): Promise<TimeSpendReport[]> {
    try {
      const plugins = this.plugins();
      const people = this.#peopleCache.length > 0 ? this.#peopleCache : await this.listPeople();
      const rows = await this.api().findAll<RawTimeReport>(
        plugins.tracker.class.TimeSpendReport,
        { attachedTo: issueId },
        { limit: 100, sort: { date: plugins.sorting.Descending } },
      );
      return rows.map((row) => mapTimeReport(row, issueId, people));
    } catch {
      return [];
    }
  }

  async reportTime(
    issueId: string,
    input: { hours: number; date: number; description: string; employeeId?: string | null },
  ): Promise<TimeSpendReport> {
    if (!Number.isFinite(input.hours) || input.hours <= 0) {
      throw new Error("请填写大于 0 的工时数。");
    }
    const plugins = this.plugins();
    const client = this.api();
    const issue = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: issueId });
    if (!issue) throw new Error("找不到这个任务。");
    const employeeId = input.employeeId ?? this.#userId ?? null;
    const reportId = await client.addCollection(
      plugins.tracker.class.TimeSpendReport,
      issue.space,
      issueId,
      plugins.tracker.class.Issue,
      "reports",
      {
        employee: employeeId,
        date: input.date,
        value: input.hours,
        description: input.description.trim(),
      },
    );
    const people = this.#peopleCache.length > 0 ? this.#peopleCache : await this.listPeople();
    const person = employeeId ? people.find((item) => item.id === employeeId) : undefined;
    return {
      id: reportId,
      issueId,
      employeeId,
      employeeName: person?.name || this.#userName || "我",
      date: input.date,
      value: input.hours,
      description: input.description.trim(),
    };
  }

  async deleteTimeReport(issueId: string, reportId: string): Promise<void> {
    const plugins = this.plugins();
    const client = this.api();
    const issue = await client.findOne<RawIssue>(plugins.tracker.class.Issue, { _id: issueId });
    if (!issue) throw new Error("找不到这个任务。");
    await client.removeCollection(
      plugins.tracker.class.TimeSpendReport,
      issue.space,
      reportId,
      issueId,
      plugins.tracker.class.Issue,
      "reports",
    );
  }

  async listNotifications(): Promise<InboxNotification[]> {
    const client = this.api();
    const [notificationModule, activityModule, chunterModule, account] = await Promise.all([
      import("@hcengineering/notification"), import("@hcengineering/activity"), import("@hcengineering/chunter"), client.getAccount(),
    ]);
    const user = account.uuid;
    if (!user) throw new Error("无法确认收件箱所属账号。");
    const notification = readPlugin<typeof notificationModule.default>(notificationModule);
    const activity = readPlugin<typeof activityModule.default>(activityModule);
    const chunter = readPlugin<typeof chunterModule.default>(chunterModule);
    const plugins = this.plugins();
    const rows = await client.findAll<RawInboxNotification>(notification.class.InboxNotification,
      { user, archived: { $ne: true } }, { limit: 50, sort: { createdOn: plugins.sorting.Descending } });
    if (!rows.length) return [];
    await this.ensureAuthorDirectory();
    return presentNotifications(client, rows, {
      accountId: user, people: this.#peopleCache, resolveAuthor: (ref) => this.resolveAuthorName(ref),
      classes: {
        context: notification.class.DocNotifyContext, activity: activity.class.ActivityMessage, docUpdate: activity.class.DocUpdateMessage,
        chat: chunter.class.ChatMessage, thread: chunter.class.ThreadMessage,
        issue: plugins.tracker.class.Issue, project: plugins.tracker.class.Project, issueStatus: plugins.tracker.class.IssueStatus,
      },
    });
  }

  async markNotificationRead(id: string): Promise<void> {
    const client = this.api();
    const user = (await client.getAccount()).uuid;
    if (!user) throw new Error("无法确认收件箱所属账号。");
    const notificationPlugin = readPlugin<{ class: { InboxNotification: string } }>(
      await import("@hcengineering/notification"),
    );
    const row = await client.findOne<RawInboxNotification>(notificationPlugin.class.InboxNotification, { _id: id, user });
    if (!row?.space) throw new Error("找不到这条通知。");
    await client.updateDoc(row._class || notificationPlugin.class.InboxNotification, row.space, id, {
      isViewed: true,
    });
  }

  async markAllNotificationsRead(): Promise<void> {
    const client = this.api();
    const user = (await client.getAccount()).uuid;
    if (!user) throw new Error("无法确认收件箱所属账号。");
    const notificationPlugin = readPlugin<{ class: { InboxNotification: string } }>(
      await import("@hcengineering/notification"),
    );
    const unread = await client.findAll<RawInboxNotification>(
      notificationPlugin.class.InboxNotification,
      { user, archived: { $ne: true }, isViewed: false },
    );
    await Promise.all(
      unread.map((row) => {
        if (!row.space) throw new Error("通知所属空间不存在。");
        return client.updateDoc(row._class || notificationPlugin.class.InboxNotification, row.space, row._id, {
          isViewed: true,
        });
      }),
    );
  }

  async resolveImageSrc(src: string): Promise<string | null> {
    const trimmed = src.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
    const cached = this.#imageCache.get(trimmed);
    if (cached) return cached;

    const promise = this.fetchImageObjectUrl(trimmed).catch(() => null);
    this.#imageCache.set(trimmed, promise);
    const resolved = await promise;
    if (this.#imageCache.get(trimmed) !== promise) return null;
    if (!resolved) this.#imageCache.delete(trimmed);
    return resolved;
  }

  private async fetchImageObjectUrl(src: string): Promise<string | null> {
    const fileId = this.workspaceFileId(src);
    const base = this.#serverUrl.replace(/\/+$/, "");
    const wsId = this.#workspaceUuid || this.#workspace?.id || "";
    const candidates: string[] = [];

    if (fileId) {
      const storageUrl = this.resolveStorageUrl("files", fileId);
      if (storageUrl) candidates.push(storageUrl);
      if (base && wsId) {
        candidates.push(`${base}/files?workspace=${encodeURIComponent(wsId)}&file=${encodeURIComponent(fileId)}`);
        candidates.push(`${base}/files/${encodeURIComponent(wsId)}/${encodeURIComponent(fileId)}`);
      }
    } else {
      return null;
    }

    const token = this.#workspaceToken;
    const isUsableImage = (response: Response) => {
      if (!response.ok) return false;
      const ct = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      return ct.startsWith("image/") || ct.startsWith("video/") || ct === "application/octet-stream";
    };

    for (const url of [...new Set(candidates)]) {
      if (token) {
        try {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            redirect: "error",
            credentials: "omit",
          });
          if (isUsableImage(response)) {
            const blob = await response.blob();
            if (blob.size > 0) return URL.createObjectURL(blob);
          }
        } catch {
          /* Some instances also allow reading via their public files endpoint. */
        }
      }
      try {
        const response = await fetch(url, { credentials: "omit" });
        if (isUsableImage(response)) {
          const blob = await response.blob();
          if (blob.size > 0) return URL.createObjectURL(blob);
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  private resolveStorageUrl(kind: "files" | "upload", objectName?: string): string | null {
    const workspaceId = this.#workspaceUuid || this.#workspace?.id || "";
    if (!this.#serverUrl) return null;
    const raw =
      kind === "upload"
        ? this.#endpoints?.uploadUrl || "/files?workspace=:workspace"
        : this.#endpoints?.filesUrl || "/files?workspace=:workspace&file=:blobId";
    const base = raw.startsWith("/") ? `${this.#serverUrl.replace(/\/+$/, "")}${raw}` : raw;
    let url = base.replace(":workspace", encodeURIComponent(workspaceId));
    if (objectName !== undefined) {
      if (url.includes(":filename") || url.includes(":blobId") || url.includes(":file")) {
        url = url
          .replace(":filename", encodeURIComponent(objectName))
          .replace(":blobId", encodeURIComponent(objectName))
          .replace(":file", encodeURIComponent(objectName));
      } else {
        const sep = url.includes("?") ? "&" : "?";
        url = `${url}${sep}file=${encodeURIComponent(objectName)}`;
      }
    }
    return url;
  }

  private async syncLabels(space: string, issueId: string, labelIds: string[]): Promise<void> {
    const plugins = this.plugins();
    const client = this.api();
    const existing = await client.findAll<RawTag>(plugins.tags.class.TagReference, {
      attachedTo: issueId,
      attachedToClass: plugins.tracker.class.Issue,
    });
    const tags = await client.findAll<RawTag>(plugins.tags.class.TagElement, {
      _id: { $in: labelIds.length ? labelIds : ["__none__"] },
    });
    const wanted = new Set(labelIds);
    for (const reference of existing) {
      const tagId = reference.tag || "";
      if (!wanted.has(tagId)) {
        await client.removeCollection(
          plugins.tags.class.TagReference,
          space,
          reference._id,
          issueId,
          plugins.tracker.class.Issue,
          "labels",
        );
      }
    }
    const have = new Set(existing.map((reference) => reference.tag));
    for (const labelId of labelIds) {
      if (have.has(labelId)) continue;
      const tag = tags.find((item) => item._id === labelId);
      await client.addCollection(
        plugins.tags.class.TagReference,
        space,
        issueId,
        plugins.tracker.class.Issue,
        "labels",
        {
          title: tag?.title || "",
          color: tag?.color ?? 0,
          tag: labelId,
        },
      );
    }
  }

  private async safePeople(): Promise<RawPerson[]> {
    try {
      return await this.api().findAll<RawPerson>(this.plugins().contact.class.Person, {}, { limit: 300 });
    } catch {
      return [];
    }
  }

  private async fetchWorkspaces(): Promise<WorkspaceChoice[]> {
    const plugins = this.plugins();
    const raw = await plugins.getAccountClient(this.#accountsUrl, this.#accountToken).getUserWorkspaces();
    return raw.map((workspace) => mapAccountWorkspace(workspace)).filter((workspace): workspace is WorkspaceChoice => workspace !== null);
  }

  private async openPlatform(choice: WorkspaceChoice): Promise<void> {
    const plugins = this.plugins();
    const selected = await plugins.getAccountClient(this.#accountsUrl, this.#accountToken).selectWorkspace(choice.url);
    if (!selected?.endpoint) {
      throw new Error("找不到这个工作区。");
    }
    this.#workspaceToken = selected.token || this.#accountToken;
    this.#workspaceRole = parseWorkspaceRole(selected.role);
    this.#workspaceUuid = selected.workspace || choice.id;
    if (selected.account) this.#accountId = selected.account;

    const observingFactory = (url: string) => {
      const socket = plugins.BrowserWebSocketFactory(url) as WebSocket;
      if (socket && typeof socket.addEventListener === "function") {
        socket.addEventListener("message", (event) => {
          if (event.data !== "ping" && event.data !== "pong!") {
            this.scheduleNotify();
          }
        });
      }
      return socket;
    };

    const client = await plugins.connect(this.#serverUrl, {
      token: this.#accountToken,
      workspace: choice.url,
      socketFactory: observingFactory,
      connectionTimeout: 30000,
    });
    await this.closePlatform();
    this.#client = client;
    this.#workspace = choice;
  }

  private async closePlatform(): Promise<void> {
    for (const pending of this.#imageCache.values()) {
      void pending.then((url) => { if (url) URL.revokeObjectURL(url); });
    }
    this.#imageCache.clear();
    const client = this.#client;
    this.#client = null;
    if (client) await client.close().catch(() => undefined);
  }

  private async currentSession(): Promise<Session> {
    const workspace = this.#workspace;
    if (!workspace) throw new Error("尚未连接。");
    const account = await this.api().getAccount().catch(() => ({ uuid: undefined as string | undefined }));
    const people = await this.safePeople();
    this.#peopleCache = people.map(mapPerson);
    const matched = matchCurrentPerson(people, account.uuid, this.#email);
    this.#userId = matched?._id ?? null;
    const userName = matched ? displayPersonName(matched.name) : this.#userName || this.#email || "已登录";
    if (userName) this.#userName = userName;
    return {
      mode: "huly",
      serverUrl: this.#serverUrl,
      workspace: workspace.url,
      workspaceName: workspace.name,
      workspaces: this.#workspaces.map((item) => ({ ...item })),
      email: this.#email || undefined,
      userId: matched?._id ?? null,
      accountId: this.#accountId ?? account.uuid ?? null,
      userName,
      role: this.#workspaceRole,
    };
  }

  private async updateProjectRecord(projectId: string, operations: Record<string, unknown>): Promise<Project> {
    const plugins = this.plugins();
    const raw = await this.api().findOne<RawProject>(plugins.tracker.class.Project, { _id: projectId });
    if (!raw) throw new Error("找不到这个项目。");
    const space = raw.space || raw._id;
    await this.api().updateDoc(plugins.tracker.class.Project, space, projectId, operations, true);
    const updated = await this.api().findOne<RawProject>(plugins.tracker.class.Project, { _id: projectId });
    return mapProject(updated ?? { ...raw, ...operations });
  }

  private accountApi() {
    this.assertAccount();
    return this.plugins().getAccountClient(this.#accountsUrl, this.#accountToken);
  }

  private workspaceAccountApi() {
    this.assertAccount();
    const token = this.#workspaceToken || this.#accountToken;
    return this.plugins().getAccountClient(this.#accountsUrl, token);
  }

  private async safeEmployees(): Promise<RawPerson[]> {
    const mixin = this.plugins().contact.mixin?.Employee;
    if (!mixin) return [];
    try {
      return await this.api().findAll<RawPerson>(mixin, {}, { limit: 300 });
    } catch {
      return [];
    }
  }

  private async safeSocialEmails(): Promise<SocialEmail[]> {
    const contact = this.plugins().contact;
    const classes = [contact.class.SocialIdentity, contact.class.Channel].filter(
      (value): value is string => Boolean(value),
    );
    const emails: SocialEmail[] = [];
    for (const classRef of classes) {
      try {
        const rows = await this.api().findAll<Record<string, unknown>>(classRef, {}, { limit: 500 });
        for (const row of rows) {
          const email = emailFromSocial(row);
          if (!email) continue;
          const personId = stringRef(row.attachedTo ?? row.person);
          const accountId = stringRef(row.personUuid ?? row.account);
          emails.push({ personId: personId || undefined, accountId: accountId || undefined, email });
        }
      } catch {
        /* optional collections */
      }
    }
    return emails;
  }

  private async ensureAuthorDirectory(): Promise<void> {
    if (this.#peopleCache.length === 0) {
      await this.listPeople();
    }
    for (const person of this.#peopleCache) {
      this.#socialAuthorMap.set(person.id, person.name);
      if (person.accountId) this.#socialAuthorMap.set(person.accountId, person.name);
    }
    if (this.#socialLoaded) return;
    this.#socialLoaded = true;
    const socialClass = this.plugins().contact.class.SocialIdentity;
    if (!socialClass) return;
    try {
      const rows = await this.api().findAll<{
        _id: string;
        attachedTo?: string;
        value?: string;
      }>(socialClass, {}, { limit: 500 });
      for (const row of rows) {
        const matched = row.attachedTo
          ? this.#peopleCache.find((p) => p.id === row.attachedTo || p.accountId === row.attachedTo)
          : undefined;
        const label = matched?.name || row.value?.trim();
        if (label) this.#socialAuthorMap.set(row._id, label);
      }
    } catch {
      /* optional social directory */
    }
  }

  private resolveAuthorName(authorRef?: string): string {
    if (!authorRef) return "成员";
    const mapped = this.#socialAuthorMap.get(authorRef);
    if (mapped) return mapped;
    const person = this.#peopleCache.find(
      (item) => item.id === authorRef || item.accountId === authorRef,
    );
    return person?.name || "成员";
  }

  private assertAccount(): void {
    if (!this.#accountToken || !this.#accountsUrl || !this.#serverUrl) {
      throw new Error("尚未登录。");
    }
  }

  private api(): PlatformClient {
    if (!this.#client) throw new Error("尚未连接。");
    return this.#client;
  }

  private plugins(): Plugins {
    if (!this.#plugins) this.#plugins = loadPlugins();
    return this.#plugins;
  }
}

function plainDescription(value: unknown): string {
  if (isInlineMarkupJson(value)) return decodeMarkupToMarkdown(value);
  if (typeof value === "string" && !descriptionIsRef(value)) return value;
  return "";
}

function readSequence(result: unknown): number | undefined {
  if (!result || typeof result !== "object" || !("object" in result)) return undefined;
  const object = (result as { object?: { sequence?: unknown } }).object;
  return typeof object?.sequence === "number" ? object.sequence : undefined;
}

function readAccountToken(login: LoginInfo): string {
  if (login.tfaRequired && !login.token) {
    throw new Error("该账号需要两步验证，请先在网页端完成后再登录。");
  }
  const token = login.token?.trim() ?? "";
  if (!token) throw new Error("登录没有返回令牌。");
  return token;
}

function usableLoginInfo(info: LoginInfoByToken): LoginInfo | WorkspaceLoginInfo {
  if (!info || typeof info !== "object") {
    throw new Error("令牌无效，请重新登录。");
  }
  if ("request" in info && (info as { request?: unknown }).request === true) {
    throw new Error("令牌无效，请重新登录。");
  }
  const login = info as LoginInfo;
  if (typeof login.account !== "string" || !login.account) {
    throw new Error("令牌无效，请重新登录。");
  }
  return login;
}

function stringRef(value: unknown): string {
  return typeof value === "string" ? value : "";
}
