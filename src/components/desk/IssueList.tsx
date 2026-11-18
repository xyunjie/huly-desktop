import { Avatar, Button, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { nameInitial } from "@/data/huly/mapping";
import { filterIssues, groupIssues, isTopLevelIssue } from "@/domain/filters";
import { avatarColor, formatDue } from "@/domain/format";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/domain/priority";
import { statusVisual } from "@/domain/status";
import type { Issue, IssueFilters, Label, Person, Priority, Status } from "@/domain/types";
import { StatusIcon, StatusQuickSelect } from "./StatusBadge";

const PAGE_SIZE = 20;

export function IssueList({
  issues,
  statuses,
  people,
  labels = [],
  filters,
  selectedId,
  includeSubIssues,
  onSelect,
  onMove,
}: {
  issues: Issue[];
  statuses: Status[];
  people: Person[];
  labels?: Label[];
  filters: IssueFilters;
  selectedId: string | null;
  includeSubIssues: boolean;
  onSelect: (id: string) => void;
  onMove?: (issueId: string, statusId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [shownByGroup, setShownByGroup] = useState<{ scope: string; counts: Record<string, number> }>({ scope: "", counts: {} });
  const pagingScope = JSON.stringify([
    filters.groupBy, filters.search.trim(), filters.statusId, filters.assigneeId, filters.priority, filters.labelId,
    filters.milestoneId, filters.dueFilter,
  ]);
  useEffect(() => setShownByGroup({ scope: pagingScope, counts: {} }), [pagingScope]);

  const pool = useMemo(
    () => (includeSubIssues ? issues : issues.filter(isTopLevelIssue)),
    [includeSubIssues, issues],
  );
  const visible = useMemo(
    () => filterIssues(issues, filters, { includeSubIssues }),
    [issues, filters, includeSubIssues],
  );
  const groups = useMemo(
    () => groupIssues(visible, filters.groupBy, statuses, people).map((group) => ({
      ...group,
      issues: [...group.issues].sort((a, b) => b.modifiedOn - a.modifiedOn || b.number - a.number),
    })),
    [visible, filters.groupBy, statuses, people],
  );

  const statusById = useMemo(() => new Map(statuses.map((item) => [item.id, item])), [statuses]);
  const personById = useMemo(() => new Map(people.map((item) => [item.id, item])), [people]);
  const labelById = useMemo(() => new Map(labels.map((item) => [item.id, item])), [labels]);
  const subCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of issues) {
      for (const parentId of item.parentIds) {
        counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [issues]);

  const todayStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, []);

  if (pool.length === 0) {
    return <EmptyHint text={includeSubIssues ? "没有指派给你的任务。" : "该项目还没有任务。"} />;
  }
  if (visible.length === 0) {
    return <EmptyHint text="没有符合筛选条件的任务。" />;
  }

  const showGroupHeaders = filters.groupBy !== "none" || groups.length > 1;

  return (
    <div className="hd-issue-pane hd-issue-list-scroll">
      <div className="hd-issue-grid-table">
        <div className="hd-issue-grid-head" role="row">
          <div>编号</div>
          <div>状态</div>
          <div>标题</div>
          <div>优先级</div>
          <div>指派人</div>
          <div>截止日期</div>
        </div>

        {groups.map((group) => {
          const collapseKey = `${filters.groupBy}:${group.id}`;
          const total = group.issues.length;
          const defaultCollapsed = total > PAGE_SIZE;
          const isCollapsed = showGroupHeaders && (collapsed[collapseKey] ?? defaultCollapsed);
          const shownCount = Math.min(total, (shownByGroup.scope === pagingScope ? shownByGroup.counts[group.id] : undefined) ?? PAGE_SIZE);
          const groupStatus = filters.groupBy === "status" ? statusById.get(group.id) : undefined;
          const groupPerson = filters.groupBy === "assignee" ? personById.get(group.id) : undefined;
          const groupPriority = filters.groupBy === "priority" ? (group.id as Priority) : undefined;
          const visual = groupStatus ? statusVisual(groupStatus) : null;

          const accentColor = visual
            ? visual.color
            : groupPriority
              ? PRIORITY_COLOR[groupPriority]
              : "#64748b";
          const headerBg = visual ? visual.bg : "#f7f8fa";
          const headerBorder = visual ? visual.border : "#e6e8ec";
          const badgeTextColor = visual ? visual.textColor : "#475569";

          return (
            <section key={group.id} className="hd-issue-group">
              {showGroupHeaders ? (
                <button
                  type="button"
                  className="hd-issue-group-header"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [collapseKey]: !(prev[collapseKey] ?? defaultCollapsed),
                    }))
                  }
                  style={{
                    background: headerBg,
                    borderColor: headerBorder,
                    borderLeftColor: accentColor,
                  }}
                >
                  <span className="hd-group-chevron" aria-hidden="true">
                    {isCollapsed ? "▸" : "▾"}
                  </span>

                  {filters.groupBy === "status" ? (
                    <StatusIcon status={groupStatus} size={15} />
                  ) : filters.groupBy === "assignee" ? (
                    <Avatar
                      size={18}
                      style={{
                        background: groupPerson ? avatarColor(groupPerson.id) : "#bfbfbf",
                        fontSize: 10,
                        flex: "none",
                      }}
                    >
                      {groupPerson ? nameInitial(groupPerson.name) : "?"}
                    </Avatar>
                  ) : filters.groupBy === "priority" && groupPriority ? (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: PRIORITY_COLOR[groupPriority],
                        flex: "none",
                      }}
                    />
                  ) : null}

                  <span className="hd-group-title">{group.title}</span>

                  <span
                    className="hd-group-count"
                    style={{
                      color: badgeTextColor,
                      borderColor: headerBorder,
                    }}
                  >
                    {total}
                  </span>

                  {isCollapsed ? (
                    <span className="hd-group-hint">已收起 · 点击展开</span>
                  ) : null}
                </button>
              ) : null}

              {isCollapsed ? null : (
                <div className="hd-issue-group-rows">
                  {group.issues.slice(0, shownCount).map((issue) => {
                    const status = statusById.get(issue.statusId);
                    const rowVisual = statusVisual(status);
                    const person = issue.assigneeId ? personById.get(issue.assigneeId) : undefined;
                    const issueLabels = issue.labelIds
                      .map((id) => labelById.get(id))
                      .filter((item): item is Label => Boolean(item));
                    const shownLabels = issueLabels.slice(0, 2);
                    const extraLabels = issueLabels.length - shownLabels.length;
                    const subCount = subCounts.get(issue.id) ?? 0;
                    const isSelected = issue.id === selectedId;
                    const isDoneOrCanceled = status?.category === "done" || status?.category === "canceled";
                    const isOverdue = Boolean(issue.dueDate && issue.dueDate < todayStart && !isDoneOrCanceled);

                    return (
                      <div
                        key={issue.id}
                        role="row"
                        tabIndex={0}
                        className={[
                          "hd-issue-row",
                          isSelected ? "hd-issue-row-selected" : "",
                          isDoneOrCanceled ? "hd-issue-row-muted" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={{
                          borderLeftColor: isSelected
                            ? "#1868db"
                            : rowVisual.kind === "in-progress"
                              ? rowVisual.color
                              : "transparent",
                        }}
                        onClick={() => onSelect(issue.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect(issue.id);
                          }
                        }}
                      >
                        <div className="hd-cell-id">{issue.identifier}</div>

                        <div className="hd-cell-status">
                          <StatusQuickSelect
                            status={status}
                            statuses={statuses}
                            onChange={onMove ? (nextStatusId) => onMove(issue.id, nextStatusId) : undefined}
                          />
                        </div>

                        <div className="hd-cell-title">
                          <span className="hd-issue-title-text" title={issue.title}>
                            {issue.title}
                          </span>
                          {subCount > 0 ? (
                            <span className="hd-subissue-badge" title={`${subCount} 个子任务`}>
                              ↳ {subCount}
                            </span>
                          ) : null}
                          {shownLabels.map((label) => (
                            <span
                              key={label.id}
                              className="hd-label-chip"
                              style={{
                                borderColor: `${label.color}40`,
                                background: `${label.color}14`,
                                color: label.color,
                              }}
                            >
                              <span
                                className="hd-label-dot"
                                style={{ background: label.color }}
                              />
                              {label.name}
                            </span>
                          ))}
                          {extraLabels > 0 ? (
                            <span className="hd-label-extra">+{extraLabels}</span>
                          ) : null}
                        </div>

                        <div className="hd-cell-priority">
                          <Tag color={PRIORITY_COLOR[issue.priority]} style={{ marginInlineEnd: 0 }}>
                            {PRIORITY_LABEL[issue.priority]}
                          </Tag>
                        </div>

                        <div className="hd-cell-assignee">
                          {person ? (
                            <span className="hd-assignee-wrap">
                              <Avatar
                                size={20}
                                style={{
                                  background: avatarColor(person.id),
                                  fontSize: 11,
                                  flex: "none",
                                }}
                              >
                                {nameInitial(person.name)}
                              </Avatar>
                              <span className="hd-assignee-name">{person.name}</span>
                            </span>
                          ) : (
                            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                              未指派
                            </Typography.Text>
                          )}
                        </div>

                        <div
                          className="hd-cell-due"
                          style={{
                            color: isOverdue ? "#cf1322" : undefined,
                            fontWeight: isOverdue ? 500 : undefined,
                          }}
                        >
                          {formatDue(issue.dueDate)}
                        </div>
                      </div>
                    );
                  })}
                  {shownCount < total ? (
                    <div className="hd-issue-group-more">
                      <Button type="text" size="small" onClick={() => {
                        setShownByGroup((previous) => {
                          const counts = previous.scope === pagingScope ? previous.counts : {};
                          return { scope: pagingScope, counts: { ...counts, [group.id]: (counts[group.id] ?? PAGE_SIZE) + PAGE_SIZE } };
                        });
                      }}>
                        显示更多 <span className="hd-issue-group-more-count">（{shownCount} / {total}）</span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#8c8c8c", minHeight: 240 }}>{text}</div>
  );
}
