import { PRIORITY_LABEL, PRIORITY_ORDER } from "./priority";
import { categoryRank } from "./status";
import type { GroupBy, Issue, IssueFilters, Person, Priority, Status } from "./types";

export interface IssueGroup {
  id: string;
  title: string;
  issues: Issue[];
}

export function isTopLevelIssue(issue: Issue): boolean {
  return issue.parentIds.length === 0;
}

export function filterIssues(
  issues: Issue[],
  filters: IssueFilters,
  options?: { includeSubIssues?: boolean; now?: number },
): Issue[] {
  const search = filters.search.trim().toLowerCase();
  const milestoneFilter = filters.milestoneId ?? "all";
  const dueFilter = filters.dueFilter ?? "all";
  const nowDate = new Date(options?.now ?? Date.now());
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const weekEnd = todayStart + 7 * 24 * 60 * 60 * 1000;

  return issues.filter((issue) => {
    if (!options?.includeSubIssues && !isTopLevelIssue(issue)) return false;
    if (filters.statusId !== "all" && issue.statusId !== filters.statusId) return false;
    if (filters.assigneeId === "unassigned" && issue.assigneeId) return false;
    if (filters.assigneeId !== "all" && filters.assigneeId !== "unassigned" && issue.assigneeId !== filters.assigneeId) {
      return false;
    }
    if (filters.priority !== "all" && issue.priority !== filters.priority) return false;
    if (filters.labelId !== "all" && !issue.labelIds.includes(filters.labelId)) return false;
    if (milestoneFilter === "none" && issue.milestoneId) return false;
    if (milestoneFilter !== "all" && milestoneFilter !== "none" && issue.milestoneId !== milestoneFilter) return false;
    if (dueFilter === "no-due" && issue.dueDate !== null) return false;
    if (dueFilter === "overdue" && (issue.dueDate === null || issue.dueDate >= todayStart)) return false;
    if (dueFilter === "today" && (issue.dueDate === null || issue.dueDate < todayStart || issue.dueDate >= tomorrowStart)) {
      return false;
    }
    if (dueFilter === "week" && (issue.dueDate === null || issue.dueDate < todayStart || issue.dueDate >= weekEnd)) {
      return false;
    }
    if (!search) return true;
    return issue.title.toLowerCase().includes(search) || issue.identifier.toLowerCase().includes(search);
  });
}

export function hasActiveFilters(filters: IssueFilters): boolean {
  return Boolean(
    filters.search.trim() ||
      filters.statusId !== "all" ||
      filters.assigneeId !== "all" ||
      filters.priority !== "all" ||
      filters.labelId !== "all" ||
      (filters.milestoneId ?? "all") !== "all" ||
      (filters.dueFilter ?? "all") !== "all",
  );
}

export function groupIssues(
  issues: Issue[],
  groupBy: GroupBy,
  statuses: Status[],
  people: Person[],
): IssueGroup[] {
  if (groupBy === "none") {
    return [{ id: "all", title: "全部任务", issues: sortIssues(issues, statuses) }];
  }
  if (groupBy === "status") {
    const ordered = [...statuses].sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
    const groups = ordered.map((status) => ({
      id: status.id,
      title: status.name,
      issues: sortIssues(
        issues.filter((issue) => issue.statusId === status.id),
        statuses,
      ),
    }));
    const leftover = issues.filter((issue) => !statuses.some((status) => status.id === issue.statusId));
    if (leftover.length > 0) {
      groups.push({ id: "other", title: "其他", issues: leftover });
    }
    return groups.filter((group) => group.issues.length > 0);
  }
  if (groupBy === "priority") {
    return PRIORITY_ORDER.map((priority) => ({
      id: priority,
      title: PRIORITY_LABEL[priority],
      issues: issues.filter((issue) => issue.priority === priority),
    })).filter((group) => group.issues.length > 0);
  }
  const groups: IssueGroup[] = people.map((person) => ({
    id: person.id,
    title: person.name,
    issues: issues.filter((issue) => issue.assigneeId === person.id),
  }));
  const unassigned = issues.filter((issue) => !issue.assigneeId || !people.some((person) => person.id === issue.assigneeId));
  if (unassigned.length > 0) {
    groups.push({ id: "unassigned", title: "未指派", issues: unassigned });
  }
  return groups.filter((group) => group.issues.length > 0);
}

function sortIssues(issues: Issue[], statuses: Status[]): Issue[] {
  const rank = new Map(statuses.map((status, index) => [status.id, index]));
  return [...issues].sort((a, b) => {
    const statusDelta = (rank.get(a.statusId) ?? 99) - (rank.get(b.statusId) ?? 99);
    if (statusDelta !== 0) return statusDelta;
    if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
    return a.number - b.number;
  });
}

export function pickInitialIssue(issues: Issue[], statuses: Status[]): Issue | null {
  const top = issues.filter(isTopLevelIssue);
  const categoryOf = (issue: Issue) => statuses.find((status) => status.id === issue.statusId)?.category;
  return (
    top.find((issue) => categoryOf(issue) === "in-progress") ??
    top.find((issue) => categoryOf(issue) === "todo") ??
    top[0] ??
    null
  );
}

export function countByProject(issues: Issue[], projectId: string): number {
  return issues.filter((issue) => issue.projectId === projectId && isTopLevelIssue(issue)).length;
}

export function applyIssuePatch(issue: Issue, patch: Partial<Issue> & { labelIds?: string[] }): Issue {
  return {
    ...issue,
    ...patch,
    labelIds: patch.labelIds ?? issue.labelIds,
    modifiedOn: Date.now(),
  };
}

export function priorityChoices(): Priority[] {
  return PRIORITY_ORDER;
}
