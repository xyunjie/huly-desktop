import { describe, expect, it, vi } from "vitest";
import { MockDeskClient } from "@/data/mock/client";
import { mockHar } from "@/data/mock/fixtures";
import { DEFAULT_SERVER_URL } from "@/domain/types";
import { dispatchMcp } from "./dispatcher";
import { MAX_FILE_BYTES } from "./issueFiles";

async function openDesk() {
  const client = new MockDeskClient({ delayMs: 0 });
  await client.authenticate({ kind: "mock", serverUrl: DEFAULT_SERVER_URL });
  await client.enterWorkspace("company");
  return client;
}

function call(name: string, args: Record<string, unknown> = {}, client?: MockDeskClient, isCurrent?: () => boolean) {
  return (client ? Promise.resolve(client) : openDesk()).then((desk) =>
    dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, desk, isCurrent),
  );
}

function textOf(result: any): string {
  return result.content[0].text;
}

describe("MCP dispatcher", () => {
  it("lists the tools without requiring a connected workspace", async () => {
    const res = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null);
    expect((res?.result as any).tools.map((t: any) => t.name)).toEqual([
      "list_projects",
      "list_issues",
      "get_issue",
      "list_issue_attachments",
      "get_issue_attachment",
      "update_issue_status",
      "add_comment",
    ]);
  });

  it("rejects unknown methods and tool names", async () => {
    const res = await dispatchMcp({ jsonrpc: "2.0", id: 2, method: "bogus" }, await openDesk());
    expect(res?.error?.code).toBe(-32601);
    expect((await call("constructor")).error?.code).toBe(-32602);
  });

  it("lists projects", async () => {
    const res = await call("list_projects");
    expect(textOf(res?.result)).toContain("CORE");
  });

  it("lists and filters issues by status name", async () => {
    const all = await call("list_issues", { projectId: "CORE" });
    expect(textOf(all?.result)).toMatch(/CORE-\d+/);
    const doing = await call("list_issues", { projectId: "CORE", status: "进行中" });
    expect(textOf(doing?.result)).toContain("进行中");
    expect(textOf(doing?.result)).not.toContain("待开始");
  });

  it("gets an issue with description and comments", async () => {
    const res = await call("get_issue", { identifier: "CORE-128" });
    const body = textOf(res?.result);
    expect(body).toContain("登录页在弱网下会重复提交");
    expect(body).toContain("描述");
    expect(body).toContain("get_issue_attachment");
  });

  it("lists Huly media in descriptions and comments and returns the original image bytes", async () => {
    const client = await openDesk();
    vi.spyOn(client, "hydrateIssue").mockImplementation(async (issue) => ({
      ...issue,
      description: "![ignored](https://third-party.test/files?file=remote)\n\n![duplicate](image://inline-image)",
      descriptionMarkup: JSON.stringify({ type: "doc", content: [
        { type: "image", attrs: { "file-id": "inline-image", alt: "原图.png" } },
      ] }),
    }));
    await client.addComment("i-128", "![另一张图](/files?file=comment-image&token=private-value)");
    await client.addComment("i-128", JSON.stringify({ type: "doc", content: [
      { type: "file", attrs: { "file-id": "comment-file", "data-file-name": "日志.txt" } },
    ] }), "markup");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aATEAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    const fetchFile = vi.spyOn(client, "fetchWorkspaceFile").mockImplementation(async () => new Response(bytes));

    const list = await call("list_issue_attachments", { identifier: "CORE-128" }, client);
    const listing = textOf(list.result);
    expect(listing).toContain("原图.png\tfileId=inline-image");
    expect(listing.match(/fileId=inline-image/g)).toHaveLength(1);
    expect(listing).toContain("fileId=blob-mock-1");
    expect(listing).toContain("fileId=comment-image");
    expect(listing).toContain("日志.txt\tfileId=comment-file");
    expect(listing).not.toMatch(/remote|private-value/);
    expect(fetchFile).not.toHaveBeenCalled();
    const detail = await call("get_issue", { identifier: "CORE-128" }, client);
    expect(textOf(detail.result)).not.toContain("private-value");

    const image = await call("get_issue_attachment", { identifier: "CORE-128", fileId: "inline-image" }, client);
    expect(image.result).toMatchObject({ content: [{ type: "text" }, { type: "image", mimeType: "image/png", data: png }] });
    expect(fetchFile).toHaveBeenCalledWith("inline-image", expect.any(AbortSignal));
  });

  it("returns an attachment as an embedded resource and rejects unassociated files or URLs", async () => {
    const client = await openDesk();
    const fetchFile = vi.spyOn(client, "fetchWorkspaceFile");
    for (const [identifier, fileId] of [["CORE-129", "blob-mock-1"], ["CORE-128", "https://example.test/files?file=blob-mock-1"]]) {
      const denied = await call("get_issue_attachment", { identifier, fileId }, client);
      expect(denied.result).toMatchObject({ isError: true });
    }
    expect(fetchFile).not.toHaveBeenCalled();

    const result = await call("get_issue_attachment", { identifier: "CORE-128", fileId: "blob-mock-1" }, client);
    expect(result.result).toMatchObject({ content: [{ type: "text" }, { type: "resource", resource: {
      uri: "huly-attachment://file/i-128/blob-mock-1", mimeType: "application/json", blob: btoa(mockHar),
    } }] });
  });

  it("rejects oversized streams even without Content-Length and cancels the response", async () => {
    const client = await openDesk();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_FILE_BYTES + 1)); }, cancel });
    vi.spyOn(client, "fetchWorkspaceFile").mockResolvedValue(new Response(body));
    const result = await call("get_issue_attachment", { identifier: "CORE-128", fileId: "blob-mock-1" }, client);
    expect(result.result).toMatchObject({ isError: true });
    expect(textOf(result.result)).toContain("5 MiB");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("discards bytes if the workspace changes during the download", async () => {
    const client = await openDesk();
    let active = true;
    vi.spyOn(client, "fetchWorkspaceFile").mockImplementation(async () => {
      active = false;
      return new Response("private workspace file");
    });
    const result = await call("get_issue_attachment", { identifier: "CORE-128", fileId: "blob-mock-1" }, client, () => active);
    expect(result.result).toMatchObject({ isError: true });
    expect(textOf(result.result)).toContain("工作区已切换");
    expect(JSON.stringify(result.result)).not.toContain("private workspace file");
  });

  it("looks up an issue directly even when it isn't in its project's loaded list", async () => {
    const client = await openDesk();
    const projectLoader = client.loadProject.bind(client);
    const load = vi.spyOn(client, "loadProject").mockImplementation(async (id) => ({ ...(await projectLoader(id)), issues: [] }));
    const find = vi.spyOn(client, "findIssueByIdentifier");
    const res = await dispatchMcp(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_issue", arguments: { identifier: "core-128" } } },
      client,
    );
    expect(textOf(res.result)).toContain("CORE-128");
    expect(find).toHaveBeenCalledWith("core-128");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("discloses capped or limited lists", async () => {
    const res = await call("list_issues", { projectId: "CORE", limit: 1 });
    expect(textOf(res.result)).toContain("结果可能不完整");
    const invalid = await call("list_issues", { limit: 1.5 });
    expect(invalid.result).toMatchObject({ isError: true });
  });

  it("updates status by name and reports available statuses on mismatch", async () => {
    const client = await openDesk();
    const ok = await dispatchMcp(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_issue_status", arguments: { identifier: "CORE-129", status: "进行中" } } },
      client,
    );
    expect(textOf(ok?.result)).toContain("CORE-129");
    const miss = await dispatchMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "update_issue_status", arguments: { identifier: "CORE-129", status: "不存在状态" } } },
      client,
    );
    const payload: any = miss?.result;
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toContain("可用状态");
  });

  it("adds a comment", async () => {
    const client = await openDesk();
    await dispatchMcp(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_comment", arguments: { identifier: "CORE-128", body: "MCP 写入的评论" } } },
      client,
    );
    const detail = await dispatchMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_issue", arguments: { identifier: "CORE-128" } } },
      client,
    );
    expect(textOf(detail?.result)).toContain("MCP 写入的评论");
  });

  it("wraps tool errors as isError results instead of JSON-RPC errors", async () => {
    const res = await call("get_issue", { identifier: "ZZZ-999" });
    const payload: any = res?.result;
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toContain("找不到任务");
  });

  it("does not write when the user switches workspace during issue lookup", async () => {
    const client = await openDesk();
    const find = client.findIssueByIdentifier.bind(client);
    let active = true;
    vi.spyOn(client, "findIssueByIdentifier").mockImplementation(async (id) => {
      active = false;
      return find(id);
    });
    const write = vi.spyOn(client, "addComment");
    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_comment", arguments: { identifier: "CORE-128", body: "不应该写入" } } } as const;
    const noWorkspace = await dispatchMcp(request, null);
    expect(textOf(noWorkspace.result)).toContain("连接工作区");
    const res = await dispatchMcp(request, client, () => active);
    expect(res.result).toMatchObject({ isError: true });
    expect(write).not.toHaveBeenCalled();
  });
});
