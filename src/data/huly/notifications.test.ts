import { describe, expect, it, vi } from "vitest";
import { presentNotifications } from "./notifications";
import { encodeMarkdownToMarkup } from "./markup";

const options = {
  classes: {
    context: "notification:class:DocNotifyContext", activity: "activity:class:ActivityMessage",
    docUpdate: "activity:class:DocUpdateMessage", chat: "chunter:class:ChatMessage", thread: "chunter:class:ThreadMessage",
    issue: "tracker:class:Issue", project: "tracker:class:Project", issueStatus: "tracker:class:IssueStatus",
  },
  accountId: "account-1", people: [], resolveAuthor: (id?: string) => id === "author-1" ? "李华" : "成员",
};

describe("Huly inbox notifications", () => {
  it("resolves task information from context, comments, and direct task links", async () => {
    const { classes } = options;
    const findAll = vi.fn(async (classId: string, _query: Record<string, unknown>): Promise<unknown[]> => {
      if (classId === classes.context) return [{ _id: "ctx-1", objectId: "issue-227" }];
      if (classId === classes.activity) return [
        { _id: "comment-1", _class: classes.chat, attachedTo: "issue-227", createdBy: "author-1", message: encodeMarkdownToMarkup("之前的评论") },
        { _id: "status-update", _class: classes.docUpdate, attachedTo: "issue-227", action: "update", attributeUpdates: { attrKey: "status", set: ["status-1"] } },
      ];
      if (classId === classes.issue) return [{ _id: "issue-227", identifier: "5093-227", space: "proj", title: "Photoshop判题功能缺失" }];
      if (classId === classes.project) return [{ _id: "proj", name: "在线考试系统" }];
      if (classId === classes.issueStatus) return [{ _id: "status-1", name: "待复核" }];
      return [];
    });
    const client = { findAll: async <T,>(classId: string, query: Record<string, unknown>) => await findAll(classId, query) as T[] };
    const feed = await presentNotifications(client, [
      { _id: "n1", attachedTo: "comment-1", title: "notification:string:CommonNotificationTitle", body: "chunter:string:MessageNotificationBody" },
      { _id: "n2", objectId: "issue-227", attachedTo: "status-update", title: "tracker:string:IssueNotificationTitle", body: "tracker:string:IssueNotificationChanged" },
      { _id: "n3", docNotifyContext: "ctx-1", title: "notification:string:CommonNotificationTitle", body: "notification:string:CommonNotificationCollectionAdded", intlParamsNotLocalized: { collection: "tracker:string:Attachments" } },
      { _id: "n4", objectId: "deleted", title: "tracker:string:IssueNotificationTitle", intlParams: { issueTitle: "已删除的任务" }, body: "tracker:string:IssueNotificationChanged" },
    ], options);

    expect(findAll).toHaveBeenCalledWith(classes.context, { user: "account-1", _id: { $in: ["ctx-1"] } });
    expect(feed.slice(0, 3)).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({
      objectId: "issue-227", issueIdentifier: "5093-227", title: "Photoshop判题功能缺失", projectId: "proj", projectName: "在线考试系统",
    })));
    expect(feed.map((row) => row.body)).toEqual(["评论：之前的评论", "状态 设置为 待复核", "添加了附件", "更新了任务信息"]);
    expect(feed[0].senderName).toBe("李华");
    expect(feed[3]).toMatchObject({ title: "已删除的任务", projectId: undefined });
    expect(JSON.stringify(feed)).not.toContain(":string:");
  });
});
