import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Issue, IssuePatch, Person, Project, Status } from "@/domain/types";
import { IssueDetail } from "./IssueDetail";

const project: Project = {
  id: "proj-1",
  identifier: "5093",
  name: "5093-在线考试系统",
};

const statuses: Status[] = [
  { id: "st-todo", name: "待开始", category: "todo", color: "#1c7ed6" },
  { id: "st-doing", name: "进行中", category: "in-progress", color: "#f08c00" },
];

const people: Person[] = [{ id: "p-1", name: "侯琛" }];

const parentIssue: Issue = {
  id: "i-parent",
  projectId: "proj-1",
  identifier: "5093-174",
  number: 174,
  title: "在线考试系统Yaml有点问题",
  description: "同步过来只有 9 个用户。",
  statusId: "st-doing",
  priority: "high",
  assigneeId: "p-1",
  labelIds: [],
  milestoneId: null,
  componentId: null,
  dueDate: null,
  parentIds: [],
  rank: "a",
  modifiedOn: 0,
};

const childIssue: Issue = {
  ...parentIssue,
  id: "i-child",
  identifier: "5093-175",
  number: 175,
  title: "排查 CAS 同步脚本",
  description: "",
  statusId: "st-todo",
  parentIds: ["i-parent"],
};

describe("IssueDetail", () => {
  it("renders standalone Huly-style page with breadcrumb, inspector, and back navigation", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <IssueDetail
        issue={parentIssue}
        project={project}
        backLabel="返回任务列表"
        issues={[parentIssue, childIssue]}
        statuses={statuses}
        people={people}
        labels={[]}
        milestones={[]}
        components={[]}
        comments={[]}
        commentWrite={false}
        mock={false}
        descriptionLoading={false}
        onClose={onClose}
        onSelect={onSelect}
        onUpdate={vi.fn(async () => undefined)}
        onComment={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByTestId("issue-detail-page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5093-在线考试系统" })).toBeInTheDocument();
    expect(screen.getByLabelText("任务属性")).toBeInTheDocument();
    expect(screen.getByText("排查 CAS 同步脚本")).toBeInTheDocument();
    expect(screen.queryByText("关联与阻塞")).not.toBeInTheDocument();
    expect(screen.queryByText("工时上报")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("排查 CAS 同步脚本"));
    expect(onSelect).toHaveBeenCalledWith("i-child");

    fireEvent.click(screen.getByTestId("detail-back"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows both comments and updates, and does not label a failed fetch as an empty timeline", () => {
    const onRefreshActivity = vi.fn();
    const renderDetail = (activityError?: string) => (
      <IssueDetail
        issue={parentIssue} issues={[parentIssue]} statuses={statuses} people={people}
        labels={[]} milestones={[]} components={[]}
        comments={activityError ? [] : [{ id: "c-1", issueId: parentIssue.id, authorId: "p-1", authorName: "侯琛", body: "这是先前的评论", createdOn: 10 }]}
        activity={activityError ? [] : [{ id: "a-1", issueId: parentIssue.id, kind: "update", authorId: "p-1", authorName: "侯琛", body: "状态 设置为 进行中", createdOn: 20 }]}
        activityError={activityError} onRefreshActivity={onRefreshActivity} commentWrite={false}
        mock={false} descriptionLoading={false} onClose={vi.fn()} onSelect={vi.fn()}
        onUpdate={vi.fn(async () => undefined)} onComment={vi.fn(async () => undefined)}
      />
    );
    const { rerender } = render(renderDetail());
    const feed = within(screen.getByRole("region", { name: "活动" }));
    expect(feed.getByText("这是先前的评论")).toBeInTheDocument();
    expect(feed.getByText("状态 设置为 进行中")).toBeInTheDocument();
    rerender(renderDetail("活动加载失败，请重试。"));
    expect(feed.getByRole("alert")).toHaveTextContent("活动加载失败");
    expect(feed.queryByText("还没有活动或评论记录。")).not.toBeInTheDocument();
    fireEvent.click(feed.getByRole("button", { name: "重试加载" }));
    expect(onRefreshActivity).toHaveBeenCalledOnce();
  });

  it("loads the native description again after Strict Mode reinitializes the editor", async () => {
    const onUpdate = vi.fn<(patch: IssuePatch) => Promise<void>>().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const markup = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "原文" },
      { type: "image", attrs: { "file-id": "image-1", alt: "录屏截图", width: 1440 } },
    ] }] });
    const onResolveImage = vi.fn(async () => "blob:preview-only");
    render(
      <StrictMode>
        <IssueDetail
          issue={{ ...parentIssue, descriptionMarkup: markup }}
          project={project}
          issues={[parentIssue, childIssue]}
          statuses={statuses}
          people={people}
          labels={[]}
          milestones={[]}
          components={[]}
          comments={[]}
          commentWrite={false}
          mock
          descriptionLoading={false}
          onClose={onClose}
          onSelect={vi.fn()}
          onUpdate={onUpdate}
          onComment={vi.fn(async () => undefined)}
          onResolveImage={onResolveImage}
        />
      </StrictMode>,
    );

    const editor = await screen.findByRole("textbox", { name: "任务描述" });
    expect(await within(editor).findByRole("img", { name: "录屏截图" })).toHaveAttribute("src", "blob:preview-only");
    expect(editor).toHaveTextContent("原文");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(editor).not.toHaveTextContent("blob:preview-only");
    fireEvent.paste(editor, {
      clipboardData: { files: [], getData: (type: string) => type === "text/plain" ? "新增正文" : "" },
    });
    fireEvent.click(screen.getByTestId("detail-back"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onUpdate).toHaveBeenCalledWith({ descriptionMarkup: expect.any(String), previousDescriptionMarkup: markup });
    const [{ descriptionMarkup: saved }] = onUpdate.mock.calls[0];
    expect(saved).toContain("新增正文");
    expect(saved).toContain('"file-id":"image-1"');
    expect(saved).toContain('"width":1440');
    expect(saved).not.toContain("blob:preview-only");
  });
});
