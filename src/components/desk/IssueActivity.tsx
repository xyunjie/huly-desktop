import { CheckSquareOutlined, ControlOutlined, DownOutlined, FormOutlined, RightOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Button, Dropdown, Skeleton } from "antd";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { RenderBoundary } from "@/components/RenderBoundary";
import { inlineDescriptionText, resolveActivityDescription } from "@/data/huly/activityDescription";
import { activityTextDiff, groupActivity } from "@/domain/activity";
import type { ActivityItem, Attachment, Comment, EditorTemplate, Issue, Person, Status } from "@/domain/types";
import { StatusIcon } from "./StatusBadge";

const RichEditor = lazy(() => import("./IssueDescriptionEditor"));
type Filter = "all" | "comments" | "updates";
const filters: Record<Filter, string> = { all: "全部", comments: "评论", updates: "记录" };

type Props = {
  issue: Issue;
  people: Person[];
  statuses: Status[];
  comments: Comment[];
  activity: ActivityItem[];
  loading: boolean;
  error?: string | null;
  readOnly: boolean;
  onRefresh?: () => void;
  onSubmit?: (markup: string) => Promise<void>;
  onUpload?: (file: File) => Promise<Attachment | void>;
  onDownload?: (attachment: Attachment) => Promise<void>;
  onResolveImage?: (src: string) => Promise<string | null>;
  onLoadTemplates?: () => Promise<EditorTemplate[]>;
  onReadSnapshot?: (ref: string) => Promise<string>;
};

export function IssueActivity(props: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unchangedIds, setUnchangedIds] = useState<Set<string>>(new Set());
  const hideUnchanged = (id: string) => setUnchangedIds((current) => new Set(current).add(id));
  const groups = useMemo(() => {
    const comments: ActivityItem[] = props.comments.map((comment) => ({ ...comment, id: `comment:${comment.id}`, kind: "comment" }));
    const activity = props.activity.filter((item) => {
      const change = item.change;
      if (change?.type !== "description") return true;
      if (unchangedIds.has(item.id)) return false;
      const before = change.text?.before ?? inlineDescriptionText(change.before);
      const after = change.text?.after ?? inlineDescriptionText(change.after);
      return before === undefined || before !== after;
    });
    const visible = groupActivity([...activity, ...comments]).filter(([item]) =>
      filter === "all" || item.kind === (filter === "comments" ? "comment" : "update"));
    return newestFirst ? visible.reverse().map((group) => [...group].reverse()) : visible;
  }, [props.activity, props.comments, filter, newestFirst, unchangedIds]);

  const composer = props.onSubmit && !props.readOnly ? (
    <div className="hd-activity-compose">
      <RenderBoundary fallback={<p className="hd-activity-warning" role="alert">评论编辑器未能加载，仍可查看已有活动。</p>}>
        <Suspense fallback={<Skeleton title={false} paragraph={{ rows: 1 }} />}>
          <RichEditor mode="comment" issueId={props.issue.id} markdown="" readOnly={false} people={props.people}
            onSubmit={props.onSubmit} onUpload={props.onUpload} onDownload={props.onDownload}
            onResolveImage={props.onResolveImage} onLoadTemplates={props.onLoadTemplates} />
        </Suspense>
      </RenderBoundary>
    </div>
  ) : null;

  return <section className={newestFirst ? "hd-activity" : "hd-activity hd-activity-oldest"} aria-label="活动" aria-busy={props.loading}>
    <header className="hd-activity-header">
      <h2><FormOutlined aria-hidden="true" />活动</h2>
      <div className="hd-activity-controls">
        <Dropdown trigger={["click"]} menu={{ selectable: true, selectedKeys: [filter],
          items: Object.entries(filters).map(([key, label]) => ({ key, label })),
          onClick: ({ key }) => setFilter(key as Filter), }}>
          <Button size="small" className="hd-activity-filter" aria-label={`筛选活动：${filters[filter]}`}>{filters[filter]}</Button>
        </Dropdown>
        <Dropdown trigger={["click"]} menu={{ selectable: true, selectedKeys: [newestFirst ? "new" : "old"],
          items: [{ key: "new", label: "最新优先" }, { key: "old", label: "最早优先" },
            ...(props.onRefresh && !props.readOnly ? [{ type: "divider" as const }, { key: "reload", label: "刷新活动" }] : [])],
          onClick: ({ key }) => key === "reload" ? props.onRefresh?.() : setNewestFirst(key === "new"), }}>
          <Button type="text" size="small" aria-label="活动设置" title="活动设置" icon={<ControlOutlined />} />
        </Dropdown>
      </div>
    </header>
    {composer}
    {props.error ? <div className="hd-activity-warning" role="alert">
      {props.error}
      {props.onRefresh && !props.readOnly ? <Button type="link" size="small" loading={props.loading} onClick={props.onRefresh}>重试加载</Button> : null}
    </div> : null}
    {props.loading ? <p className="hd-activity-hint" role="status">正在加载活动…</p> : null}
    {groups.length ? <ol className="hd-activity-list">{groups.map((group) => {
      const head = group[0];
      const key = newestFirst ? group.at(-1)!.id : head.id;
      const open = expanded.has(key);
      return <li key={key} className="hd-activity-group">
        <ActivityRow item={head} onUnchanged={hideUnchanged} {...props} />
        {group.length > 1 ? <button className="hd-activity-disclosure hd-activity-group-toggle" type="button" aria-expanded={open}
          onClick={() => setExpanded((current) => { const next = new Set(current); if (open) next.delete(key); else next.add(key); return next; })}>
          {open ? <DownOutlined aria-hidden="true" /> : <RightOutlined aria-hidden="true" />}{open ? "收起重复记录" : `展开 ${group.length - 1} 条重复记录`}
        </button> : null}
        {open ? group.slice(1).map((item) => <ActivityRow key={item.id} item={item} onUnchanged={hideUnchanged} {...props} />) : null}
      </li>;
    })}</ol> : !props.loading && !props.error ? <p className="hd-activity-hint">
      {filter === "comments" ? "还没有评论。" : filter === "updates" ? "还没有变更记录。" : "还没有活动或评论记录。"}
    </p> : null}
  </section>;
}

