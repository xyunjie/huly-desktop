import type { PlatformClient } from "@hcengineering/api-client";
import { markupToText } from "@hcengineering/text-core";
import { localizeStatusName } from "@/domain/status";
import type { InboxNotification, Person, Status } from "@/domain/types";
import { formatDocUpdateBody, isInlineMarkupJson, type RawDocUpdateMessage } from "./markup";
import type { RawInboxNotification, RawIssue, RawProject, RawStatus } from "./mapping";

type ReadClient = Pick<PlatformClient, "findAll">;
type Context = { _id: string; objectId?: string };
type Message = RawDocUpdateMessage & { message?: string };

type FeedOptions = {
  classes: { context: string; activity: string; docUpdate: string; chat: string; thread: string; issue: string; project: string; issueStatus: string };
  accountId: string;
  people: Person[];
  resolveAuthor: (ref?: string) => string;
};

const stringKey = /^[\w.-]+:string:[\w.-]+$/;
const fields: Record<string, string> = {
  status: "状态", title: "标题", description: "描述", assignee: "指派人", priority: "优先级",
  dueDate: "截止日期", milestone: "里程碑", component: "组件", labels: "标签", comments: "评论",
  attachments: "附件", subIssues: "子任务", collaborators: "合作者",
};

export async function presentNotifications(client: ReadClient, rows: RawInboxNotification[], options: FeedOptions): Promise<InboxNotification[]> {
  const { classes } = options;
  async function byIds<T extends { _id: string }>(classRef: string, values: (string | undefined)[], scope: Record<string, unknown> = {}) {
    const ids = [...new Set(values.filter((value): value is string => Boolean(value)))];
    if (!ids.length) return new Map<string, T>();
    const docs = await client.findAll<T>(classRef, { ...scope, _id: { $in: ids } }).catch(() => [] as T[]);
    return new Map(docs.map((doc) => [doc._id, doc]));
  }

  const [contexts, messages] = await Promise.all([
    byIds<Context>(classes.context, rows.map((row) => row.docNotifyContext), { user: options.accountId }),
    byIds<Message>(classes.activity, rows.flatMap((row) => [row.attachedTo, row.mentionedIn])),
  ]);
  const messageFor = (row: RawInboxNotification) => messages.get(row.attachedTo ?? "") ?? messages.get(row.mentionedIn ?? "");
  const candidates = (row: RawInboxNotification) => {
    const message = messageFor(row);
    return [row.objectId, contexts.get(row.docNotifyContext ?? "")?.objectId, row.headerObjectId, message?.attachedTo, message?.objectId, row.mentionedIn];
  };
  const issues = await byIds<RawIssue>(classes.issue, rows.flatMap(candidates));
  const [projects, statusDocs] = await Promise.all([
    byIds<RawProject>(classes.project, Array.from(issues.values(), (issue) => issue.space)),
    byIds<RawStatus>(classes.issueStatus, Array.from(messages.values(), (message) => {
      const change = message.attributeUpdates;
      return change?.attrKey === "status" && typeof change.set?.[0] === "string" ? change.set[0] : undefined;
    })),
  ]);
  const statuses: Status[] = Array.from(statusDocs.values(), (doc) => ({
    id: doc._id, name: localizeStatusName(doc.name ?? doc.title ?? "状态"), category: "todo", color: "",
  }));

  return rows.map((row) => {
    const issue = candidates(row).flatMap((id) => id && issues.has(id) ? [issues.get(id)!] : [])[0];
    const message = messageFor(row);
    const project = issue ? projects.get(issue.space) : undefined;
    const params = { ...row.intlParamsNotLocalized, ...row.intlParams, ...row.props };
    const authorRef = message?.createdBy ?? message?.modifiedBy ?? row.createdBy ?? row.modifiedBy;
    const author = asText(params.senderName) || options.resolveAuthor(authorRef);
    const senderName = author === "成员" ? undefined : author;
    const event = describeEvent(row, message, statuses, options, params);
    const title = asText(issue?.title) || asText(params.issueTitle) || asText(params.title) || asText(row.title) || (issue ? "未命名任务" : "工作区通知");
    return {
      id: row._id, title, body: event,
      objectId: issue?._id ?? row.objectId ?? "", objectClass: issue ? classes.issue : row.objectClass ?? "",
      projectId: issue?.space, issueIdentifier: asText(issue?.identifier),
      projectName: asText(project?.name) || asText(project?.identifier),
      isViewed: Boolean(row.isViewed), createdOn: row.createdOn ?? row.modifiedOn ?? 0, senderName,
    } satisfies InboxNotification;
  });
}

function describeEvent(row: RawInboxNotification, message: Message | undefined, statuses: Status[], options: FeedOptions, params: Record<string, unknown>): string {
  const value = readMarkup(message?.message) || readMarkup(row.messageHtml) || readMarkup(row.data) || readMarkup(params.message);
  if (message && (message._class === options.classes.chat || message._class === options.classes.thread)) {
    return value ? `评论：${value}` : "发表了评论";
  }
  if (message?._class === options.classes.docUpdate) {
    const change = message.attributeUpdates;
    if (change?.attrKey === "status" && typeof change.set?.[0] === "string" && !statuses.some((status) => status.id === change.set?.[0])) {
      const value = change.set[0];
      const label = localizeStatusName(value.split(":").at(-1) ?? "");
      return label && label !== value.split(":").at(-1) ? `状态 设置为 ${label}` : "更改了状态";
    }
    return formatDocUpdateBody(message, { statuses, people: options.people });
  }
  const key = [row.message, row.body, row.title].find((item) => item && stringKey.test(item)) ?? "";
  const suffix = key.split(":").at(-1) ?? "";
  const property = localizedField(params.property);
  const collection = localizedField(params.collection);
  const newValue = asText(params.newValue);
  if (/mention/i.test(key) || row._class?.endsWith(":MentionInboxNotification")) return value ? `提及了你：${value}` : "提及了你";
  if (suffix === "IssueAssignedToYou") return "将任务分配给了你";
  if (suffix === "MessageNotificationBody" || suffix === "IssueNotificationMessage") return value ? `评论：${value}` : "发表了评论";
  if (suffix === "CommonNotificationCollectionAdded") return collection ? `添加了${collection}` : "添加了关联内容";
  if (suffix === "CommonNotificationCollectionRemoved") return collection ? `移除了${collection}` : "移除了关联内容";
  if (suffix.endsWith("ChangedProperty") && property && newValue) return `将${property}更改为 ${newValue}`;
  if (/NotificationChanged/.test(suffix)) return property ? `更改了${property}` : "更新了任务信息";
  return value || asText(row.message) || asText(row.body) || (row.objectClass?.endsWith(":Issue") ? "更新了任务信息" : "有新的活动");
}

function localizedField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.split(":").at(-1) ?? "";
  return fields[name] || fields[name.charAt(0).toLowerCase() + name.slice(1)] || asText(value);
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text || stringKey.test(text) || /^\{\w+\}$/.test(text)) return undefined;
  return text;
}

function readMarkup(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (isInlineMarkupJson(value)) return asText(markupToText(value))?.slice(0, 220);
  return asText(value.replace(/<[^>]+>/g, " "))?.slice(0, 220);
}
