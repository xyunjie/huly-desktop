import type { Status, StatusCategory } from "./types";

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  backlog: "待办池",
  todo: "待办",
  "in-progress": "进行中",
  done: "完成",
  canceled: "已取消",
};

export const CATEGORY_COLOR: Record<StatusCategory, string> = {
  backlog: "#8a94a6",
  todo: "#1c7ed6",
  "in-progress": "#f08c00",
  done: "#2f9e44",
  canceled: "#868e96",
};

const CATEGORY_ORDER: StatusCategory[] = ["backlog", "todo", "in-progress", "done", "canceled"];

export function categoryRank(category: StatusCategory): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/**
 * Map a Huly status id, category id, or name onto a board column.
 * 0.7.423 task categories are UnStarted / ToDo / Active / Won / Lost.
 * Tracker also ships fixed status ids such as tracker:status:Todo.
 */
export function categoryFromHuly(input: { id?: string; categoryId?: string; name?: string }): StatusCategory {
  const haystack = `${input.categoryId ?? ""} ${input.id ?? ""} ${input.name ?? ""}`.toLowerCase();
  if (/cancel|lost|canceled|cancelled/.test(haystack)) return "canceled";
  if (/done|won|complete|完成|已完成/.test(haystack)) return "done";
  if (/progress|active|started|coding|review|进行/.test(haystack) && !/unstarted/.test(haystack)) {
    return "in-progress";
  }
  if (/backlog|unstarted|待办池|待处理/.test(haystack)) return "backlog";
  if (/todo|to-do|待办/.test(haystack)) return "todo";
  return "todo";
}

const ENGLISH_STATUS_NAMES: Record<string, string> = {
  done: "完成",
  canceled: "取消",
  cancelled: "取消",
  backlog: "待办池",
  todo: "待办",
  "to do": "待办",
  "in progress": "进行中",
  inprogress: "进行中",
};

/** Built-in English status names become Chinese. Custom names, including 待复核, stay as written. */
export function localizeStatusName(name: string): string {
  const key = name.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return ENGLISH_STATUS_NAMES[key] ?? name.trim();
}

export function statusColor(category: StatusCategory, explicit?: number | string): string {
  if (typeof explicit === "string" && explicit.startsWith("#")) return explicit;
  return CATEGORY_COLOR[category];
}

export type StatusVisualKind = "backlog" | "todo" | "in-progress" | "review" | "done" | "canceled";

export interface StatusVisual {
  kind: StatusVisualKind;
  color: string;
  bg: string;
  border: string;
  textColor: string;
}

const REVIEW_NAME_RE = /复核|审核|验收|评审|review|qa|test/i;

export function statusVisual(status?: Pick<Status, "name" | "category" | "color"> | null): StatusVisual {
  if (!status) {
    return {
      kind: "todo",
      color: "#64748b",
      bg: "#f4f6f8",
      border: "#e2e6ed",
      textColor: "#475569",
    };
  }
  if (status.category !== "done" && status.category !== "canceled" && REVIEW_NAME_RE.test(status.name)) {
    return {
      kind: "review",
      color: "#7048e8",
      bg: "#f5f2ff",
      border: "#ddd3ff",
      textColor: "#5b36d6",
    };
  }
  switch (status.category) {
    case "backlog":
      return {
        kind: "backlog",
        color: "#6b778c",
        bg: "#f4f5f7",
        border: "#dfe3e8",
        textColor: "#4a5568",
      };
    case "todo":
      return {
        kind: "todo",
        color: "#2563eb",
        bg: "#eef4ff",
        border: "#cfe0ff",
        textColor: "#1d4ed8",
      };
    case "in-progress":
      return {
        kind: "in-progress",
        color: "#d97706",
        bg: "#fff7e6",
        border: "#ffd996",
        textColor: "#b45309",
      };
    case "done":
      return {
        kind: "done",
        color: "#16a34a",
        bg: "#ecfdf3",
        border: "#bceac9",
        textColor: "#15803d",
      };
    case "canceled":
      return {
        kind: "canceled",
        color: "#71717a",
        bg: "#f4f4f5",
        border: "#e4e4e7",
        textColor: "#52525b",
      };
  }
}
