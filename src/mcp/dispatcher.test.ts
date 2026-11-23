import { describe, expect, it, vi } from "vitest";
import { MockDeskClient } from "@/data/mock/client";
import { DEFAULT_SERVER_URL } from "@/domain/types";
import { dispatchMcp } from "./dispatcher";

async function openDesk() {
  const client = new MockDeskClient({ delayMs: 0 });
  await client.authenticate({ kind: "mock", serverUrl: DEFAULT_SERVER_URL });
  await client.enterWorkspace("company");
  return client;
}

function call(name: string, args: Record<string, unknown> = {}) {
  return openDesk().then((client) =>
    dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, client),
  );
}

function textOf(result: any): string {
  return result.content[0].text;
}

describe("MCP dispatcher", () => {
  it("lists the five tools without requiring a connected workspace", async () => {
    const res = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null);
    expect((res?.result as any).tools.map((t: any) => t.name)).toEqual([
      "list_projects",
      "list_issues",
      "get_issue",
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
