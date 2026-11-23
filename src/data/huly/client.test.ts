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

it("queries task and comment attachments and fetches bytes using the configured workspace storage", async () => {
  const findAll = vi.fn().mockResolvedValue([]);
  const client = new HulyDeskClient();
  const api = { findAll, getAccount: async () => ({ uuid: "account-id" }) };
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
    sorting: { Descending: -1 },
  };
  vi.spyOn(client as unknown as { plugins(): typeof plugins }, "plugins").mockReturnValue(plugins);
  await client.authenticate({ kind: "password", serverUrl: "https://desk.test", email: "user@example.test", password: "test" });
  await client.enterWorkspace("desk");

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
