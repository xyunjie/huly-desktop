import { categoryFromHuly, localizeStatusName, statusColor } from "@/domain/status";
import { isInlineMarkupJson } from "./markup";
import type {
  Attachment,
  Component,
  Issue,
  IssueTemplate,
  Label,
  Milestone,
  MilestoneStatus,
  Person,
  Priority,
  Project,
  Status,
  TimeSpendReport,
} from "@/domain/types";
import { priorityFromHuly } from "@/domain/priority";

export interface RawProject {
  _id: string;
  space?: string;
  identifier?: string;
  name?: string;
  description?: string;
  defaultIssueStatus?: string;
  sequence?: number;
  members?: string[];
  owners?: string[];
  defaultAssignee?: string | null;
  archived?: boolean;
  modifiedOn?: number;
  private?: boolean;
  $lookup?: {
    type?: {
      statuses?: RawProjectStatus[];
    };
  };
}

export interface RawProjectStatus {
  _id: string;
  name?: string;
  title?: string;
  category?: string;
  color?: number | string;
  description?: string;
}

export interface RawStatus extends RawProjectStatus {
  ofAttribute?: string;
}

export interface RawPerson {
  _id: string;
  name?: string;
  personUuid?: string;
  email?: string;
  active?: boolean;
  roles?: string;
}

export interface RawIssueParent {
  parentId: string;
  identifier?: string;
  parentTitle?: string;
}

export interface RawIssue {
  _id: string;
  space: string;
  identifier?: string;
  title?: string;
  description?: unknown;
  status?: string;
  priority?: number;
  assignee?: string | null;
  component?: string | null;
  milestone?: string | null;
  dueDate?: number | null;
  number?: number;
  rank?: string;
  estimation?: number;
  reportedTime?: number;
  remainingTime?: number;
  references?: number;
  attachedTo?: string;
  parents?: RawIssueParent[];
  blockedBy?: { _id?: string; _class?: string }[];
  relations?: { _id?: string; _class?: string }[];
  modifiedOn?: number;
  createdBy?: string;
}

export interface RawTag {
  _id: string;
  title?: string;
  color?: number;
  tag?: string;
  attachedTo?: string;
}

export interface RawNamed {
  _id: string;
  space?: string;
  label?: string;
  name?: string;
  title?: string;
  description?: string;
  status?: number;
  targetDate?: number | null;
  lead?: string | null;
}

export interface RawAttachment {
  _id: string;
  attachedTo?: string;
  file?: string;
  name?: string;
  size?: number;
  type?: string;
  lastModified?: number;
}

export interface RawTimeReport {
  _id: string;
  attachedTo?: string;
  employee?: string | null;
  date?: number | null;
  value?: number;
  description?: string;
  createdOn?: number;
}

export interface RawIssueTemplate {
  _id: string;
  space?: string;
  title?: string;
  description?: unknown;
  priority?: number;
  assignee?: string | null;
  component?: string | null;
  milestone?: string | null;
  labels?: string[];
  estimation?: number;
}

export interface RawInboxNotification {
  _id: string;
  _class?: string;
  space?: string;
  title?: string;
  body?: string;
  objectId?: string;
  objectClass?: string;
  attachedTo?: string;
  user?: string;
  docNotifyContext?: string;
  headerObjectId?: string;
  mentionedIn?: string;
  message?: string;
  messageHtml?: string;
  data?: string;
  intlParams?: Record<string, unknown>;
  intlParamsNotLocalized?: Record<string, unknown>;
  props?: Record<string, unknown>;
  isViewed?: boolean;
  archived?: boolean;
  createdOn?: number;
  modifiedOn?: number;
  createdBy?: string;
  modifiedBy?: string;
}

export function mapProject(raw: RawProject): Project {
  return {
    id: raw._id,
    space: raw.space,
    identifier: raw.identifier?.trim() || "PROJ",
    name: raw.name?.trim() || raw.identifier?.trim() || "未命名项目",
    description: typeof raw.description === "string" ? raw.description : undefined,
    defaultStatusId: raw.defaultIssueStatus,
    memberIds: raw.members ?? [],
    ownerIds: raw.owners ?? [],
    defaultAssigneeId: raw.defaultAssignee ?? null,
    archived: Boolean(raw.archived),
    modifiedOn: raw.modifiedOn,
    private: raw.private,
  };
}

export function mapPerson(raw: RawPerson): Person {
  return {
    id: raw._id,
    name: displayPersonName(raw.name) || "未命名",
    email: raw.email,
    accountId: raw.personUuid,
    active: raw.active,
  };
}

export function findPersonByRef(people: Person[], ref: string | null | undefined): Person | undefined {
  if (!ref) return undefined;
  return people.find((person) => person.id === ref || person.accountId === ref);
}

