import { describe, expect, it } from "vitest";
import { filterIssues } from "@/domain/filters";
import { decodeMarkupToMarkdown, encodeMarkdownToMarkup, extractHulyFileId, formatDocUpdateBody } from "./markup";
import {
  attachLabels,
  descriptionIsRef,
  displayPersonName,
  mapIssue,
  mapProject,
  mapStatuses,
  matchCurrentPerson,
  nameInitial,
} from "./mapping";

describe("huly document mapping", () => {
  it("maps a project, its statuses and an issue", () => {
    const project = mapProject({
      _id: "proj",
      identifier: "CORE",
      name: "核心平台",
      defaultIssueStatus: "st-todo",
      $lookup: {
        type: {
          statuses: [
            { _id: "tracker:status:Backlog", name: "待办池" },
            { _id: "tracker:status:Todo", name: "待办" },
          ],
        },
      },
    });
    expect(project.identifier).toBe("CORE");
    const statuses = mapStatuses(
      {
        _id: "proj",
        $lookup: {
          type: {
            statuses: [
              { _id: "tracker:status:Backlog" },
              { _id: "tracker:status:Todo" },
            ],
          },
        },
      },
      [
        { _id: "tracker:status:Backlog", name: "待办池", category: "task:statusCategory:UnStarted" },
        { _id: "tracker:status:Todo", name: "待办", category: "task:statusCategory:ToDo" },
      ],
    );
    expect(statuses.map((status) => status.category)).toEqual(["backlog", "todo"]);

    const issue = mapIssue({
      _id: "issue-1",
      space: "proj",
      identifier: "CORE-128",
      title: "登录页在弱网下会重复提交",
      description: "65f0aaaaaaaaaaaaaaaaaaaa:65f0bbbbbbbbbbbbbbbbbbbb",
      status: "tracker:status:InProgress",
      priority: 2,
      assignee: "person-1",
      parents: [{ parentId: "parent-1", identifier: "CORE-1", parentTitle: "父任务" }],
      number: 128,
      rank: "0|hzzzzz:",
    });
    expect(issue.priority).toBe("high");
    expect(issue.parentIds).toEqual(["parent-1"]);
    expect(issue.description).toBe("");
    expect(issue.descriptionRef).toBe("65f0aaaaaaaaaaaaaaaaaaaa:65f0bbbbbbbbbbbbbbbbbbbb");
    expect(issue.projectId).toBe("proj");
  });

  it("attaches tag references and matches the signed-in person", () => {
    const [issue] = attachLabels(
      [mapIssue({ _id: "issue-1", space: "proj", title: "任务", status: "s", priority: 3 })],
      [{ _id: "ref-1", tag: "tag-1", attachedTo: "issue-1", title: "缺陷" }],
    );
    expect(issue?.labelIds).toEqual(["tag-1"]);
    expect(issue?.labelRefs).toEqual([{ labelId: "tag-1", referenceId: "ref-1" }]);
    const person = matchCurrentPerson(
      [
        { _id: "p1", name: "Zhang,Min", personUuid: "account-1" },
        { _id: "p2", name: "其他", email: "other@example.com" },
      ],
      "account-1",
      "bill@example.com",
    );
    expect(person?._id).toBe("p1");
  });

  it("keeps a real top-level issue whose attachedTo is NoParent", () => {
    const issue = mapIssue({
      _id: "6aa369e8aaaaaaaaaaaaaaaa",
      _class: "tracker:class:Issue",
      space: "6aa369e8bbbbbbbbbbbbbbbb",
      attachedTo: "tracker:ids:NoParent",
      attachedToClass: "tracker:class:Issue",
      status: "tracker:status:Done",
      kind: "tracker:taskTypes:Issue",
      rank: "0|100008:",
      identifier: "5093-1",
      title: "在线考试任务",
      parents: [],
      priority: 2,
      number: 1,
    } as never);
    expect(issue.parentIds).toEqual([]);
    expect(issue.identifier).toBe("5093-1");
    const visible = filterIssues([issue], {
      search: "",
      statusId: "all",
      assigneeId: "all",
      priority: "all",
      labelId: "all",
      groupBy: "status",
    });
    expect(visible).toHaveLength(1);
  });

  it("still reads a real parent from parents and ignores NoParent", () => {
    const issue = mapIssue({
      _id: "child",
      space: "proj",
      title: "子任务",
      status: "tracker:status:Todo",
      attachedTo: "tracker:ids:NoParent",
      parents: [
        { parentId: "tracker:ids:NoParent" },
        { parentId: "parent-1", identifier: "5093-1", parentTitle: "父任务" },
      ],
    });
    expect(issue.parentIds).toEqual(["parent-1"]);
  });

  it("localizes built-in English status names and keeps custom Chinese names", () => {
    const statuses = mapStatuses(
      {
        _id: "proj",
        $lookup: {
          type: {
            statuses: [
              { _id: "tracker:status:Done" },
              { _id: "st-cancel" },
              { _id: "st-start" },
              { _id: "st-review" },
              { _id: "st-doing" },
            ],
          },
        },
      },
      [
        { _id: "tracker:status:Done", name: "Done", category: "task:statusCategory:Won" },
        { _id: "st-cancel", name: "取消", category: "task:statusCategory:Lost" },
        { _id: "st-start", name: "待开始", category: "task:statusCategory:UnStarted" },
        { _id: "st-review", name: "待复核", category: "task:statusCategory:Active" },
        { _id: "st-doing", name: "进行中", category: "task:statusCategory:Active" },
      ],
    );
    expect(statuses.map((status) => status.name)).toEqual(["完成", "取消", "待开始", "待复核", "进行中"]);
    expect(statuses.map((status) => status.category)).toEqual(["done", "canceled", "backlog", "in-progress", "in-progress"]);
  });

  it("formats Huly Last,First names", () => {
    expect(displayPersonName(",admin")).toBe("admin");
    expect(displayPersonName("陈,文杰")).toBe("陈文杰");
    expect(displayPersonName("黄,强")).toBe("黄强");
    expect(displayPersonName("刘,博文")).toBe("刘博文");
    expect(displayPersonName("侯,琛")).toBe("侯琛");
    expect(displayPersonName("李,赟哲")).toBe("李赟哲");
    expect(displayPersonName("天一,曹")).toBe("天一曹");
    expect(displayPersonName("he,xiao")).toBe("xiao he");
    expect(displayPersonName("Wang,Xingqin")).toBe("Xingqin Wang");
    expect(nameInitial(displayPersonName("陈,文杰"))).toBe("陈");
    expect(nameInitial(displayPersonName("Wang,Xingqin"))).toBe("X");
    expect(nameInitial(displayPersonName(",admin"))).toBe("a");
  });

  it("treats a markup blob id as a description reference, not body text", () => {
    const blobId = "6aa369e8aaaaaaaa-description-6aa369e8bbbbbbbb";
    expect(descriptionIsRef(blobId)).toBe(true);
    expect(descriptionIsRef("用户在弱网点击「登录」后会重复提交。")).toBe(false);
    const issue = mapIssue({
      _id: "issue-1",
      space: "proj",
      title: "登录页在弱网下会重复提交",
      status: "tracker:status:Todo",
      description: blobId,
    });
    expect(issue.description).toBe("");
    expect(issue.descriptionRef).toBe(blobId);
  });

  it("decodes inline ProseMirror markup JSON for comments and formats activity updates", () => {
    const jsonMarkup = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "184 Photoshop CS6 实机通过" }] }],
    });
    expect(descriptionIsRef(jsonMarkup)).toBe(false);
    expect(decodeMarkupToMarkdown(jsonMarkup)).toContain("184 Photoshop CS6 实机通过");

    const encoded = encodeMarkdownToMarkup("已复核通过");
    expect(encoded.startsWith("{")).toBe(true);
    expect(decodeMarkupToMarkdown(encoded)).toContain("已复核通过");

    const statusUpdate = formatDocUpdateBody(
      {
        _id: "act-1",
        action: "update",
        attributeUpdates: { attrKey: "status", set: ["st-review"] },
      },
      {
        statuses: [{ id: "st-review", name: "待复核", category: "in-progress", color: "#7048e8" }],
        people: [],
      },
    );
    expect(statusUpdate).toBe("状态 设置为 待复核");
    expect(
      extractHulyFileId(
        "https://lm.all666.cn:666/files?workspace=ws-1&file=6aa369e8?file=6aa369e8",
        "https://lm.all666.cn:666",
      ),
    ).toBe("6aa369e8");
    expect(extractHulyFileId("https://huly-file.invalid/abc-123?width=400")).toBe("abc-123");
  });
});
