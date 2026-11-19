import { Alert, Button, Input, Layout, Segmented, Select, Skeleton, Space, Typography } from "antd";
import { useRef, type RefObject } from "react";
import { RenderBoundary } from "@/components/RenderBoundary";
import { filterIssues, hasActiveFilters, isTopLevelIssue } from "@/domain/filters";
import { formatCommentTime } from "@/domain/format";
import { PRIORITY_LABEL, PRIORITY_ORDER } from "@/domain/priority";
import {
  EMPTY_FILTERS,
  type ActivityItem,
  type Attachment,
  type Comment,
  type CommentFormat,
  type Component,
  type ComponentInput,
  type CreateIssueInput,
  type EditorTemplate,
  type InboxNotification,
  type Issue,
  type IssueFilters,
  type IssuePatch,
  type IssueTemplate,
  type IssueTemplateInput,
  type Label,
  type Milestone,
  type MilestoneInput,
  type Person,
  type Project,
  type ProjectPatch,
  type Session,
  type Status,
  type WorkspaceMember,
} from "@/domain/types";
import type { WorkspaceRole } from "@/domain/roles";
import { CommandPalette } from "./CommandPalette";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { IssueBoard } from "./IssueBoard";
import { IssueDetail } from "./IssueDetail";
import { IssueList } from "./IssueList";
import { NotificationDrawer } from "./NotificationDrawer";
import { ProjectMetaModal } from "./ProjectMetaModal";
import { StatusIcon } from "./StatusBadge";
import { Sidebar, type DeskNav } from "./Sidebar";
import { ProjectList } from "./ProjectList";
import { AddProjectMemberModal } from "./AddProjectMemberModal";
import { EditProjectModal } from "./EditProjectModal";
import { MemberAdmin } from "./MemberAdmin";
import { InviteMemberModal } from "./InviteMemberModal";
import { McpPage } from "./McpSettings";
import { ProfilePage } from "./ProfilePage";
import { PageTitle } from "./PageTitle";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { TemplateModal } from "./TemplateModal";

const { Content, Sider } = Layout;

