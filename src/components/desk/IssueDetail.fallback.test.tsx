import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    const issue = { ...mockIssues[0], description: "原有任务描述\n\n![旧截图](https://huly-file.invalid/old-image)" };
    const onClose = vi.fn();
    const onUpdate = vi.fn(async () => undefined);
    render(<IssueDetail issue={issue} issues={[issue]} people={mockPeople} statuses={mockStatuses}
      labels={[]} milestones={[]} components={[]}
      comments={[{ id: "c1", issueId: issue.id, authorId: null, authorName: "测试", body: "原有评论", createdOn: 1 }]}
      commentWrite mock={false} descriptionLoading={false} onClose={onClose} onSelect={vi.fn()}
      onUpdate={onUpdate} onComment={vi.fn(async () => undefined)} onResolveImage={async () => "blob:old-image"} />,
    { onCaughtError: () => undefined });

    expect(await screen.findByText(/描述编辑器未能加载/)).toBeInTheDocument();
    expect(await screen.findByText(/评论编辑器未能加载/)).toBeInTheDocument();
    expect(screen.getByText("原有任务描述")).toBeInTheDocument();
    expect(screen.getByText("原有评论")).toBeInTheDocument();
    const image = screen.getByLabelText("预览 旧截图");
    await waitFor(() => expect(image).toHaveAttribute("src", "blob:old-image"));
    fireEvent.keyDown(image, { key: "Enter" });
    const imageViewer = await screen.findByRole("dialog", { name: "旧截图" });
    expect(within(imageViewer).getByAltText("旧截图")).toHaveAttribute("src", "blob:old-image");
    fireEvent.click(within(imageViewer).getByLabelText("关闭预览"));
    fireEvent.click(screen.getByTestId("detail-back"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
