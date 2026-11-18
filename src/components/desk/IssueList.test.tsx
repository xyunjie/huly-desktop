import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FILTERS, type Issue, type Person, type Status } from "@/domain/types";
import { IssueList } from "./IssueList";

const statuses: Status[] = [
  { id: "st-todo", name: "待开始", category: "todo", color: "#1c7ed6" },
  { id: "st-doing", name: "进行中", category: "in-progress", color: "#f08c00" },
  { id: "st-review", name: "待复核", category: "todo", color: "#1c7ed6" },
];

const people: Person[] = [{ id: "p-1", name: "侯琛" }];

const issues: Issue[] = [
  {
    id: "i-1",
    projectId: "proj-1",
    identifier: "5093-174",
    number: 174,
    title: "在线考试系统Yaml有点问题",
    description: "",
    statusId: "st-todo",
    priority: "medium",
    assigneeId: "p-1",
    labelIds: [],
    milestoneId: null,
    componentId: null,
    dueDate: null,
    parentIds: [],
    rank: "a",
    modifiedOn: 0,
  },
  {
    id: "i-2",
    projectId: "proj-1",
    identifier: "5093-193",
    number: 193,
    title: "内网所有文件都会直接打加密tag",
    description: "",
    statusId: "st-doing",
    priority: "none",
    assigneeId: null,
    labelIds: [],
    milestoneId: null,
    componentId: null,
    dueDate: null,
    parentIds: [],
    rank: "b",
    modifiedOn: 0,
  },
];

describe("IssueList", () => {
  it("renders a single unified table header and collapsible status groups", () => {
    const onSelect = vi.fn();
    render(
      <IssueList
        issues={issues}
        statuses={statuses}
        people={people}
        filters={EMPTY_FILTERS}
        selectedId={null}
        includeSubIssues={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.getAllByText("编号")).toHaveLength(1);
    expect(screen.getAllByText("状态")).toHaveLength(1);
    expect(screen.getByText("在线考试系统Yaml有点问题")).toBeInTheDocument();
    expect(screen.getByText("内网所有文件都会直接打加密tag")).toBeInTheDocument();

    const todoHeader = screen.getByRole("button", { name: /待开始/ });
    expect(todoHeader).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(todoHeader);
    expect(todoHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("在线考试系统Yaml有点问题")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("内网所有文件都会直接打加密tag"));
    expect(onSelect).toHaveBeenCalledWith("i-2");
  });

  it("starts groups with more than 20 issues collapsed and shows 20 when expanded", () => {
    const makeIssues = (prefix: string, statusId: string, count: number) => Array.from({ length: count }, (_, index) => ({
      ...issues[0], id: `${prefix}-${index + 1}`, identifier: `${prefix}-${index + 1}`, number: index + 1,
      title: `${prefix}任务${index + 1}`, statusId, modifiedOn: index + 1,
    }));
    const many = [...makeIssues("A", "st-todo", 45), ...makeIssues("B", "st-doing", 20)];
    const onSelect = vi.fn();
    const renderList = (filters = EMPTY_FILTERS) => <IssueList issues={many} statuses={statuses} people={people}
      filters={filters} selectedId={null} includeSubIssues={false} onSelect={onSelect} />;
    const { rerender, container } = render(renderList());
    const rows = () => Array.from(container.querySelectorAll(".hd-issue-row .hd-cell-id"), (element) => element.textContent);
    const button = (shown: number, total: number) => screen.getByRole("button", { name: new RegExp(`显示更多.*${shown} / ${total}`) });

    const largeGroup = screen.getByRole("button", { name: /待开始.*45/ });
    expect(largeGroup).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /进行中.*20/ })).toHaveAttribute("aria-expanded", "true");
    expect(rows()).toHaveLength(20);
    expect(rows()[0]).toBe("B-20");
    expect(screen.queryByText("A-45")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /显示更多/ })).not.toBeInTheDocument();

    fireEvent.click(largeGroup);
    expect(largeGroup).toHaveAttribute("aria-expanded", "true");
    expect(rows()).toHaveLength(40);
    expect(rows()[0]).toBe("A-45");
    expect(rows()[19]).toBe("A-26");
    expect(rows()[20]).toBe("B-20");
    expect(screen.queryByText("A-25")).not.toBeInTheDocument();

    fireEvent.click(button(20, 45));
    expect(rows()).toHaveLength(60);
    expect(rows()[39]).toBe("A-6");
    expect(rows()[40]).toBe("B-20");
    fireEvent.click(button(40, 45));
    expect(screen.getByText("A-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /显示更多.*45/ })).not.toBeInTheDocument();

    rerender(renderList({ ...EMPTY_FILTERS, groupBy: "assignee" }));
    const assigneeGroup = screen.getByRole("button", { name: /侯琛.*65/ });
    expect(assigneeGroup).toHaveAttribute("aria-expanded", "false");
    expect(rows()).toHaveLength(0);
    fireEvent.click(assigneeGroup);
    expect(rows()).toHaveLength(20);
    expect(button(20, 65)).toBeInTheDocument();
    rerender(renderList({ ...EMPTY_FILTERS, search: "A-1", groupBy: "assignee" }));
    expect(screen.getByText("A-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /显示更多/ })).not.toBeInTheDocument();

    rerender(renderList({ ...EMPTY_FILTERS, groupBy: "none" }));
    expect(rows()).toHaveLength(20);
    expect(button(20, 65)).toBeInTheDocument();
  });
});
