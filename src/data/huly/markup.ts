import { jsonToMarkup, markupToJSON, markupToText } from "@hcengineering/text-core";
import { markdownToMarkup, markupToMarkdown } from "@hcengineering/text-markdown";
import { formatDue } from "@/domain/format";
import { PRIORITY_LABEL, priorityFromHuly } from "@/domain/priority";
import type { Person, Status } from "@/domain/types";

export const HULY_IMAGE_PREFIX = "https://huly-file.invalid/";

export function isInlineMarkupJson(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

export function sameDescriptionMarkup(first: string, second?: string): boolean {
  if (first === second) return true;
  if (!second) return false;
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, item]) => {
      if (item === null || (Array.isArray(item) && item.length === 0)) return [];
      const normalized = normalize(item);
      if (key === "attrs" && normalized && Object.keys(normalized).length === 0) return [];
      return [[key, normalized]];
    }));
  }
  try {
    return JSON.stringify(normalize(JSON.parse(first))) === JSON.stringify(normalize(JSON.parse(second)));
  } catch {
    return false;
  }
}

export function isHulyFileId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z\d][a-z\d.:_-]{0,255}$/i.test(value);
}

export function extractHulyFileId(src: string, serverUrl?: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  function decodeId(segment: string): string | null {
    const id = decodeURIComponent(segment);
    return isHulyFileId(id) ? id : null;
  }
  try {
    const prefix = [HULY_IMAGE_PREFIX, "image://"].find((value) => trimmed.startsWith(value));
    if (prefix) return decodeId(trimmed.slice(prefix.length).split(/[?&#]/)[0]);
    const base = serverUrl?.trim() || "https://huly.invalid";
    const parsed = new URL(trimmed, base);
    if (parsed.origin !== new URL(base).origin || !parsed.pathname.split("/").includes("files")) return null;
    const fileParam = parsed.searchParams.get("file") || parsed.searchParams.get("blobId");
    if (fileParam) {
      return decodeId(fileParam.split(/[?&#]/)[0]);
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.includes("files") && parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last && last !== "files") return decodeId(last);
    }
    return null;
  } catch {
    return null;
  }
}

export function decodeMarkupToMarkdown(
  value: unknown,
  options?: { refUrl?: string; imageUrl?: string },
): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!isInlineMarkupJson(trimmed)) return value;
  try {
    const json = markupToJSON(trimmed);
    const md = markupToMarkdown(json, {
      refUrl: options?.refUrl ?? "ref://",
      imageUrl: options?.imageUrl ?? HULY_IMAGE_PREFIX,
    });
    if (md.trim()) return md;
    return markupToText(trimmed);
  } catch {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return extractPlainText(parsed);
    } catch {
      return value;
    }
  }
}

export function encodeMarkdownToMarkup(markdown: string): string {
  return jsonToMarkup(markdownToMarkup(markdown));
}

function extractPlainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as { text?: unknown; content?: unknown[] };
  const parts: string[] = [];
  if (typeof record.text === "string") parts.push(record.text);
  if (Array.isArray(record.content)) {
    for (const child of record.content) {
      const piece = extractPlainText(child);
      if (piece) parts.push(piece);
    }
  }
  return parts.join(Array.isArray(record.content) ? "\n" : "").trim();
}

export interface RawDocUpdateMessage {
  _id: string;
  _class?: string;
  attachedTo?: string;
  action?: "create" | "update" | "remove";
  objectClass?: string;
  objectId?: string;
  updateCollection?: string;
  createdOn?: number;
  createdBy?: string;
  modifiedBy?: string;
  attributeUpdates?: {
    attrKey?: string;
    attrClass?: string;
    set?: unknown[];
    prevValue?: unknown;
    added?: unknown[];
    removed?: unknown[];
  };
}

const ATTR_LABELS: Record<string, string> = {
  status: "状态",
  priority: "优先级",
  assignee: "指派人",
  title: "标题",
  description: "描述",
  dueDate: "截止日期",
  milestone: "里程碑",
  component: "组件",
  estimation: "估算工时",
  remainingTime: "剩余工时",
  reportedTime: "已报工时",
  attachedTo: "上级任务",
  parents: "上级任务",
  blockedBy: "阻塞关系",
  relations: "关联任务",
};

export function formatDocUpdateBody(
  row: RawDocUpdateMessage,
  context: {
    statuses: Status[];
    people: Person[];
  },
): string {
  if (row.action === "create") {
    if (row.updateCollection === "attachments") return "上传了附件";
    if (row.updateCollection === "subIssues") return "添加了子任务";
    if (row.updateCollection === "reports") return "上报了工时";
    if (row.updateCollection === "labels") return "添加了标签";
    if (row.objectClass?.endsWith(":Issue")) return "创建了此任务";
    return "新建了关联记录";
  }
  if (row.action === "remove") {
    if (row.updateCollection === "attachments") return "删除了附件";
    if (row.updateCollection === "subIssues") return "移除了子任务";
    if (row.updateCollection === "reports") return "删除了工时记录";
    if (row.updateCollection === "labels") return "移除了标签";
    return "移除了关联记录";
  }

  const upd = row.attributeUpdates;
  if (!upd?.attrKey) return "更新了任务信息";
  const key = upd.attrKey;
  const label = ATTR_LABELS[key] ?? key;

  if (Array.isArray(upd.set) && upd.set.length > 0) {
    const val = upd.set[0];
    if (val === null || val === undefined || val === "") {
      return `清除了 ${label}`;
    }
    const formatted = formatAttrValue(key, val, context);
    if (formatted) return `${label} 设置为 ${formatted}`;
  }
  if (Array.isArray(upd.added) && upd.added.length > 0) {
    return `添加了 ${label}`;
  }
  if (Array.isArray(upd.removed) && upd.removed.length > 0) {
    return `移除了 ${label}`;
  }
  return `更新了 ${label}`;
}

function formatAttrValue(
  key: string,
  val: unknown,
  context: { statuses: Status[]; people: Person[] },
): string {
  if (key === "status" && typeof val === "string") {
    return context.statuses.find((s) => s.id === val)?.name ?? val.split(":").at(-1) ?? val;
  }
  if (key === "priority") {
    return PRIORITY_LABEL[priorityFromHuly(val)];
  }
  if (key === "assignee" && typeof val === "string") {
    return (
      context.people.find((p) => p.id === val || p.accountId === val)?.name ?? "成员"
    );
  }
  if (key === "dueDate" && typeof val === "number") {
    return formatDue(val);
  }
  if (key === "estimation" && typeof val === "number") {
    return `${val}h`;
  }
  if (typeof val === "string") {
    if (isInlineMarkupJson(val) || val.length > 48) return "";
    return val;
  }
  return "";
}