function ActivityRow({ item, statuses, issue, onResolveImage, onReadSnapshot, onDownload, onUnchanged }: { item: ActivityItem; onUnchanged: (id: string) => void } & Props) {
  const change = item.change;
  const status = change?.type === "status" ? statuses.find((candidate) => candidate.id === change.statusId) : undefined;
  const date = item.createdOn > 0 ? new Date(item.createdOn) : null;
  const initials = item.authorName.trim().split(/\s+/).slice(0, 2).map((name) => Array.from(name)[0] ?? "").join("").toUpperCase();
  return <article className="hd-activity-row">
    <Avatar shape="square" size={40} className="hd-activity-avatar" style={{ background: authorColor(item.authorId ?? item.authorName) }} aria-hidden="true">
      {initials || "?"}
    </Avatar>
    <div className="hd-activity-row-body">
      <div className="hd-activity-meta">
        <strong>{item.authorName}</strong>
        {item.providerLabel ? <span>({item.providerLabel})</span> : null}
        {item.kind === "comment" ? <span>留下评论</span> : change?.type === "description" ? <span>更改了描述</span> : null}
        {date && !Number.isNaN(date.valueOf()) ? <time dateTime={date.toISOString()}>于 {formatTime(date)}</time> : null}
      </div>
      {item.kind === "comment" ? <ActivityCommentBody item={item} onResolveImage={onResolveImage} onDownload={onDownload} />
        : change?.type === "description" ? <DescriptionDiff change={change} onReadSnapshot={onReadSnapshot} onUnchanged={() => onUnchanged(item.id)} />
        : <div className="hd-activity-event">
          {change?.type === "status" ? <StatusIcon status={status} size={14} /> : change?.type === "assignee" ? <UserOutlined /> : change?.type === "created" ? <CheckSquareOutlined /> : null}
          {status ? <span>状态 设置到 <strong>{status.name}</strong></span>
            : change?.type === "created" ? <span>新问题：<strong className="hd-activity-issue-title">{issue.title}</strong></span> : <span>{item.body}</span>}
        </div>}
    </div>
  </article>;
}

function ActivityCommentBody({ item, onResolveImage, onDownload }: { item: ActivityItem; onResolveImage?: Props["onResolveImage"]; onDownload?: Props["onDownload"] }) {
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const plain = <MarkdownView text={item.body} resolveImage={onResolveImage} />;
  if (!item.nativeMarkup || !/"type"\s*:\s*"(?:file|table|embed|drawingBoard)"/.test(item.nativeMarkup)) return plain;
  return <div className="hd-activity-comment-rich">
    <RenderBoundary fallback={plain}>
      <Suspense fallback={plain}>
        <RichEditor issueId={item.issueId} readOnly people={[]} markdown={item.body} markup={item.nativeMarkup}
          flushRef={flushRef} onSave={async () => undefined} onDownload={onDownload} onResolveImage={onResolveImage} />
      </Suspense>
    </RenderBoundary>
  </div>;
}

function DescriptionDiff({ change, onReadSnapshot, onUnchanged }: {
  change: Extract<ActivityItem["change"], { type: "description" }>;
  onReadSnapshot?: Props["onReadSnapshot"];
  onUnchanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<{ before?: string; after?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  function toggle() {
    setOpen(!open);
    if (open || resolved || loading) return;
    setLoading(true);
    void Promise.all([
      change.text?.before ?? resolveActivityDescription(change.before, onReadSnapshot),
      change.text?.after ?? resolveActivityDescription(change.after, onReadSnapshot),
    ]).then(([before, after]) => {
      if (before !== undefined && before === after) onUnchanged();
      else setResolved({ before, after });
    }).finally(() => setLoading(false));
  }
  const diff = resolved?.before !== undefined && resolved.after !== undefined
    ? activityTextDiff(resolved.before, resolved.after) : null;
  return <>
    <button type="button" className="hd-activity-disclosure" aria-expanded={open} onClick={toggle}>
      {open ? <DownOutlined aria-hidden="true" /> : <RightOutlined aria-hidden="true" />}{open ? "显示更少" : "显示更多"}
    </button>
    {open ? <div className="hd-activity-diff">
      {loading ? "正在读取修改内容…" : diff && (diff.removed || diff.added) ? <>
        {diff.prefix}{diff.removed ? <del title="删除的内容">{diff.removed}</del> : null}{diff.added ? <ins title="新增的内容">{diff.added}</ins> : null}{diff.suffix}
      </> : resolved?.after !== undefined ? <><small>原版本不可用，以下是此次保存的内容：</small><div>{resolved.after || "（空描述）"}</div></>
        : "服务器未提供可用的历史描述内容。"}
    </div> : null}
  </>;
}

function formatTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function authorColor(key: string) {
  const palette = ["#676bce", "#358463", "#8a69ca", "#467da7", "#a25b87", "#737d43"];
  let index = 0;
  for (const char of key) index = (index * 31 + char.charCodeAt(0)) >>> 0;
  return palette[index % palette.length];
}
