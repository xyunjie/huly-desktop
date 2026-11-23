import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import IssueDescriptionEditor from "./IssueDescriptionEditor";

describe("IssueDescriptionEditor", () => {
  it.each(["", '{"type":"doc"}', '{"type":"doc","content":[]}', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]}'])("opens Huly's empty document %s for editing without a warning", async (markup) => {
    const onSave = vi.fn(async () => undefined);
    render(<IssueDescriptionEditor
      issueId="issue-1"
      markdown=""
      markup={markup}
      readOnly={false}
      people={[]}
      onSave={onSave}
      flushRef={{ current: null }}
    />);
    expect(await screen.findByRole("textbox", { name: "任务描述" })).toHaveAttribute("contenteditable", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves official nodes and attributes not represented by the local editor when saving", async () => {
    const onSave = vi.fn<(markup: string) => Promise<void>>().mockResolvedValue(undefined);
    const special = { type: "drawingBoard", attrs: { _id: "board-123" } };
    const markup = JSON.stringify({ type: "doc", content: [special, { type: "paragraph", attrs: { hulyFlag: "special" }, content: [{ type: "text", text: "旧文字" }] }] });
    render(<IssueDescriptionEditor issueId="issue-1" markdown="" markup={markup} readOnly={false} people={[]}
      onSave={onSave} flushRef={{ current: null }} />);
    const editor = await screen.findByRole("textbox", { name: "任务描述" });
    expect(within(editor).getByText("画板")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "插入表情" }));
    fireEvent.click(await screen.findByRole("button", { name: "插入 👍" }));
    fireEvent.keyDown(editor, { key: "s", metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(editor);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const [saved] = onSave.mock.lastCall!;
    expect(JSON.parse(saved).content).toContainEqual(special);
    expect(saved).toContain('"hulyFlag":"special"');
    expect(saved).not.toMatch(/hdOpaque|hdExtraAttrs/);
  });

  it("inserts an official message template and submits only on send", async () => {
    const onSubmit = vi.fn<(markup: string) => Promise<void>>().mockResolvedValue(undefined);
    const load = vi.fn(async () => [{ id: "tpl-1", title: "复核模板", body: "**检查通过**" }]);
    render(<IssueDescriptionEditor mode="comment" issueId="issue-1" markdown="" readOnly={false} people={[]}
      onLoadTemplates={load} onSubmit={onSubmit} />);
    const composer = await screen.findByRole("textbox", { name: "评论内容" });
    const send = screen.getByRole("button", { name: "发表评论" });
    expect(send).toBeDisabled();
    expect(screen.queryByRole("button", { name: "插入表格" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "插入模板" }));
    fireEvent.click(await screen.findByRole("button", { name: "复核模板" }));
    expect(within(composer).getByText("检查通过").tagName).toBe("STRONG");
    fireEvent.keyDown(composer, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(composer, { key: "Enter", metaKey: true });
    fireEvent.blur(composer);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeDisabled());
    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining("检查通过"), []);
  });

  it("queues a video from the picker and submits it with the comment", async () => {
    const file = new File(["video-data"], "演示.mp4", { type: "video/mp4" });
    const onSubmit = vi.fn(async (_markup: string, _files: File[]) => undefined);
    const { container } = render(<IssueDescriptionEditor mode="comment" issueId="issue-1" markdown="" readOnly={false}
      people={[]} onSubmit={onSubmit} />);
    const picker = container.querySelector<HTMLInputElement>('input[accept="video/*"]')!;
    const chooseFile = vi.spyOn(picker, "click");
    fireEvent.click(await screen.findByRole("button", { name: "上传视频" }));
    expect(chooseFile).toHaveBeenCalledOnce();
    fireEvent.change(picker, { target: { files: [file] } });
    expect(within(screen.getByRole("list", { name: "待发送文件" })).getByText("演示.mp4")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "发表评论" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.any(String), [file]));
  });

  it("queues the current clipboard file despite the same name, and keeps it after a failed send", async () => {
    const old = new File(["prior contents"], "image.png", { type: "image/png" });
    const current = new File(["current screenshot"], "image.png", { type: "image/png" });
    const onSubmit = vi.fn<(markup: string, files: File[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("暂时无法发送"))
      .mockResolvedValue(undefined);
    render(<IssueDescriptionEditor mode="comment" issueId="issue-1" markdown="" readOnly={false} people={[]} onSubmit={onSubmit} />);
    const composer = await screen.findByRole("textbox", { name: "评论内容" });
    fireEvent.paste(composer, { clipboardData: { files: [old], getData: () => "" } });
    fireEvent.click(screen.getByRole("button", { name: "移除 image.png" }));
    fireEvent.paste(composer, { clipboardData: {
      files: [old], items: [{ kind: "file", getAsFile: () => current }], getData: () => "",
    } });
    const send = screen.getByRole("button", { name: "发表评论" });
    expect(send).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(send); });
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法发送");
    expect(onSubmit.mock.calls[0][1][0]).toBe(current);
    expect(screen.getByRole("list", { name: "待发送文件" })).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "发表评论" });
    expect(retry).toBeEnabled();
    await act(async () => { fireEvent.click(retry); });
    expect(screen.queryByRole("list", { name: "待发送文件" })).not.toBeInTheDocument();
    expect(onSubmit.mock.calls[1][1][0]).toBe(current);
  });

  it("inserts a native table, mention and emoji from the footer and keeps a failed draft for retry", async () => {
    const onSave = vi.fn<(markup: string, previousMarkup?: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("暂时无法写入"))
      .mockResolvedValue(undefined);
    render(<IssueDescriptionEditor
      issueId="issue-1"
      markdown="正文内容"
      readOnly={false}
      people={[{ id: "person-1", name: "李华" }]}
      onSave={onSave}
      flushRef={{ current: null }}
    />);

    const description = await screen.findByRole("textbox", { name: "任务描述" });
    fireEvent.click(screen.getByRole("button", { name: "提及成员" }));
    fireEvent.click(await screen.findByRole("button", { name: "李华" }));
    expect(within(description).getByText("@李华")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "插入表情" }));
    fireEvent.click(await screen.findByRole("button", { name: "插入 👍" }));
    expect(within(description).getByText("👍")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "插入表格" }));
    fireEvent.click(await screen.findByRole("button", { name: "2 × 2" }));
    expect(within(description).getByRole("table")).toBeInTheDocument();

    fireEvent.blur(description);
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法写入");
    expect(within(description).getByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
    const [markup] = onSave.mock.lastCall!;
    expect(markup).toContain('"type":"table"');
    expect(markup).toContain('"type":"reference"');
    expect(markup).toContain('"type":"emoji"');
  });
});
