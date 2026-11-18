import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockIssues, mockStatuses } from "@/data/mock/fixtures";
import type { ActivityItem } from "@/domain/types";
import { IssueActivity } from "./IssueActivity";

const issue = mockIssues[0];
const item = (id: string, createdOn: number, change: ActivityItem["change"]): ActivityItem => ({
  id, createdOn, kind: "update", change, authorId: id, authorName: id, issueId: issue.id, body: "发生了修改",
});

describe("IssueActivity", () => {
  it("folds consecutive repeated statuses and starts another group after the status changes", () => {
    render(<IssueActivity issue={issue} people={[]} statuses={mockStatuses} comments={[]} loading={false} readOnly={false}
      activity={[
        item("甲", 1, { type: "status", statusId: "st-todo" }),
        item("乙", 2, { type: "status", statusId: "st-todo" }),
        item("丙", 3, { type: "status", statusId: "st-doing" }),
        item("丁", 4, { type: "status", statusId: "st-todo" }),
      ]} />);
    expect(screen.getByText("丁", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("丙", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("乙", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("甲", { selector: "strong" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 1 条重复记录" }));
    expect(screen.getByText("甲", { selector: "strong" })).toBeInTheDocument();
  });

  it("keeps a description preview collapsed and highlights changes using historical data only", async () => {
    const onReadSnapshot = vi.fn(async () => '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"修改后文字"}]}]}');
    render(<IssueActivity issue={issue} people={[]} statuses={[]} comments={[]} loading={false} readOnly={false}
      onReadSnapshot={onReadSnapshot}
      activity={[item("真实作者", 1, { type: "description", before: "修改前文字", after: "task-description-older" })]} />);
    expect(onReadSnapshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
    expect((await screen.findByText("前", { selector: "del" }))).toHaveAttribute("title", "删除的内容");
    expect(screen.getByText("后", { selector: "ins" })).toHaveAttribute("title", "新增的内容");
    expect(onReadSnapshot).toHaveBeenCalledWith("task-description-older");
    fireEvent.click(screen.getByRole("button", { name: "显示更少" }));
    expect(screen.queryByText("后", { selector: "ins" })).not.toBeInTheDocument();
  });

  it("never displays description entries that only changed formatting or attachments", async () => {
    const onReadSnapshot = vi.fn(async () => '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"相同正文"}]}]}');
    render(<IssueActivity issue={issue} people={[]} statuses={[]} comments={[]} loading={false} readOnly={false}
      onReadSnapshot={onReadSnapshot} activity={[
        item("只改样式", 1, { type: "description", before: "相同正文", after: '{"type":"doc","content":[{"type":"text","text":"相同正文","marks":[{"type":"bold"}]}]}' }),
        item("待查历史", 2, { type: "description", before: "相同正文", after: "task-description-old" }),
      ]} />);
    expect(screen.queryByText("只改样式")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示更多" }));
    await waitFor(() => expect(screen.queryByText("待查历史")).not.toBeInTheDocument());
    expect(screen.queryByText(/文字内容没有变化/)).not.toBeInTheDocument();
  });
});
