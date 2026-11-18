import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockIssues, mockPeople, mockStatuses } from "@/data/mock/fixtures";
import { IssueDetail } from "./IssueDetail";

vi.mock("./IssueDescriptionEditor", () => ({
  default() {
    throw new RangeError("duplicate editor plugin");
  },
}));

describe("issue detail when an editor fails", () => {
  it("keeps the old description, timeline and the return button available", async () => {
    const issue = { ...mockIssues[0], description: "原有任务描述" };
    const onClose = vi.fn();
    const onUpdate = vi.fn(async () => undefined);
    render(<IssueDetail issue={issue} issues={[issue]} people={mockPeople} statuses={mockStatuses}
      labels={[]} milestones={[]} components={[]}
      comments={[{ id: "c1", issueId: issue.id, authorId: null, authorName: "测试", body: "原有评论", createdOn: 1 }]}
      commentWrite mock={false} descriptionLoading={false} onClose={onClose} onSelect={vi.fn()}
      onUpdate={onUpdate} onComment={vi.fn(async () => undefined)} />, { onCaughtError: () => undefined });

    expect(await screen.findByText(/描述编辑器未能加载/)).toBeInTheDocument();
    expect(await screen.findByText(/评论编辑器未能加载/)).toBeInTheDocument();
    expect(screen.getByText("原有任务描述")).toBeInTheDocument();
    expect(screen.getByText("原有评论")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("detail-back"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
