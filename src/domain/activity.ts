import type { ActivityItem } from "./types";

export function groupActivity(items: ActivityItem[]): ActivityItem[][] {
  const groups: ActivityItem[][] = [];
  const sorted = [...items].sort((a, b) => a.createdOn - b.createdOn);
  for (const item of sorted) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous && canGroup(previous, item)) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

function canGroup(a: ActivityItem, b: ActivityItem): boolean {
  if (a.kind !== "update" || b.kind !== "update") return false;
  if (a.change?.type === "status" && b.change?.type === "status") return a.change.statusId === b.change.statusId;
  if (b.createdOn - a.createdOn > 5 * 60_000) return false;
  if (a.change?.type === "description" && b.change?.type === "description") return true;
  return a.change?.type !== "created" && b.change?.type !== "created" && a.body === b.body;
}

export function activityTextDiff(before: string, after: string) {
  const left = Array.from(before);
  const right = Array.from(after);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let end = 0;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end += 1;
  return {
    prefix: right.slice(0, start).join(""),
    removed: left.slice(start, left.length - end).join(""),
    added: right.slice(start, right.length - end).join(""),
    suffix: right.slice(right.length - end).join(""),
  };
}
