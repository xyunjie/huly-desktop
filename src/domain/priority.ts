import type { Priority } from "./types";

export const PRIORITY_ORDER: Priority[] = ["urgent", "high", "medium", "low", "none"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "无",
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  none: "#8a94a6",
  urgent: "#e03131",
  high: "#f08c00",
  medium: "#1c7ed6",
  low: "#7950f2",
};

/** Official `IssuePriority` numeric values in `@hcengineering/tracker` 0.7.423. */
export const HULY_PRIORITY: Record<Priority, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export function priorityFromHuly(value: unknown): Priority {
  const numeric = typeof value === "number" ? value : Number(value);
  switch (numeric) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "none";
  }
}