/** Huly stores person names as "Last,First". CJK is Last+First with no space; Latin is "First Last". */
export function displayPersonName(name: string | undefined): string {
  if (!name) return "";
  const separator = name.indexOf(",");
  if (separator < 0) return name.trim();
  const last = name.slice(0, separator).trim();
  const first = name.slice(separator + 1).trim();
  const parts = [last, first].filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  const cjk = /[\u3400-\u9fff]/.test(last) || /[\u3400-\u9fff]/.test(first);
  if (cjk) return `${last}${first}`;
  return [first, last].filter((part) => part.length > 0).join(" ");
}

export function nameInitial(displayName: string): string {
  const trimmed = displayName.trim();
  return Array.from(trimmed)[0] ?? "?";
}

/** Split a display or stored name into Huly changeUsername(first, last) parts. */
export function namePartsFromDisplay(name: string | undefined): { first: string; last: string } {
  if (!name) return { first: "", last: "" };
  const trimmed = name.trim();
  if (!trimmed) return { first: "", last: "" };
  const separator = trimmed.indexOf(",");
  if (separator >= 0) {
    return { last: trimmed.slice(0, separator).trim(), first: trimmed.slice(separator + 1).trim() };
  }
  const cjk = /[\u3400-\u9fff]/.test(trimmed);
  if (cjk) {
    const chars = Array.from(trimmed);
    if (chars.length <= 1) return { first: "", last: chars[0] ?? "" };
    return { last: chars[0] ?? "", first: chars.slice(1).join("") };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1) ?? "" };
}

export function storedPersonName(first: string, last: string): string {
  return `${last.trim()},${first.trim()}`;
}

const NO_PARENT = "tracker:ids:NoParent";

export function isParentReference(id: string | undefined, selfId: string): boolean {
  if (!id) return false;
  if (id === NO_PARENT) return false;
  if (id === selfId) return false;
  return true;
}

export function mapStatuses(project: RawProject, documents: RawStatus[]): Status[] {
  const byId = new Map(documents.map((status) => [status._id, status]));
  const embedded = new Map((project.$lookup?.type?.statuses ?? []).map((status) => [status._id, status]));
  return [...new Set([...embedded.keys(), ...byId.keys()])].map((id) => mapStatus(id, byId.get(id), embedded.get(id)));
}

export function mapStatus(id: string, doc?: RawStatus, slot?: RawProjectStatus): Status {
  const rawName = doc?.name || slot?.name || slot?.title || fallbackStatusName(id);
  const category = categoryFromHuly({ id, categoryId: doc?.category || slot?.category, name: rawName });
  return { id, name: localizeStatusName(rawName), category, color: statusColor(category, doc?.color) };
}

function fallbackStatusName(id: string): string {
  if (id.endsWith("Backlog")) return "待办池";
  if (id.endsWith("Todo")) return "待办";
  if (id.endsWith("InProgress") || id.endsWith("Coding") || id.endsWith("UnderReview")) return "进行中";
  if (id.endsWith("Done")) return "完成";
  if (id.endsWith("Canceled") || id.endsWith("Cancelled")) return "取消";
  return "未知状态";
}

export function mapIssue(raw: RawIssue, description = ""): Issue {
  const parentIds = new Set<string>();
  for (const parent of raw.parents ?? []) {
    if (isParentReference(parent.parentId, raw._id)) parentIds.add(parent.parentId);
  }
  if (raw.attachedTo && isParentReference(raw.attachedTo, raw._id)) parentIds.add(raw.attachedTo);
  return {
    id: raw._id,
    projectId: raw.space,
    identifier: raw.identifier?.trim() || raw._id,
    number: raw.number ?? 0,
    title: raw.title?.trim() || "未命名任务",
    description,
    statusId: raw.status || "",
    priority: priorityFromHuly(raw.priority),
    assigneeId: raw.assignee ?? null,
    labelIds: [],
    milestoneId: raw.milestone ?? null,
    componentId: raw.component ?? null,
    dueDate: typeof raw.dueDate === "number" ? raw.dueDate : null,
    parentIds: [...parentIds],
    rank: raw.rank || "",
    descriptionRef: descriptionIsRef(raw.description) ? raw.description : undefined,
    descriptionMarkup: typeof raw.description === "string" && isInlineMarkupJson(raw.description) ? raw.description : undefined,
    referenceCount: typeof raw.references === "number" ? raw.references : undefined,
    estimationHours: typeof raw.estimation === "number" ? raw.estimation : undefined,
    reportedTime: typeof raw.reportedTime === "number" ? raw.reportedTime : undefined,
    remainingTime: typeof raw.remainingTime === "number" ? raw.remainingTime : undefined,
    blockedBy: (raw.blockedBy ?? []).map((item) => item._id).filter((id): id is string => Boolean(id)),
    relations: (raw.relations ?? []).map((item) => item._id).filter((id): id is string => Boolean(id)),
    modifiedOn: raw.modifiedOn ?? 0,
  };
}

