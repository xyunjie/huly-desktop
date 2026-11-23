import type {
  AccountAuthInput,
  AccountSession,
  Attachment,
  Comment,
  CommentFormat,
  Component,
  ComponentInput,
  CreateIssueInput,
  DataMode,
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
  TimeSpendReport,
  WorkspaceChoice,
  WorkspaceMember,
} from "@/domain/types";
import type { WorkspaceRole } from "@/domain/roles";

export const PROJECT_ISSUE_LIMIT = 500;
export const ISSUE_ATTACHMENT_LIMIT = 100;

export interface DeskClient {
  readonly mode: DataMode;
  readonly commentWrite: boolean;
  probe(serverUrl: string): Promise<ServerEndpoints>;
  authenticate(input: AccountAuthInput): Promise<AccountSession>;
  listWorkspaces(): Promise<WorkspaceChoice[]>;
  enterWorkspace(workspaceUrl: string): Promise<Session>;
  switchWorkspace(workspaceUrl: string): Promise<Session>;
  disconnect(): Promise<void>;
  listProjects(): Promise<Project[]>;
  countIssuesByProject(): Promise<Record<string, { open: number; total: number }>>;
  listPeople(): Promise<Person[]>;
  listWorkspaceMembers(): Promise<WorkspaceMember[]>;
  updateWorkspaceRole(accountId: string, role: WorkspaceRole): Promise<void>;
  sendInvite(email: string, role: WorkspaceRole): Promise<void>;
  resendInvite(email: string, role: WorkspaceRole): Promise<void>;
  createInviteLink(email: string, role: WorkspaceRole, firstName?: string, lastName?: string): Promise<string>;
  removeWorkspaceMember(accountId: string): Promise<void>;
  updateProjectMembers(projectId: string, memberIds: string[]): Promise<Project>;
  updateProject(projectId: string, patch: ProjectPatch): Promise<Project>;
  changeDisplayName(firstName: string, lastName: string): Promise<string>;
  loadProject(projectId: string, options?: { targetIssueId?: string; limit?: number }): Promise<ProjectBundle>;
  findIssueByIdentifier(identifier: string): Promise<Issue | null>;
  listAssigned(personId: string): Promise<Pick<ProjectBundle, "issues" | "statuses">>;
  updateIssue(id: string, patch: IssuePatch): Promise<Issue>;
  createIssue(input: CreateIssueInput): Promise<Issue>;
  loadIssueTimeline(issue: Issue, options?: { commentsOnly?: boolean }): Promise<IssueTimeline>;
  listEditorTemplates(): Promise<EditorTemplate[]>;
  readDescriptionSnapshot?(ref: string): Promise<string>;
  addComment(issueId: string, body: string, format?: CommentFormat, files?: File[]): Promise<Comment>;
  hydrateIssue(issue: Issue): Promise<Issue>;
  listAttachments(issueId: string, options?: { commentIds?: string[]; fileId?: string }): Promise<Attachment[]>;
  workspaceFileId(src: string): string | null;
  fetchWorkspaceFile(fileId: string, signal: AbortSignal): Promise<Response>;
  uploadInlineFile(issueId: string, file: File): Promise<Attachment>;
  uploadAttachment(issueId: string, file: File): Promise<Attachment>;
  downloadAttachment(attachment: Attachment): Promise<void>;
  deleteAttachment(issueId: string, attachmentId: string): Promise<void>;
  createMilestone(projectId: string, input: MilestoneInput): Promise<Milestone>;
  updateMilestone(id: string, patch: Partial<MilestoneInput>): Promise<Milestone>;
  deleteMilestone(id: string): Promise<void>;
  createComponent(projectId: string, input: ComponentInput): Promise<Component>;
  updateComponent(id: string, patch: Partial<ComponentInput>): Promise<Component>;
  deleteComponent(id: string): Promise<void>;
  listTemplates(projectId: string): Promise<IssueTemplate[]>;
  createTemplate(projectId: string, input: IssueTemplateInput): Promise<IssueTemplate>;
  updateTemplate(id: string, patch: Partial<IssueTemplateInput>): Promise<IssueTemplate>;
  deleteTemplate(id: string): Promise<void>;
  listTimeReports(issueId: string): Promise<TimeSpendReport[]>;
  reportTime(
    issueId: string,
    input: { hours: number; date: number; description: string; employeeId?: string | null },
  ): Promise<TimeSpendReport>;
  deleteTimeReport(issueId: string, reportId: string): Promise<void>;
  listNotifications(): Promise<InboxNotification[]>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  resolveImageSrc?(src: string): Promise<string | null>;
  subscribe?(listener: () => void): () => void;
  /** Account token for the keychain. Empty in mock mode. Never a password. */
  tokenForKeychain(): string;
}
