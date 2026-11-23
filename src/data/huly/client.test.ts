import { describe, expect, it, vi } from "vitest";
import { HulyDeskClient } from "./client";

describe("Huly assigned tasks", () => {
  it("loads all assigned tasks and resolves status names without loading a project", async () => {
    const status = "6afac43b3bdbbe14f03549b4";
    const findAll = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 201 }, (_, index) => ({
        _id: `issue-${index}`, space: index % 2 ? "proj-1" : "proj-2", status, assignee: "me",
      })))
      .mockResolvedValueOnce([{ _id: status, name: "待复核", category: "task:statusCategory:Active" }]);
    const client = new HulyDeskClient();
    vi.spyOn(client as unknown as { api(): { findAll: typeof findAll } }, "api").mockReturnValue({ findAll });

    const result = await client.listAssigned("me");

    expect(result.issues).toHaveLength(201);
    expect(result.statuses).toMatchObject([{ id: status, name: "待复核", category: "in-progress" }]);
    expect(findAll).toHaveBeenNthCalledWith(1, "tracker:class:Issue", { assignee: "me" }, { sort: { modifiedOn: -1 } });
    expect(findAll).toHaveBeenNthCalledWith(2, "tracker:class:IssueStatus", { _id: { $in: [status] } });
  });
});

async function openFakeHuly() {
  const findAll = vi.fn().mockResolvedValue([]);
  const client = new HulyDeskClient();
  const api = {
    findAll, getAccount: async () => ({ uuid: "account-id" }),
    findOne: vi.fn(async (classRef: string) => classRef === "tracker:class:Issue" ? { _id: "issue-id", space: "project-id" } : undefined),
    addCollection: vi.fn().mockResolvedValue(undefined),
    removeCollection: vi.fn().mockResolvedValue(undefined),
  };
  let nextId = 0;
  const plugins = {
    loadServerConfig: async () => ({
      ACCOUNTS_URL: "https://accounts.test", COLLABORATOR_URL: "https://collaborator.test",
      FILES_URL: "https://storage.test/files/:workspace/:blobId",
    }),
    getAccountClient: () => ({
      login: async () => ({ token: "account-token" }),
      getPerson: async () => null,
      getUserWorkspaces: async () => [{ uuid: "workspace-id", url: "desk" }],
      selectWorkspace: async () => ({ endpoint: "https://transactor.test", token: "workspace-token" }),
    }),
    connect: async () => api,
    contact: { class: { Person: "person" } },
    tracker: { class: { Issue: "tracker:class:Issue" } },
    generateId: () => `id-${++nextId}`,
    sorting: { Descending: -1 },
  };
  vi.spyOn(client as unknown as { plugins(): typeof plugins }, "plugins").mockReturnValue(plugins);
  await client.authenticate({ kind: "password", serverUrl: "https://desk.test", email: "user@example.test", password: "test" });
  await client.enterWorkspace("desk");
  return { client, api };
}

it("queries task and comment attachments and fetches bytes using the configured workspace storage", async () => {
  const { client, api: { findAll } } = await openFakeHuly();

  findAll.mockResolvedValueOnce([{ _id: "attachment-id", file: "blob:id", attachedTo: "comment-id" }]);
  expect(await client.listAttachments("issue-id", { commentIds: ["comment-id"], fileId: "blob:id" })).toMatchObject([{ fileId: "blob:id" }]);
  expect(findAll).toHaveBeenLastCalledWith("attachment:class:Attachment", {
    attachedTo: { $in: ["issue-id", "comment-id"] }, file: "blob:id",
  }, { limit: 100, sort: { lastModified: -1 } });

  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("file contents"));
  try {
    const signal = new AbortController().signal;
    await expect(client.fetchWorkspaceFile("https://other.test/file", signal)).rejects.toThrow("ID 无效");
    expect(fetch).not.toHaveBeenCalled();
    const file = await client.fetchWorkspaceFile("blob:id", signal);
    expect(await file.text()).toBe("file contents");
    expect(fetch).toHaveBeenCalledWith("https://storage.test/files/workspace-id/blob%3Aid", {
      headers: { Authorization: "Bearer workspace-token" }, credentials: "omit", redirect: "error", signal,
    });
  } finally {
    fetch.mockRestore();
  }
});

it("uses unique storage IDs for same-named images and registers only explicit task uploads on the task", async () => {
  const { client, api } = await openFakeHuly();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
    const file = (options?.body as FormData).get("file") as File;
    return Response.json([{ id: file.name }]);
  });
  try {
    const old = new File(["old"], "image.png", { type: "image/png" });
    const current = new File(["current"], "image.png", { type: "image/png" });
    const inline = await client.uploadInlineFile("issue-id", old);
    expect(api.addCollection).not.toHaveBeenCalled();
    const comment = await client.addComment("issue-id", "", "markdown", [current]);
    const taskAttachment = await client.uploadAttachment("issue-id", current);
    expect(new Set([inline.fileId, comment.attachments?.[0].fileId, taskAttachment.fileId]).size).toBe(3);
    expect(inline.name).toBe("image.png");
    expect(api.addCollection.mock.calls).toEqual([
      ["attachment:class:Attachment", "project-id", comment.id, "chunter:class:ChatMessage", "attachments",
        expect.objectContaining({ file: comment.attachments?.[0].fileId, name: "image.png", size: current.size }), expect.any(String)],
      ["chunter:class:ChatMessage", "project-id", "issue-id", "tracker:class:Issue", "comments",
        expect.objectContaining({ attachments: 1 }), comment.id],
      ["attachment:class:Attachment", "project-id", "issue-id", "tracker:class:Issue", "attachments",
        expect.objectContaining({ file: taskAttachment.fileId, name: "image.png" }), taskAttachment.id],
    ]);
  } finally {
    fetch.mockRestore();
  }
});

it("cleans up only comment attachment records when a send fails and no comment was created", async () => {
  const { client, api } = await openFakeHuly();
  api.addCollection.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("send failed"));
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([{ id: "image-id" }]));
  try {
    const file = new File(["image"], "image.png", { type: "image/png" });
    await expect(client.addComment("issue-id", "", "markdown", [file])).rejects.toThrow("send failed");
    const [, space, commentId, commentClass, collection, , attachmentId] = api.addCollection.mock.calls[0];
    expect(api.removeCollection).toHaveBeenCalledExactlyOnceWith("attachment:class:Attachment", space, attachmentId, commentId, commentClass, collection);
  } finally {
    fetch.mockRestore();
  }
});