export function attachLabels(issues: Issue[], references: RawTag[]): Issue[] {
  return issues.map((issue) => {
    const own = references.filter((reference) => reference.attachedTo === issue.id);
    const labelIds: string[] = [];
    const labelRefs: NonNullable<Issue["labelRefs"]> = [];
    for (const reference of own) {
      const labelId = reference.tag || reference._id;
      if (!labelId) continue;
      labelIds.push(labelId);
      labelRefs.push({ labelId, referenceId: reference._id });
    }
    return { ...issue, labelIds, labelRefs };
  });
}

export function mapLabels(tags: RawTag[]): Label[] {
  return tags.map((tag) => ({
    id: tag._id,
    name: tag.title?.trim() || "标签",
    color: labelColor(tag.color ?? 0),
  }));
}

export function labelColor(index: number): string {
  const palette = ["#0f766e", "#1868db", "#c2410c", "#7c3aed", "#be123c", "#3f6212", "#0c8599"];
  return palette[Math.abs(index) % palette.length] ?? palette[0];
}

export function milestoneStatusFromHuly(value: unknown): MilestoneStatus {
  switch (value) {
    case 1:
      return "in-progress";
    case 2:
      return "completed";
    case 3:
      return "canceled";
    default:
      return "planned";
  }
}

export function hulyMilestoneStatus(status?: MilestoneStatus): number {
  switch (status) {
    case "in-progress":
      return 1;
    case "completed":
      return 2;
    case "canceled":
      return 3;
    default:
      return 0;
  }
}

export function mapMilestone(raw: RawNamed): Milestone {
  return {
    id: raw._id,
    projectId: raw.space || "",
    name: raw.label || raw.name || raw.title || "里程碑",
    description: typeof raw.description === "string" ? raw.description : undefined,
    status: milestoneStatusFromHuly(raw.status),
    targetDate: typeof raw.targetDate === "number" ? raw.targetDate : null,
  };
}

export function mapComponent(raw: RawNamed): Component {
  return {
    id: raw._id,
    projectId: raw.space || "",
    name: raw.label || raw.name || raw.title || "组件",
    description: typeof raw.description === "string" ? raw.description : undefined,
    leadId: raw.lead ?? null,
  };
}

export function mapAttachment(raw: RawAttachment, issueId: string): Attachment {
  return {
    id: raw._id,
    issueId: raw.attachedTo || issueId,
    fileId: raw.file || raw._id,
    name: raw.name?.trim() || "未命名文件",
    size: typeof raw.size === "number" ? raw.size : 0,
    type: raw.type?.trim() || "application/octet-stream",
    lastModified: typeof raw.lastModified === "number" ? raw.lastModified : 0,
  };
}

export function mapTimeReport(raw: RawTimeReport, issueId: string, people: Person[]): TimeSpendReport {
  const person = raw.employee ? people.find((item) => item.id === raw.employee || item.accountId === raw.employee) : undefined;
  return {
    id: raw._id,
    issueId: raw.attachedTo || issueId,
    employeeId: raw.employee ?? null,
    employeeName: person?.name || "成员",
    date: typeof raw.date === "number" ? raw.date : raw.createdOn ?? Date.now(),
    value: typeof raw.value === "number" ? raw.value : 0,
    description: typeof raw.description === "string" ? raw.description : "",
  };
}

export function mapIssueTemplate(raw: RawIssueTemplate): IssueTemplate {
  return {
    id: raw._id,
    projectId: raw.space || "",
    title: raw.title?.trim() || "未命名模板",
    description: typeof raw.description === "string" && !descriptionIsRef(raw.description) ? raw.description : "",
    priority: priorityFromHuly(raw.priority),
    assigneeId: raw.assignee ?? null,
    milestoneId: raw.milestone ?? null,
    componentId: raw.component ?? null,
    labelIds: Array.isArray(raw.labels) ? raw.labels : [],
    estimationHours: typeof raw.estimation === "number" && raw.estimation > 0 ? raw.estimation : undefined,
  };
}

export function hulyPriority(priority: Priority): number {
  switch (priority) {
    case "urgent":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 3;
    case "low":
      return 4;
    default:
      return 0;
  }
}

export function matchCurrentPerson(people: RawPerson[], accountUuid: string | undefined, email: string | undefined): RawPerson | undefined {
  if (accountUuid) {
    const byUuid = people.find((person) => person.personUuid === accountUuid || person._id === accountUuid);
    if (byUuid) return byUuid;
  }
  if (email) {
    const lowered = email.toLowerCase();
    const byEmail = people.find((person) => person.email?.toLowerCase() === lowered);
    if (byEmail) return byEmail;
  }
  return undefined;
}

/** Opaque collaborator / markup-blob ids, including values like `…-description-…`. */
export function descriptionIsRef(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || isInlineMarkupJson(text)) return false;
    if (/\s/.test(text) || /[\u3400-\u9fff]/.test(text)) return false;
    return text.includes(":") || text.includes("-description-") || /^[0-9a-f-]{16,}$/i.test(text);
  }
  return typeof value === "object";
}
