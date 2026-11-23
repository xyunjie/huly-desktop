import { Avatar, Card, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { nameInitial } from "@/data/huly/mapping";
import { filterIssues, isTopLevelIssue } from "@/domain/filters";
import { avatarColor, formatDue } from "@/domain/format";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/domain/priority";
import { statusVisual } from "@/domain/status";
import type { Issue, IssueFilters, Person, Status } from "@/domain/types";
import { StatusIcon } from "./StatusBadge";

export function IssueBoard({
  issues,
  statuses,
  people,
  filters,
  includeSubIssues,
  onSelect,
  onMove,
}: {
  issues: Issue[];
  statuses: Status[];
  people: Person[];
  filters: IssueFilters;
  includeSubIssues: boolean;
  onSelect: (id: string) => void;
  onMove: (issueId: string, statusId: string) => void;
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const pool = includeSubIssues ? issues : issues.filter(isTopLevelIssue);
  const visible = filterIssues(issues, { ...filters, statusId: "all" }, { includeSubIssues });
  const todayStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, []);

  if (pool.length === 0) {
    return <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#8c8c8c" }}>该项目还没有任务。</div>;
  }

  return (
    <div className="hd-board-wrap">
      {statuses.map((status) => {
        const cards = visible.filter((issue) => issue.statusId === status.id);
        const visual = statusVisual(status);
        const isDoneOrCanceled = status.category === "done" || status.category === "canceled";
        const isDragOver = dragOverId === status.id;

        return (
          <section
            key={status.id}
            className={isDragOver ? "hd-board-col hd-board-col-dragover" : "hd-board-col"}
            onDragOver={(event) => {
              event.preventDefault();
              if (dragOverId !== status.id) setDragOverId(status.id);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDragOverId((prev) => (prev === status.id ? null : prev));
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOverId(null);
              const issueId = event.dataTransfer.getData("text/issue-id");
              if (issueId) onMove(issueId, status.id);
            }}
            style={{
              borderTopColor: visual.color,
            }}
          >
            <header className="hd-board-col-head" style={{ background: visual.bg }}>
              <StatusIcon status={status} size={14} />
              <Typography.Text strong style={{ fontSize: 13, color: "#172b4d" }}>
                {status.name}
              </Typography.Text>
              <span
                className="hd-group-count"
                style={{
                  color: visual.textColor,
                  borderColor: visual.border,
                }}
              >
                {cards.length}
              </span>
            </header>

            <div className="hd-board-col-body">
              {cards.length === 0 ? (
                <div className="hd-board-empty">暂无任务</div>
              ) : (
                cards.map((issue) => {
                  const person = people.find((item) => item.id === issue.assigneeId);
                  const isOverdue = Boolean(issue.dueDate && issue.dueDate < todayStart && !isDoneOrCanceled);
                  return (
                    <Card
                      key={issue.id}
                      size="small"
                      hoverable
                      draggable
                      className="hd-board-card"
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/issue-id", issue.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => onSelect(issue.id)}
                      styles={{ body: { padding: 12 } }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {issue.identifier}
                        </Typography.Text>
                        {issue.dueDate ? (
                          <span
                            style={{
                              fontSize: 11,
                              color: isOverdue ? "#cf1322" : "#6b778c",
                              fontWeight: isOverdue ? 600 : 400,
                            }}
                          >
                            {formatDue(issue.dueDate)}
                          </span>
                        ) : null}
                      </div>
                      <div className="hd-board-card-title">{issue.title}</div>
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <Tag color={PRIORITY_COLOR[issue.priority]} style={{ marginInlineEnd: 0 }}>
                          {PRIORITY_LABEL[issue.priority]}
                        </Tag>
                        {person ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                            <Avatar size={20} style={{ background: avatarColor(person.id), fontSize: 10, flex: "none" }}>
                              {nameInitial(person.name)}
                            </Avatar>
                            <span style={{ fontSize: 12, color: "#42526e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 96 }}>
                              {person.name}
                            </span>
                          </span>
                        ) : (
                          <Avatar size={20} style={{ background: "#d9d9d9", fontSize: 10 }}>
                            ?
                          </Avatar>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
