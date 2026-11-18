import {
  DeleteOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  DatePicker,
  Divider,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import zhDatePicker from "antd/es/date-picker/locale/zh_CN";
import dayjs from "dayjs";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { RenderBoundary } from "@/components/RenderBoundary";
import { nameInitial } from "@/data/huly/mapping";
import { avatarColor, formatCommentTime, formatDue, formatFileSize, formatHours, projectHeading } from "@/domain/format";
import { PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_ORDER } from "@/domain/priority";
import type {
  ActivityItem,
  Attachment,
  Comment,
  CommentFormat,
  Component,
  EditorTemplate,
  Issue,
  IssuePatch,
  Label,
  Milestone,
  Person,
  Priority,
  Project,
  Status,
} from "@/domain/types";
import { StatusIcon, StatusQuickSelect } from "./StatusBadge";
import { IssueActivity } from "./IssueActivity";

const IssueDescriptionEditor = lazy(() => import("./IssueDescriptionEditor"));

export function IssueDetail({
  issue,
  project = null,
  backLabel = "返回任务列表",
  issues,
  statuses,
  people,
  labels,
  milestones,
  components,
  comments,
  activity = [],
  activityLoading = false,
  activityError,
  onRefreshActivity,
  attachments = [],
  commentWrite,
  mock,
  readOnly = false,
  descriptionLoading,
  onClose,
  onSelect,
  onUpdate,
  onComment,
  onOpenCreateSubIssue,
  onUploadAttachment,
  onDownloadAttachment,
  onDeleteAttachment,
  onResolveImage,
  onLoadEditorTemplates,
  onReadDescriptionSnapshot,
}: {
  issue: Issue;
  project?: Project | null;
  backLabel?: string;
  issues: Issue[];
  statuses: Status[];
  people: Person[];
  labels: Label[];
  milestones: Milestone[];
  components: Component[];
  comments: Comment[];
  activity?: ActivityItem[];
  activityLoading?: boolean;
  activityError?: string | null;
  onRefreshActivity?: () => void;
  attachments?: Attachment[];
  commentWrite: boolean;
  mock: boolean;
  readOnly?: boolean;
  descriptionLoading: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onUpdate: (patch: IssuePatch) => Promise<void>;
  onComment: (body: string, format?: CommentFormat) => Promise<void>;
  onOpenCreateSubIssue?: (parentId: string) => void;
  onUploadAttachment?: (file: File) => Promise<Attachment | void>;
  onDownloadAttachment?: (attachment: Attachment) => Promise<void>;
  onDeleteAttachment?: (attachmentId: string) => Promise<void>;
  onResolveImage?: (src: string) => Promise<string | null>;
  onLoadEditorTemplates?: () => Promise<EditorTemplate[]>;
  onReadDescriptionSnapshot?: (ref: string) => Promise<string>;
}) {
  const [title, setTitle] = useState(issue.title);
  const flushDescription = useRef<(() => Promise<boolean>) | null>(null);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);

  const children = useMemo(
    () => issues.filter((item) => item.parentIds.includes(issue.id)),
    [issue.id, issues],
  );
  const parents = useMemo(
    () =>
      issue.parentIds
        .map((parentId) => issues.find((item) => item.id === parentId))
        .filter((item): item is Issue => Boolean(item)),
    [issue.parentIds, issues],
  );
  const immediateParentId = issue.parentIds.at(-1) ?? null;

  const eligibleParents = useMemo(
    () =>
      issues.filter(
        (item) =>
          item.projectId === issue.projectId &&
          item.id !== issue.id &&
          !item.parentIds.includes(issue.id),
      ),
    [issue.id, issue.projectId, issues],
  );

  const statusById = useMemo(() => new Map(statuses.map((item) => [item.id, item])), [statuses]);
  const personById = useMemo(() => new Map(people.map((item) => [item.id, item])), [people]);
  const currentStatus = statusById.get(issue.statusId);
  const currentAssignee = issue.assigneeId ? personById.get(issue.assigneeId) : undefined;

  const todayStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, []);
  const isDoneOrCanceled = currentStatus?.category === "done" || currentStatus?.category === "canceled";
  const isOverdue = Boolean(issue.dueDate && issue.dueDate < todayStart && !isDoneOrCanceled);

  useEffect(() => {
    setTitle(issue.title);
    setError(null);
  }, [issue.id, issue.title]);

  async function save(patch: IssuePatch) {
    if (readOnly) {
      setError("当前处于离线只读模式，无法保存更改。");
      return;
    }
    setError(null);
    try {
      await onUpdate(patch);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "没有保存。");
    }
  }

  function commitTitle() {
    if (readOnly) {
      setTitle(issue.title);
      return;
    }
    const trimmed = title.trim();
    if (trimmed && trimmed !== issue.title) {
      void save({ title: trimmed });
    } else if (!trimmed) {
      setTitle(issue.title);
    }
  }

  function afterDescriptionSave(action: () => void) {
    const flush = flushDescription.current;
    if (!flush) action();
    else void flush().then((ok) => { if (ok) action(); });
  }

  async function handleUploadFile(file: File) {
    if (!onUploadAttachment || readOnly) return;
    setUploading(true);
    setError(null);
    try {
      await onUploadAttachment(file);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "附件上传失败。");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="hd-detail-page" data-testid="issue-detail-page">
      <header className="hd-detail-topbar">
        <Button data-testid="detail-back" onClick={() => afterDescriptionSave(onClose)}>
          ← {backLabel}
        </Button>

        <nav className="hd-detail-breadcrumb" aria-label="任务位置">
          {project ? (
            <>
              <button type="button" className="hd-breadcrumb-link" onClick={() => afterDescriptionSave(onClose)}>
                {projectHeading(project.identifier, project.name)}
              </button>
              <span className="hd-breadcrumb-sep">/</span>
            </>
          ) : null}
          {parents.map((parent) => (
            <span key={parent.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="hd-breadcrumb-link"
                onClick={() => afterDescriptionSave(() => onSelect(parent.id))}
                title={parent.title}
              >
                {parent.identifier}
              </button>
              <span className="hd-breadcrumb-sep">/</span>
            </span>
          ))}
          <span className="hd-breadcrumb-current">
            <StatusIcon status={currentStatus} size={14} />
            <span>{issue.identifier}</span>
          </span>
        </nav>

        <div className="hd-detail-topbar-right">
          {readOnly ? (
            <Tag color="warning" style={{ marginInlineEnd: 0 }}>
              离线只读
            </Tag>
          ) : null}
          {mock ? <Tag style={{ marginInlineEnd: 0 }}>示例数据</Tag> : null}
          {issue.modifiedOn > 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              更新于 {formatCommentTime(issue.modifiedOn)}
            </Typography.Text>
          ) : null}
        </div>
      </header>

      <div className="hd-detail-body">
        <main className="hd-detail-main">
          <div className="hd-detail-canvas">
            {parents.length > 0 ? (
              <div className="hd-detail-parent-row">
                {parents.map((parent) => (
                  <button
                    key={parent.id}
                    type="button"
                    className="hd-parent-chip"
                    onClick={() => afterDescriptionSave(() => onSelect(parent.id))}
                  >
                    <span style={{ color: "#6b778c" }}>上级任务</span>
                    <span style={{ fontWeight: 600 }}>{parent.identifier}</span>
                    <span className="hd-parent-chip-title">{parent.title}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <Input.TextArea
              variant="borderless"
              autoSize={{ minRows: 1 }}
              readOnly={readOnly}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={commitTitle}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              aria-label="任务标题"
              className="hd-detail-title-input"
            />

            <div className="hd-detail-meta-strip">
              <StatusQuickSelect
                status={currentStatus}
                statuses={statuses}
                onChange={readOnly ? undefined : (statusId) => void save({ statusId })}
              />
              <Tag color={PRIORITY_COLOR[issue.priority]} style={{ marginInlineEnd: 0 }}>
                优先级 · {PRIORITY_LABEL[issue.priority]}
              </Tag>
              {currentAssignee ? (
                <span className="hd-detail-meta-chip">
                  <Avatar size={18} style={{ background: avatarColor(currentAssignee.id), fontSize: 10 }}>
                    {nameInitial(currentAssignee.name)}
                  </Avatar>
                  <span>{currentAssignee.name}</span>
                </span>
              ) : null}
              {issue.dueDate ? (
                <span
                  className="hd-detail-meta-chip"
                  style={{
                    color: isOverdue ? "#cf1322" : "#5e6c84",
                    borderColor: isOverdue ? "#ffa39e" : "#e6e8ec",
                    background: isOverdue ? "#fff1f0" : "#fafbfc",
                  }}
                >
                  截止 {formatDue(issue.dueDate)}
                  {isOverdue ? " · 已逾期" : ""}
                </span>
              ) : null}
            </div>

            {error ? (
              <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
                {error}
              </Typography.Paragraph>
            ) : null}

            <section className="hd-detail-section">
              <div className="hd-detail-section-head">
                <Typography.Text strong style={{ fontSize: 14 }}>
                  描述
                </Typography.Text>
              </div>
              {descriptionLoading && !issue.descriptionMarkup ? (
                <Skeleton active title={false} paragraph={{ rows: 3 }} />
              ) : issue.descriptionUnavailable && !issue.descriptionMarkup ? (
                <div className="hd-detail-desc-box">
                  {issue.description.trim() ? <MarkdownView text={issue.description} resolveImage={onResolveImage} /> : null}
                  <Typography.Text type="secondary">未能加载富文本原文，请刷新后再编辑。</Typography.Text>
                </div>
              ) : (
                <RenderBoundary key={issue.id} fallback={
                  <div className="hd-detail-desc-box">
                    {issue.description.trim() ? <MarkdownView text={issue.description} resolveImage={onResolveImage} /> : null}
                    <Typography.Text type="secondary" role="alert">描述编辑器未能加载，当前仅可查看。重新打开应用后可重试。</Typography.Text>
                  </div>
                }>
                  <Suspense fallback={issue.description ? <MarkdownView text={issue.description} resolveImage={onResolveImage} /> : <Skeleton title={false} paragraph={{ rows: 1 }} />}>
                    <IssueDescriptionEditor
                      issueId={issue.id}
                      markdown={issue.description}
                      markup={issue.descriptionMarkup}
                      readOnly={readOnly}
                      people={people}
                      onSave={(descriptionMarkup, previousDescriptionMarkup) => onUpdate({ descriptionMarkup, previousDescriptionMarkup })}
                      onUpload={onUploadAttachment}
                      onDownload={onDownloadAttachment}
                      onResolveImage={onResolveImage}
                      onLoadTemplates={onLoadEditorTemplates}
                      flushRef={flushDescription}
                    />
                  </Suspense>
                </RenderBoundary>
              )}
            </section>

            <section className="hd-detail-section">
              <div className="hd-detail-section-head">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <PaperClipOutlined style={{ color: "#5e6c84" }} />
                  <Typography.Text strong style={{ fontSize: 14 }}>
                    附件
                  </Typography.Text>
                  <span className="hd-group-count">{attachments.length}</span>
                </span>
                {!readOnly && onUploadAttachment ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      style={{ display: "none" }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void handleUploadFile(file);
                      }}
                    />
                    <Button
                      size="small"
                      icon={<UploadOutlined />}
                      loading={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      上传附件
                    </Button>
                  </>
                ) : null}
              </div>
              {attachments.length === 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  没有附件。
                </Typography.Text>
              ) : (
                <div className="hd-detail-sublist">
                  {attachments.map((att) => (
                    <div key={att.id} className="hd-detail-att-row">
                      <PaperClipOutlined style={{ color: "#6b778c", flex: "none" }} />
                      <span className="hd-detail-subtitle" title={att.name}>
                        {att.name}
                      </span>
                      <Typography.Text type="secondary" style={{ fontSize: 12, flex: "none" }}>
                        {formatFileSize(att.size)}
                      </Typography.Text>
                      <Space size={4} style={{ flex: "none" }}>
                        {onDownloadAttachment ? (
                          <Button
                            type="text"
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={() => void onDownloadAttachment(att)}
                            aria-label={`下载 ${att.name}`}
                          >
                            下载
                          </Button>
                        ) : null}
                        {!readOnly && onDeleteAttachment ? (
                          <Popconfirm
                            title="确认删除该附件？"
                            okText="删除"
                            cancelText="取消"
                            onConfirm={() => void onDeleteAttachment(att.id)}
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              aria-label={`删除 ${att.name}`}
                            />
                          </Popconfirm>
                        ) : null}
                      </Space>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="hd-detail-section">
              <div className="hd-detail-section-head">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Typography.Text strong style={{ fontSize: 14 }}>
                    子任务
                  </Typography.Text>
                  <span className="hd-group-count">{children.length}</span>
                </span>
                {!readOnly && onOpenCreateSubIssue ? (
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => onOpenCreateSubIssue(issue.id)}
                  >
                    添加子问题
                  </Button>
                ) : null}
              </div>

              {children.length === 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  没有子任务。
                </Typography.Text>
              ) : (
                <div className="hd-detail-sublist">
                  {children.map((child) => {
                    const childStatus = statusById.get(child.statusId);
                    const childPerson = child.assigneeId ? personById.get(child.assigneeId) : undefined;
                    return (
                      <div
                        key={child.id}
                        role="button"
                        tabIndex={0}
                        className="hd-detail-subrow"
                        onClick={() => afterDescriptionSave(() => onSelect(child.id))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            afterDescriptionSave(() => onSelect(child.id));
                          }
                        }}
                      >
                        <StatusIcon status={childStatus} size={14} />
                        <span className="hd-detail-subid">{child.identifier}</span>
                        <span className="hd-detail-subtitle">{child.title}</span>
                        <Tag color={PRIORITY_COLOR[child.priority]} style={{ marginInlineEnd: 0 }}>
                          {PRIORITY_LABEL[child.priority]}
                        </Tag>
                        {childPerson ? (
                          <span className="hd-assignee-wrap" style={{ flex: "none" }}>
                            <Avatar size={18} style={{ background: avatarColor(childPerson.id), fontSize: 10 }}>
                              {nameInitial(childPerson.name)}
                            </Avatar>
                            <span style={{ fontSize: 12, color: "#42526e" }}>{childPerson.name}</span>
                          </span>
                        ) : (
                          <Typography.Text type="secondary" style={{ fontSize: 12, flex: "none" }}>
                            未指派
                          </Typography.Text>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <IssueActivity key={issue.id} issue={issue} people={people} statuses={statuses} comments={comments} activity={activity}
              loading={activityLoading} error={activityError} readOnly={readOnly} onRefresh={onRefreshActivity}
              onSubmit={commentWrite ? (markup) => onComment(markup, "markup") : undefined}
              onUpload={onUploadAttachment} onDownload={onDownloadAttachment} onResolveImage={onResolveImage}
              onLoadTemplates={onLoadEditorTemplates} onReadSnapshot={onReadDescriptionSnapshot} />
          </div>
        </main>

        <aside className="hd-detail-inspector" aria-label="任务属性">
          <Typography.Text strong style={{ fontSize: 13, color: "#5e6c84", display: "block", marginBottom: 14 }}>
            属性
          </Typography.Text>

          <div className="hd-inspector-fields">
            <Field label="状态">
              <Select
                disabled={readOnly}
                value={issue.statusId}
                style={{ width: "100%" }}
                options={statuses.map((item) => ({
                  value: item.id,
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <StatusIcon status={item} size={13} />
                      <span>{item.name}</span>
                    </span>
                  ),
                }))}
                onChange={(statusId) => void save({ statusId })}
              />
            </Field>

            <Field label="优先级">
              <Select
                disabled={readOnly}
                value={issue.priority}
                style={{ width: "100%" }}
                options={PRIORITY_ORDER.map((priority) => ({
                  value: priority,
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: PRIORITY_COLOR[priority],
                          flex: "none",
                        }}
                      />
                      <span>{PRIORITY_LABEL[priority]}</span>
                    </span>
                  ),
                }))}
                onChange={(priority) => void save({ priority: priority as Priority })}
              />
            </Field>

            <Field label="指派人">
              <Select
                disabled={readOnly}
                value={issue.assigneeId ?? ""}
                style={{ width: "100%" }}
                options={[
                  { value: "", label: "未指派" },
                  ...people.map((person) => ({
                    value: person.id,
                    label: (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Avatar size={18} style={{ background: avatarColor(person.id), fontSize: 10 }}>
                          {nameInitial(person.name)}
                        </Avatar>
                        <span>{person.name}</span>
                      </span>
                    ),
                  })),
                ]}
                onChange={(assigneeId) => void save({ assigneeId: assigneeId || null })}
              />
            </Field>

            <Field label="上级任务">
              <Select
                disabled={readOnly}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="无（顶级任务）"
                value={immediateParentId ?? undefined}
                style={{ width: "100%" }}
                options={eligibleParents.map((item) => ({
                  value: item.id,
                  label: `${item.identifier} ${item.title}`,
                }))}
                onChange={(parentId) => void save({ parentId: parentId ?? null })}
              />
            </Field>

            <Field label="里程碑">
              <Select
                disabled={readOnly}
                value={issue.milestoneId ?? ""}
                style={{ width: "100%" }}
                options={[{ value: "", label: "无" }, ...milestones.map((item) => ({ value: item.id, label: item.name }))]}
                onChange={(milestoneId) => void save({ milestoneId: milestoneId || null })}
              />
            </Field>

            <Field label="组件">
              <Select
                disabled={readOnly}
                value={issue.componentId ?? ""}
                style={{ width: "100%" }}
                options={[{ value: "", label: "无" }, ...components.map((item) => ({ value: item.id, label: item.name }))]}
                onChange={(componentId) => void save({ componentId: componentId || null })}
              />
            </Field>

            <Field label="截止日期">
              <DatePicker
                disabled={readOnly}
                style={{ width: "100%" }}
                locale={zhDatePicker}
                placeholder="请选择日期"
                value={issue.dueDate ? dayjs(issue.dueDate) : null}
                onChange={(value) =>
                  void save({ dueDate: value ? value.hour(12).minute(0).second(0).millisecond(0).valueOf() : null })
                }
              />
            </Field>

            <Field label="估算工时">
              <InputNumber
                disabled={readOnly}
                min={0}
                step={0.5}
                style={{ width: "100%" }}
                placeholder="未设置（小时）"
                value={issue.estimationHours ?? null}
                onChange={(value) => {
                  if (typeof value === "number") void save({ estimationHours: value });
                }}
              />
            </Field>

            <Field label="标签" alignTop>
              <Space size={6} wrap>
                {labels.map((label) => {
                  const on = issue.labelIds.includes(label.id);
                  return (
                    <Tag
                      key={label.id}
                      color={on ? label.color : undefined}
                      style={{ cursor: readOnly ? "default" : "pointer", marginInlineEnd: 0 }}
                      onClick={() => {
                        if (readOnly) return;
                        const labelIds = on
                          ? issue.labelIds.filter((id) => id !== label.id)
                          : [...issue.labelIds, label.id];
                        void save({ labelIds });
                      }}
                    >
                      {label.name}
                    </Tag>
                  );
                })}
                {labels.length === 0 ? <Typography.Text type="secondary">没有标签</Typography.Text> : null}
              </Space>
            </Field>
          </div>

          <Divider style={{ margin: "18px 0" }} />

          <div className="hd-inspector-meta">
            <div className="hd-inspector-meta-row">
              <Typography.Text type="secondary">编号</Typography.Text>
              <Typography.Text>{issue.identifier}</Typography.Text>
            </div>
            {project ? (
              <div className="hd-inspector-meta-row">
                <Typography.Text type="secondary">所属项目</Typography.Text>
                <Typography.Text ellipsis={{ tooltip: project.name }} style={{ maxWidth: 180 }}>
                  {projectHeading(project.identifier, project.name)}
                </Typography.Text>
              </div>
            ) : null}
            <div className="hd-inspector-meta-row">
              <Typography.Text type="secondary">已上报工时</Typography.Text>
              <Typography.Text>{formatHours(issue.reportedTime ?? 0)}</Typography.Text>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  alignTop = false,
  children,
}: {
  label: string;
  alignTop?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "68px 1fr",
        gap: 10,
        alignItems: alignTop ? "start" : "center",
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 13, paddingTop: alignTop ? 3 : 0 }}>
        {label}
      </Typography.Text>
      <div style={{ minWidth: 0 }}>{children}</div>
    </label>
  );
}
