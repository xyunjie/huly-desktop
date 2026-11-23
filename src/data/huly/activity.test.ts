import { describe, expect, it, vi } from "vitest";
import { loadActivityFeed } from "./activity";
import { encodeMarkdownToMarkup } from "./markup";

const classes = {
  ActivityMessage: "activity:class:ActivityMessage",
  DocUpdateMessage: "activity:class:DocUpdateMessage",
  ActivityReference: "activity:class:ActivityReference",
  ActivityInfoMessage: "activity:class:ActivityInfoMessage",
  ChatMessage: "chunter:class:ChatMessage",
  ThreadMessage: "chunter:class:ThreadMessage",
};
const issue = { id: "issue-1", projectId: "project-1", referenceCount: 1 };
const context = {
  descending: -1,
  statuses: [{ id: "s-review", name: "待复核", color: "#7463cc", category: "in-progress" as const }],
  people: [],
  resolveAuthor: (ref?: string) => ref === "author-1" ? "李华" : "成员",
};

describe("Huly activity feed", () => {
  it("loads the untruncated activity parent class and includes both chat and document changes", async () => {
    const rows = [
      { _id: "comment-1", _class: classes.ChatMessage, message: encodeMarkdownToMarkup("之前的评论"), createdBy: "author-1", createdOn: 70 },
      { _id: "comment-2", _class: classes.ChatMessage, attachments: 1, modifiedOn: 80 },
      { _id: "create-comment", _class: classes.DocUpdateMessage, action: "create", objectClass: classes.ChatMessage, objectId: "comment-1" },
      ...Array.from({ length: 110 }, (_, index) => ({
        _id: `update-${index}`, _class: classes.DocUpdateMessage, action: "update", createdOn: 100 + index,
        attributeUpdates: { attrKey: "status", set: ["s-review"] },
      })),
    ];
    const reference = { _id: "ref-1", _class: classes.ActivityReference };
    const findAll = vi.fn(async (classRef: string, _query: unknown, _options: unknown) => classRef === classes.ActivityMessage ? rows : [reference, reference]);
    const client = {
      findAll: async <T,>(classRef: string, query: unknown, options?: unknown) => (await findAll(classRef, query, options)) as T[],
      fetchMarkup: vi.fn(async () => ""),
    };

    const result = await loadActivityFeed(client, issue, classes, context);
    expect(findAll).toHaveBeenCalledWith(classes.ActivityMessage, { attachedTo: issue.id, space: issue.projectId }, { sort: { createdOn: -1 }, showArchived: true });
    expect(findAll).toHaveBeenCalledWith(classes.ActivityReference, { attachedTo: issue.id, space: { $ne: issue.projectId } }, { sort: { createdOn: -1 }, showArchived: true });
    expect(result.comments).toMatchObject([
      { authorName: "李华", body: "之前的评论" },
      { body: "（含 1 个附件）", createdOn: 80 },
    ]);
    expect(result.activity).toHaveLength(111);
    expect(result.activity[0].body).toBe("状态 设置为 待复核");
    expect(result.activity.at(-1)?.id).toBe("ref-1");
    expect(result.warning).toBeUndefined();
    expect(client.fetchMarkup).not.toHaveBeenCalled();
  });

  it("lets an unsuccessful timeline read reach the caller instead of returning zero records", async () => {
    const client = { findAll: async () => { throw new Error("network down"); }, fetchMarkup: vi.fn() };
    await expect(loadActivityFeed(client, issue, classes, context)).rejects.toThrow("network down");
  });

  it("shows a saved file-only comment with its own attachment", async () => {
    const file = { id: "attachment-1", issueId: "comment-1", fileId: "image-1", name: "image.png", type: "image/png", size: 42, lastModified: 0 };
    const findAll = vi.fn().mockResolvedValue([{ _id: "comment-1", _class: classes.ChatMessage, attachments: 1 }]);
    const readCommentAttachments = vi.fn().mockResolvedValue([file]);
    const result = await loadActivityFeed({ findAll, fetchMarkup: vi.fn() }, { ...issue, referenceCount: 0 }, classes,
      { ...context, readCommentAttachments });
    expect(readCommentAttachments).toHaveBeenCalledWith(["comment-1"]);
    expect(result.comments).toMatchObject([{ id: "comment-1", body: "", attachments: [file] }]);
  });

  it("keeps file nodes from referenced comments without loading historical snapshots", async () => {
    const markup = '{"type":"doc","content":[{"type":"file","attrs":{"file-id":"file-1"}}]}';
    const ref = "6afac43b3bdbbe14f03549b4";
    const findAll = vi.fn().mockResolvedValue([
      { _id: "comment-1", _class: classes.ChatMessage, message: ref },
      { _id: "update-1", _class: classes.DocUpdateMessage, action: "update", attributeUpdates: { attrKey: "description", set: ["snapshot-1"] } },
    ]);
    const fetchMarkup = vi.fn().mockResolvedValue(markup);
    const readDescriptionSnapshot = vi.fn();
    const result = await loadActivityFeed({ findAll, fetchMarkup }, issue, classes, { ...context, commentsOnly: true, readDescriptionSnapshot });

    expect(result.comments).toMatchObject([{ id: "comment-1", nativeMarkup: markup }]);
    expect(result.activity).toEqual([]);
    expect(findAll).toHaveBeenCalledOnce();
    expect(fetchMarkup).toHaveBeenCalledWith(classes.ChatMessage, "comment-1", "message", ref, "markup");
    expect(readDescriptionSnapshot).not.toHaveBeenCalled();
  });

  it("filters description changes with identical text before displaying the feed", async () => {
    const edit = (id: string, before: string | null | undefined, after: string | null) => ({
      _id: id, _class: classes.DocUpdateMessage, action: "update",
      attributeUpdates: { attrKey: "description", prevValue: before, set: [after] },
    });
    const client = {
      findAll: async <T,>(): Promise<T[]> => [
        edit("format-only", encodeMarkdownToMarkup("相同正文"), encodeMarkdownToMarkup("**相同正文**")),
        edit("empty-with-attachment", null, '{"type":"doc","content":[{"type":"image","attrs":{"file-id":"photo-1"}}]}'),
        edit("same-snapshot-text", "task-description-before", "task-description-after"),
        edit("actual-text", "task-description-after", encodeMarkdownToMarkup("修订正文")),
        edit("unavailable", "task-description-missing", null),
        edit("no-before-value", undefined, "task-description-needs-lazy-load"),
      ] as T[],
      fetchMarkup: vi.fn(async () => ""),
    };
    const readDescriptionSnapshot = vi.fn(async (ref: string) => {
      if (ref === "task-description-missing") return '{"error":"not found"}';
      return encodeMarkdownToMarkup(ref.endsWith("before") ? "历史正文" : "**历史正文**");
    });

    const result = await loadActivityFeed(client, { ...issue, referenceCount: 0 }, classes, { ...context, readDescriptionSnapshot });
    expect(result.activity.map((item) => item.id)).toEqual(["actual-text", "unavailable", "no-before-value"]);
    expect(result.activity[0].change).toMatchObject({ text: { before: "历史正文", after: "修订正文" } });
    expect(result.activity[1].change).toMatchObject({ text: { before: undefined, after: "" } });
    expect(readDescriptionSnapshot.mock.calls.filter(([ref]) => ref === "task-description-after")).toHaveLength(1);
    expect(readDescriptionSnapshot).not.toHaveBeenCalledWith("task-description-needs-lazy-load");
  });
});