export function DeskScreen(props: {
  session: Session;
  projects: Project[];
  people: Person[];
  members: WorkspaceMember[];
  statuses: Status[];
  milestones: Milestone[];
  components: Component[];
  labels: Label[];
  issues: Issue[];
  comments: Comment[];
  activity: ActivityItem[];
  activityLoading?: boolean;
  activityError?: string | null;
  onRefreshActivity: () => void;
  attachments: Attachment[];
  templates: IssueTemplate[];
  notifications: InboxNotification[];
  notificationsOpen: boolean;
  notificationsLoading: boolean;
  notificationsError?: string | null;
  metaModalOpen: boolean;
  templateModalOpen: boolean;
  offlineReadOnly: boolean;
  offlineSavedAt: number | null;
  commentWrite: boolean;
  loading: boolean;
  refreshing: boolean;
  descriptionLoading: boolean;
  projectId: string | null;
  nav: DeskNav;
  view: "list" | "board";
  filters: IssueFilters;
  selectedId: string | null;
  detail: "side" | "wide" | "closed";
  error: string | null;
  paletteOpen: boolean;
  createOpen: boolean;
  createParentId: string | null;
  addMemberProject: Project | null;
  editProject: Project | null;
  inviteOpen: boolean;
  profileSaving?: boolean;
  onNav: (nav: Exclude<DeskNav, "project">) => void;
  onProject: (id: string) => void;
  onView: (view: "list" | "board") => void;
  onFilters: (filters: IssueFilters) => void;
  onSelect: (id: string) => void;
  onDetail: (detail: "side" | "wide" | "closed") => void;
  onUpdate: (id: string, patch: IssuePatch) => Promise<void>;
  onCreate: (input: CreateIssueInput) => Promise<void>;
  onOpenCreateSubIssue: (parentId: string) => void;
  onComment: (body: string, format?: CommentFormat) => Promise<void>;
  onUploadAttachment: (file: File) => Promise<Attachment | void>;
  onDownloadAttachment: (attachment: Attachment) => Promise<void>;
  onDeleteAttachment: (attachmentId: string) => Promise<void>;
  onCreateMilestone: (input: MilestoneInput) => Promise<void>;
  onUpdateMilestone: (id: string, patch: Partial<MilestoneInput>) => Promise<void>;
  onDeleteMilestone: (id: string) => Promise<void>;
  onCreateComponent: (input: ComponentInput) => Promise<void>;
  onUpdateComponent: (id: string, patch: Partial<ComponentInput>) => Promise<void>;
  onDeleteComponent: (id: string) => Promise<void>;
  onCreateTemplate: (input: IssueTemplateInput) => Promise<void>;
  onUpdateTemplate: (id: string, patch: Partial<IssueTemplateInput>) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onNotificationsOpen: (open: boolean) => void;
  onRefreshNotifications: () => void;
  onMarkNotificationRead: (id: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
  onOpenNotificationTarget: (notification: InboxNotification) => void;
  onMetaModalOpen: (open: boolean) => void;
  onTemplateModalOpen: (open: boolean) => void;
  onMove: (issueId: string, statusId: string) => void;
  onLogout: () => void;
  onPalette: (open: boolean) => void;
  onCreateOpen: (open: boolean) => void;
  onCommand: (id: string) => void;
  onRefresh: () => void;
  onSwitchWorkspace: (workspaceUrl: string) => void;
  onAddMemberOpen: (project: Project | null) => void;
  onEditProjectOpen: (project: Project | null) => void;
  onSaveMembers: (projectId: string, memberIds: string[]) => Promise<void>;
  onSaveProject: (projectId: string, patch: ProjectPatch) => Promise<void>;
  onInviteOpen: (open: boolean) => void;
  onSendInvite: (email: string, role: WorkspaceRole) => Promise<void>;
  onCopyInviteLink: (email: string, role: WorkspaceRole) => Promise<string>;
  onChangeRole: (accountId: string, role: WorkspaceRole) => Promise<void>;
  onRemoveMember: (accountId: string) => Promise<void>;
  onSaveProfileName: (firstName: string, lastName: string) => Promise<void>;
  onResolveImage?: (src: string) => Promise<string | null>;
  onLoadEditorTemplates?: () => Promise<EditorTemplate[]>;
  onReadDescriptionSnapshot?: (ref: string) => Promise<string>;
  searchRef?: RefObject<{ focus: () => void } | null>;
}) {
  const localSearch = useRef<{ focus: () => void } | null>(null);
  const searchRef = props.searchRef ?? localSearch;
  const immersive = props.nav === "project";
  const selected = props.issues.find((issue) => issue.id === props.selectedId) ?? null;
  const showWork = props.nav === "project" || props.nav === "mine";
  const includeSubIssues = props.nav === "mine";
  const pool = includeSubIssues ? props.issues : props.issues.filter(isTopLevelIssue);
  const visibleCount = filterIssues(props.issues, props.filters, { includeSubIssues }).length;
  const showDetail = showWork && selected && props.detail !== "closed";
  const currentProject = props.projects.find((item) => item.id === props.projectId) ?? null;
  const filteredActive = hasActiveFilters(props.filters);
  const backLabel = props.nav === "mine" ? "返回我的任务" : props.view === "board" ? "返回看板" : "返回任务列表";

  const workBody = showDetail ? (
    <RenderBoundary key={selected.id} fallback={
      <div className="hd-page-body">
        <Alert type="error" showIcon message={`任务 ${selected.identifier} 未能显示`}
          action={<Button onClick={() => props.onDetail("closed")}>{backLabel}</Button>} />
      </div>
    }>
      <IssueDetail
        issue={selected}
        project={currentProject}
        backLabel={backLabel}
        issues={props.issues}
        statuses={props.statuses}
        people={props.people}
        labels={props.labels}
        milestones={props.milestones}
        components={props.components}
        comments={props.comments}
        activity={props.activity}
        activityLoading={props.activityLoading}
        activityError={props.activityError}
        onRefreshActivity={props.onRefreshActivity}
        attachments={props.attachments}
        commentWrite={props.commentWrite}
        mock={props.session.mode === "mock"}
        readOnly={props.offlineReadOnly}
        descriptionLoading={props.descriptionLoading}
        onClose={() => props.onDetail("closed")}
        onSelect={props.onSelect}
        onUpdate={(patch) => props.onUpdate(selected.id, patch)}
        onComment={props.onComment}
        onOpenCreateSubIssue={props.onOpenCreateSubIssue}
        onUploadAttachment={props.onUploadAttachment}
        onDownloadAttachment={props.onDownloadAttachment}
        onDeleteAttachment={props.onDeleteAttachment}
        onResolveImage={props.onResolveImage}
        onLoadEditorTemplates={props.onLoadEditorTemplates}
        onReadDescriptionSnapshot={props.onReadDescriptionSnapshot}
      />
    </RenderBoundary>
  ) : (
    <>
      {props.nav === "project" ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            padding: "8px 20px",
            alignItems: "center",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Button data-testid="back-to-projects" onClick={() => props.onNav("projects")}>
            ← 返回项目列表
          </Button>
          <ProjectSwitcher projects={props.projects} projectId={props.projectId} onSelect={props.onProject} />
          <Segmented
            value={props.view}
            onChange={(value) => props.onView(value as "list" | "board")}
            options={[
              { label: "列表", value: "list" },
              { label: "看板", value: "board" },
            ]}
          />
          <Input
            ref={(node) => {
              searchRef.current = node;
            }}
            value={props.filters.search}
            placeholder="搜索任务标题或编号"
            style={{ width: 180 }}
            onChange={(event) => props.onFilters({ ...props.filters, search: event.target.value })}
          />
          {props.view === "list" ? (
            <Select
              value={props.filters.statusId}
              style={{ width: 126 }}
              options={[
                { value: "all", label: "全部状态" },
                ...props.statuses.map((status) => ({
                  value: status.id,
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <StatusIcon status={status} size={13} />
                      <span>{status.name}</span>
                    </span>
                  ),
                })),
              ]}
              onChange={(statusId) => props.onFilters({ ...props.filters, statusId })}
            />
          ) : null}
          <Select
            value={props.filters.assigneeId}
            style={{ width: 114 }}
            options={[
              { value: "all", label: "全部指派" },
              { value: "unassigned", label: "未指派" },
              ...props.people.map((person) => ({ value: person.id, label: person.name })),
            ]}
            onChange={(assigneeId) => props.onFilters({ ...props.filters, assigneeId })}
          />
          <Select
            value={props.filters.priority}
            style={{ width: 114 }}
            options={[
              { value: "all", label: "全部优先级" },
              ...PRIORITY_ORDER.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] })),
            ]}
            onChange={(priority) => props.onFilters({ ...props.filters, priority: priority as IssueFilters["priority"] })}
          />
          <Select
            value={props.filters.labelId}
            style={{ width: 110 }}
            options={[{ value: "all", label: "全部标签" }, ...props.labels.map((label) => ({ value: label.id, label: label.name }))]}
            onChange={(labelId) => props.onFilters({ ...props.filters, labelId })}
          />
          <Select
            value={props.filters.milestoneId ?? "all"}
            style={{ width: 120 }}
            options={[
              { value: "all", label: "全部里程碑" },
              { value: "none", label: "无里程碑" },
              ...props.milestones.map((item) => ({ value: item.id, label: item.name })),
            ]}
            onChange={(milestoneId) => props.onFilters({ ...props.filters, milestoneId })}
          />
          <Select
            value={props.filters.dueFilter ?? "all"}
            style={{ width: 112 }}
            options={[
              { value: "all", label: "全部截止" },
              { value: "overdue", label: "已逾期" },
              { value: "today", label: "今日到期" },
              { value: "week", label: "未来 7 天" },
              { value: "no-due", label: "未设截止" },
            ]}
            onChange={(dueFilter) =>
              props.onFilters({ ...props.filters, dueFilter: dueFilter as IssueFilters["dueFilter"] })
            }
          />
          {props.view === "list" ? (
            <Select
              value={props.filters.groupBy}
              style={{ width: 108 }}
              options={[
                { value: "status", label: "按状态分组" },
                { value: "assignee", label: "按指派人" },
                { value: "priority", label: "按优先级" },
                { value: "none", label: "不分组" },
              ]}
              onChange={(groupBy) => props.onFilters({ ...props.filters, groupBy: groupBy as IssueFilters["groupBy"] })}
            />
          ) : null}
          {filteredActive ? (
            <Button
              size="small"
              onClick={() => props.onFilters({ ...EMPTY_FILTERS, groupBy: props.filters.groupBy })}
            >
              重置筛选
            </Button>
          ) : null}
          <Space size={4} style={{ marginLeft: "auto" }}>
            <Button onClick={() => props.onMetaModalOpen(true)}>里程碑 · 组件</Button>
            <Button onClick={() => props.onTemplateModalOpen(true)}>模板</Button>
            <Button type="link" onClick={props.onRefresh}>
              刷新
            </Button>
            {props.refreshing ? <Typography.Text type="secondary">正在更新…</Typography.Text> : null}
            <Button type="primary" disabled={props.offlineReadOnly} onClick={() => props.onCreateOpen(true)}>
              创建任务
            </Button>
          </Space>
        </div>
      ) : (
        <>
          <PageTitle extra={props.refreshing ? <Typography.Text type="secondary">正在更新…</Typography.Text> : null}>
            我的任务
          </PageTitle>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 20px", alignItems: "center" }}>
            <Input
              ref={(node) => {
                searchRef.current = node;
              }}
              value={props.filters.search}
              placeholder="搜索任务标题或编号"
              style={{ width: 220 }}
              onChange={(event) => props.onFilters({ ...props.filters, search: event.target.value })}
            />
            <Select
              value={props.filters.priority}
              style={{ width: 130 }}
              options={[
                { value: "all", label: "全部优先级" },
                ...PRIORITY_ORDER.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] })),
              ]}
              onChange={(priority) => props.onFilters({ ...props.filters, priority: priority as IssueFilters["priority"] })}
            />
            <Select
              value={props.filters.dueFilter ?? "all"}
              style={{ width: 120 }}
              options={[
                { value: "all", label: "全部截止" },
                { value: "overdue", label: "已逾期" },
                { value: "today", label: "今日到期" },
                { value: "week", label: "未来 7 天" },
                { value: "no-due", label: "未设截止" },
              ]}
              onChange={(dueFilter) =>
                props.onFilters({ ...props.filters, dueFilter: dueFilter as IssueFilters["dueFilter"] })
              }
            />
            <Button type="link" onClick={props.onRefresh}>
              刷新
            </Button>
            {props.refreshing ? <Typography.Text type="secondary">正在更新…</Typography.Text> : null}
            <Typography.Text type="secondary">{pool.length === 0 ? "0 条" : `${visibleCount} 条`}</Typography.Text>
          </div>
        </>
      )}
      {props.error ? (
        <Typography.Paragraph type="danger" style={{ padding: "8px 20px 0", marginBottom: 0 }}>
          {props.error}
        </Typography.Paragraph>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {props.loading ? (
            <div style={{ padding: 24 }} aria-busy="true" aria-label={props.nav === "mine" ? "正在加载我的任务" : "正在加载项目"}>
              <Skeleton active paragraph={{ rows: 8 }} />
            </div>
          ) : props.nav === "mine" || props.view === "list" ? (
            <IssueList
              key={`${props.nav}:${props.projectId ?? ""}`}
              issues={props.issues}
              statuses={props.statuses}
              people={props.people}
              labels={props.labels}
              filters={props.filters}
              selectedId={props.selectedId}
              includeSubIssues={includeSubIssues}
              onSelect={props.onSelect}
              onMove={props.nav === "project" && !props.offlineReadOnly ? props.onMove : undefined}
            />
          ) : (
            <IssueBoard
              issues={props.issues}
              statuses={props.statuses}
              people={props.people}
              filters={props.filters}
              onSelect={props.onSelect}
              onMove={props.offlineReadOnly ? () => undefined : props.onMove}
            />
          )}
        </div>
      </div>
    </>
  );

  const workspaceBody =
    props.nav === "projects" ? (
      <ProjectList
        session={props.session}
        projects={props.projects}
        people={props.people}
        loading={props.loading}
        refreshing={props.refreshing}
        error={props.error}
        onEnter={props.onProject}
        onAddMember={(project) => props.onAddMemberOpen(project)}
        onEdit={(project) => props.onEditProjectOpen(project)}
      />
    ) : props.nav === "members" ? (
      <MemberAdmin
        session={props.session}
        members={props.members}
        loading={props.loading}
        refreshing={props.refreshing}
        error={props.error}
        onInvite={() => props.onInviteOpen(true)}
        onChangeRole={props.onChangeRole}
        onRemove={props.onRemoveMember}
      />
    ) : props.nav === "mcp" ? (
      <McpPage />
    ) : props.nav === "profile" ? (
      <ProfilePage session={props.session} saving={props.profileSaving} onSaveName={props.onSaveProfileName} />
    ) : (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>{workBody}</div>
    );

  return (
    <Layout style={{ height: "100%", background: "#fff" }}>
      {immersive ? null : (
        <Sider width={220} theme="light" style={{ borderRight: "1px solid #f0f0f0", overflow: "visible" }}>
          <Sidebar
            session={props.session}
            nav={props.nav}
            onNav={props.onNav}
            onSwitchWorkspace={props.onSwitchWorkspace}
            onLogout={props.onLogout}
          />
        </Sider>
      )}
      <Content style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "#fff" }}>
        {props.offlineReadOnly ? (
          <Alert
            banner
            type="warning"
            message={`离线只读模式：当前显示最近缓存数据${
              props.offlineSavedAt ? `（更新于 ${formatCommentTime(props.offlineSavedAt)}）` : ""
            }，编辑、上传和评论已禁用。`}
            action={
              <Button size="small" onClick={props.onRefresh}>
                重试连接
              </Button>
            }
          />
        ) : null}
        {immersive ? workBody : workspaceBody}
      </Content>
      <CreateIssueDialog
        open={props.createOpen}
        mock={props.session.mode === "mock"}
        projects={props.projects}
        projectId={props.projectId}
        statuses={props.statuses}
        people={props.people}
        milestones={props.milestones}
        components={props.components}
        labels={props.labels}
        issues={props.issues}
        templates={props.templates}
        defaultParentId={props.createParentId}
        onOpenChange={props.onCreateOpen}
        onCreate={props.onCreate}
      />
      <CommandPalette
        open={props.paletteOpen}
        issues={props.issues}
        view={props.view}
        onOpenChange={props.onPalette}
        onRun={props.onCommand}
      />
      <ProjectMetaModal
        open={props.metaModalOpen}
        milestones={props.milestones}
        components={props.components}
        people={props.people}
        readOnly={props.offlineReadOnly}
        onCancel={() => props.onMetaModalOpen(false)}
        onCreateMilestone={props.onCreateMilestone}
        onUpdateMilestone={props.onUpdateMilestone}
        onDeleteMilestone={props.onDeleteMilestone}
        onCreateComponent={props.onCreateComponent}
        onUpdateComponent={props.onUpdateComponent}
        onDeleteComponent={props.onDeleteComponent}
      />
      <TemplateModal
        open={props.templateModalOpen}
        templates={props.templates}
        people={props.people}
        milestones={props.milestones}
        components={props.components}
        labels={props.labels}
        readOnly={props.offlineReadOnly}
        onCancel={() => props.onTemplateModalOpen(false)}
        onCreate={props.onCreateTemplate}
        onUpdate={props.onUpdateTemplate}
        onDelete={props.onDeleteTemplate}
      />
      <NotificationDrawer
        open={props.notificationsOpen}
        notifications={props.notifications}
        loading={props.notificationsLoading}
        error={props.notificationsError}
        readOnly={props.offlineReadOnly}
        onClose={() => props.onNotificationsOpen(false)}
        onRefresh={props.onRefreshNotifications}
        onMarkRead={props.onMarkNotificationRead}
        onMarkAllRead={props.onMarkAllNotificationsRead}
        onOpenTarget={props.onOpenNotificationTarget}
      />
      <AddProjectMemberModal
        open={Boolean(props.addMemberProject)}
        project={props.addMemberProject}
        members={props.members}
        onCancel={() => props.onAddMemberOpen(null)}
        onSave={async (memberIds) => {
          if (!props.addMemberProject) return;
          await props.onSaveMembers(props.addMemberProject.id, memberIds);
          props.onAddMemberOpen(null);
        }}
      />
      <EditProjectModal
        open={Boolean(props.editProject)}
        project={props.editProject}
        people={props.people}
        onCancel={() => props.onEditProjectOpen(null)}
        onSave={async (patch) => {
          if (!props.editProject) return;
          await props.onSaveProject(props.editProject.id, patch);
          props.onEditProjectOpen(null);
        }}
      />
      <InviteMemberModal
        open={props.inviteOpen}
        onCancel={() => props.onInviteOpen(false)}
        onSend={props.onSendInvite}
        onCopyLink={props.onCopyInviteLink}
      />
    </Layout>
  );
}
