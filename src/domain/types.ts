import type { WorkspaceRole } from "./roles";

export const DEFAULT_SERVER_URL = "https://lm.all666.cn:666";
export const DEFAULT_WORKSPACE_SLUG = "ws-6aa0e320-776b6c69e0-2f809f";
export const DEFAULT_WORKSPACE_NAME = "公司";

export type DataMode = "mock" | "huly";

export type Priority = "none" | "urgent" | "high" | "medium" | "low";

export type StatusCategory = "backlog" | "todo" | "in-progress" | "done" | "canceled";

export interface Person {
  id: string;
  name: string;
  email?: string;
  /** Account uuid when it differs from the Person document id. */
  accountId?: string;
  active?: boolean;
}

export interface Status {
  id: string;
  name: string;
  category: StatusCategory;
  color: string;
}

export interface Project {
  id: string;
  workspaceId?: string;
  identifier: string;
  name: string;
  description?: string;
  defaultStatusId?: string;
  issueCount?: number;
  openCount?: number;
  memberIds?: string[];
  ownerIds?: string[];
  defaultAssigneeId?: string | null;
  archived?: boolean;
  modifiedOn?: number;
  private?: boolean;
  /** Space document space, used for updateDoc. */
  space?: string;
}

export type MilestoneStatus = "planned" | "in-progress" | "completed" | "canceled";

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status?: MilestoneStatus;
  targetDate?: number | null;
}

export interface MilestoneInput {
  name: string;
  description?: string;
  status?: MilestoneStatus;
  targetDate?: number | null;
}

export interface Component {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  leadId?: string | null;
}

export interface ComponentInput {
  name: string;
  description?: string;
  leadId?: string | null;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  /** Tag reference id when this label is already attached to an issue. */
  referenceId?: string;
}

export interface Issue {
  id: string;
  projectId: string;
  identifier: string;
  number: number;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeId: string | null;
  labelIds: string[];
  /** Present when the label is already attached on the server. */
  labelRefs?: { labelId: string; referenceId: string }[];
  milestoneId: string | null;
  componentId: string | null;
  dueDate: number | null;
  parentIds: string[];
  rank: string;
  estimationHours?: number;
  reportedTime?: number;
  remainingTime?: number;
  blockedBy?: string[];
  relations?: string[];
  modifiedOn: number;
  /** Opaque collaborator reference. Not rendered. */
  descriptionRef?: unknown;
  /** Native Huly rich text, kept alongside the Markdown fallback. */
  descriptionMarkup?: string;
  descriptionUnavailable?: boolean;
  referenceCount?: number;
}

export interface Attachment {
  id: string;
  issueId: string;
  fileId: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  blobUrl?: string;
}

export interface TimeSpendReport {
  id: string;
  issueId: string;
  employeeId: string | null;
  employeeName: string;
  date: number;
  value: number;
  description: string;
}

export interface IssueTemplate {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: Priority;
  assigneeId: string | null;
  milestoneId: string | null;
  componentId: string | null;
  labelIds: string[];
  estimationHours?: number;
}

export interface IssueTemplateInput {
  title: string;
  description: string;
  priority: Priority;
  assigneeId: string | null;
  milestoneId: string | null;
  componentId: string | null;
  labelIds: string[];
  estimationHours?: number;
}

export interface InboxNotification {
  id: string;
  title: string;
  body: string;
  objectId: string;
  objectClass: string;
  projectId?: string;
  issueIdentifier?: string;
  projectName?: string;
  isViewed: boolean;
  createdOn: number;
  senderName?: string;
}

export interface Comment {
  id: string;
  issueId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdOn: number;
  providerLabel?: string;
  nativeMarkup?: string;
}

export type CommentFormat = "markdown" | "markup";

export interface ActivityItem {
  id: string;
  issueId: string;
  kind: "comment" | "update";
  authorId: string | null;
  authorName: string;
  body: string;
  createdOn: number;
  providerLabel?: string;
  nativeMarkup?: string;
  change?:
    | { type: "status"; statusId: string }
    | { type: "assignee" }
    | { type: "created" }
    | { type: "description"; before?: string; after?: string; text?: { before?: string; after?: string } };
}

export interface EditorTemplate {
  id: string;
  title: string;
  body: string;
}

export interface IssueTimeline {
  comments: Comment[];
  activity: ActivityItem[];
  warning?: string;
}

export type { WorkspaceRole } from "./roles";

export interface WorkspaceMember {
  accountId: string;
  personId?: string;
  name: string;
  email?: string;
  role: WorkspaceRole;
  active: boolean;
}

export interface ProjectPatch {
  name?: string;
  description?: string;
  defaultAssigneeId?: string | null;
  archived?: boolean;
}

export interface WorkspaceChoice {
  id: string;
  url: string;
  name: string;
}

export interface AccountSession {
  serverUrl: string;
  email: string;
  userName: string;
  workspaces: WorkspaceChoice[];
}

export interface Session {
  mode: DataMode;
  serverUrl: string;
  workspace: string;
  workspaceName: string;
  workspaces: WorkspaceChoice[];
  email?: string;
  userId: string | null;
  /** Account uuid used by getWorkspaceMembers / leaveWorkspace. */
  accountId?: string | null;
  userName: string;
  role: WorkspaceRole;
}

export interface IssuePatch {
  title?: string;
  description?: string;
  descriptionMarkup?: string;
  previousDescriptionMarkup?: string;
  statusId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  milestoneId?: string | null;
  componentId?: string | null;
  dueDate?: number | null;
  labelIds?: string[];
  parentId?: string | null;
  estimationHours?: number;
  blockedBy?: string[];
  relations?: string[];
}

export interface CreateIssueInput {
  projectId: string;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeId: string | null;
  milestoneId: string | null;
  componentId: string | null;
  labelIds: string[];
  parentId?: string | null;
  dueDate?: number | null;
  estimationHours?: number;
}

export interface ServerEndpoints {
  accountsUrl: string;
  collaboratorUrl: string;
  filesUrl?: string;
  uploadUrl?: string;
}

export interface ProjectBundle {
  statuses: Status[];
  milestones: Milestone[];
  components: Component[];
  labels: Label[];
  issues: Issue[];
}

export type AccountAuthInput =
  | { kind: "mock"; serverUrl: string }
  | { kind: "password"; serverUrl: string; email: string; password: string }
  | { kind: "token"; serverUrl: string; token: string };

export type GroupBy = "status" | "assignee" | "priority" | "none";

export type DueFilter = "all" | "overdue" | "today" | "week" | "no-due";

export interface IssueFilters {
  search: string;
  statusId: string;
  assigneeId: string;
  priority: Priority | "all";
  labelId: string;
  milestoneId?: string;
  dueFilter?: DueFilter;
  groupBy: GroupBy;
}

export const EMPTY_FILTERS: IssueFilters = {
  search: "",
  statusId: "all",
  assigneeId: "all",
  priority: "all",
  labelId: "all",
  milestoneId: "all",
  dueFilter: "all",
  groupBy: "status",
};
