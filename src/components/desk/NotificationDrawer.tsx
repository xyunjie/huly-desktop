import { CheckOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Segmented, Skeleton, Space } from "antd";
import { useState } from "react";
import { formatCommentTime } from "@/domain/format";
import type { InboxNotification } from "@/domain/types";

export function NotificationDrawer({
  open, notifications, loading, error, readOnly = false, onClose, onRefresh, onMarkRead, onMarkAllRead, onOpenTarget,
}: {
  open: boolean;
  notifications: InboxNotification[];
  loading: boolean;
  error?: string | null;
  readOnly?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onOpenTarget: (notification: InboxNotification) => void;
}) {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const unread = notifications.filter((item) => !item.isViewed);
  const shown = tab === "unread" ? unread : notifications;

  async function mark(key: string, action: () => Promise<void>) {
    if (marking) return;
    setMarking(key);
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError("未能标为已读，请重试。");
    } finally {
      setMarking(null);
    }
  }

  return <Drawer open={open} title="通知收件箱" width={420} onClose={onClose} extra={
    <Space size={6}>
      <Button size="small" onClick={() => { setActionError(null); onRefresh(); }} loading={loading}>刷新</Button>
      {!readOnly && unread.length > 0 ? <Button size="small" icon={<CheckOutlined />} loading={marking === "all"}
        disabled={Boolean(marking)} onClick={() => void mark("all", onMarkAllRead)}>全部已读</Button> : null}
    </Space>
  }>
    <Segmented className="hd-notification-tabs" block value={tab} onChange={(value) => setTab(value as "all" | "unread")}
      options={[{ label: `全部 (${notifications.length})`, value: "all" }, { label: `未读 (${unread.length})`, value: "unread" }]} />
    {error || actionError ? <Alert type="warning" showIcon message={actionError || error} /> : null}
    {shown.length ? <ul className="hd-notification-list">{shown.map((item) => {
      const canOpen = Boolean(item.projectId && item.objectId);
      const summary = <NotificationSummary item={item} />;
      return <li key={item.id} className={item.isViewed ? "hd-notification-card" : "hd-notification-card hd-notification-unread"}>
        {canOpen ? <button className="hd-notification-target" type="button"
          aria-label={`打开任务 ${[item.issueIdentifier, item.title].filter(Boolean).join(" ")}`}
          aria-describedby={item.body ? `hd-notification-event-${item.id}` : undefined} onClick={() => {
          if (!item.isViewed && !readOnly) void mark(item.id, () => onMarkRead(item.id));
          onOpenTarget(item);
        }}>{summary}</button> : <div className="hd-notification-content">{summary}</div>}
        {!readOnly && !item.isViewed ? <div className="hd-notification-actions">
          <Button type="link" size="small" loading={marking === item.id} disabled={Boolean(marking)}
            onClick={() => void mark(item.id, () => onMarkRead(item.id))}>标为已读</Button>
        </div> : null}
      </li>;
    })}</ul> : loading ? <Skeleton active title={false} paragraph={{ rows: 4 }} /> : !error ? (
      <Empty description={tab === "unread" ? "没有未读通知。" : "收件箱为空。"} style={{ marginTop: 64 }} />
    ) : null}
  </Drawer>;
}

function NotificationSummary({ item }: { item: InboxNotification }) {
  return <>
    <span className="hd-notification-meta">
      {!item.isViewed ? <span className="hd-notification-unread-dot" aria-label="未读" /> : null}
      {item.issueIdentifier ? <span className="hd-notification-issue-id">{item.issueIdentifier}</span> : null}
      {item.projectName ? <span className="hd-notification-project" title={item.projectName}>{item.projectName}</span> : null}
      {item.createdOn > 0 ? <span className="hd-notification-time">{formatCommentTime(item.createdOn)}</span> : null}
    </span>
    <strong className="hd-notification-title">{item.title}</strong>
    {item.body ? <span id={`hd-notification-event-${item.id}`} className="hd-notification-event">{item.senderName ? <b>{item.senderName} </b> : null}{item.body}</span> : null}
  </>;
}
