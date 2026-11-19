import type { DeskClient } from "@/data/client";
import type { Issue } from "@/domain/types";

/**
 * Pure JSON-RPC dispatcher for the MCP Streamable HTTP endpoint.
 * The Rust side only forwards bodies; all tool logic lives here and
 * reuses the live DeskClient, so auth, token renewal and markup
 * conversion behave exactly like the UI.
 */

export const LATEST_PROTOCOL_VERSION = "2025-06-18";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "list_projects",
    description: "列出工作区内所有项目，包含项目 ID、编号、名称和任务统计。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_issues",
    description: "列出任务。可按项目（projectId 或项目编号如 5093）、状态名称、指派人姓名过滤，limit 默认 30。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID 或项目编号，如 5093。留空表示所有项目" },
        status: { type: "string", description: "状态名称，如「进行中」「待开始」" },
        assignee: { type: "string", description: "指派人姓名" },
        limit: { type: "integer", description: "最多返回条数，默认 30" },
      },
    },
  },
  {
    name: "get_issue",
    description: "按编号获取任务详情：标题、Markdown 描述、最近评论和元数据。",
    inputSchema: {
      type: "object",
      properties: { identifier: { type: "string", description: "任务编号，如 5093-174" } },
      required: ["identifier"],
    },
  },
  {
    name: "update_issue_status",
    description: "修改任务状态。status 用状态名称（如「进行中」）。解析失败时会返回该项目的合法状态列表。",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "任务编号，如 5093-174" },
        status: { type: "string", description: "目标状态名称" },
      },
      required: ["identifier", "status"],
    },
  },
  {
    name: "add_comment",
    description: "给任务添加一条 Markdown 评论。",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "任务编号，如 5093-174" },
        body: { type: "string", description: "评论内容，支持 Markdown" },
      },
      required: ["identifier", "body"],
    },
  },
];

function text(content: string): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return { content: [{ type: "text", text: content }] };
}

function formatPerson(issue: Issue, people: { id: string; name: string }[]): string {
  return issue.assigneeId ? people.find((p) => p.id === issue.assigneeId)?.name ?? issue.assigneeId : "未指派";
}

/** Collect issues across all projects (capped) plus the current project's metadata. */
async function collectIssues(client: DeskClient, projectHint: string | undefined, statuses: { id: string; name: string }[]) {
  const projects = await client.listProjects();
  const target = projectHint
    ? projects.find((p) => p.id === projectHint || p.identifier === projectHint)
    : undefined;
  if (projectHint && !target) throw new Error(`找不到项目 ${projectHint}。可用项目：${projects.map((p) => p.identifier).join("、")}`);
  const bundles = await Promise.all(
    (target ? [target] : projects).slice(0, 20).map(async (p) => ({ project: p, bundle: await client.loadProject(p.id) })),
  );
  const people = await client.listPeople();
  return { projects, target, bundles, people, statuses };
}

async function findIssue(client: DeskClient, identifier: string) {
  const { bundles } = await collectIssues(client, undefined, []);
  const key = identifier.toUpperCase();
  for (const { project, bundle } of bundles) {
    const issue = bundle.issues.find((i) => i.identifier.toUpperCase() === key);
    if (issue) return { issue, project, bundle };
  }
  throw new Error(`找不到任务 ${identifier}。`);
}

async function toolListIssues(client: DeskClient, args: Record<string, unknown>) {
  const { target, bundles, people } = await collectIssues(client, str(args.projectId), []);
  const statusName = str(args.status);
  const assignee = str(args.assignee);
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
  const rows: string[] = [];
  for (const { bundle } of target ? bundles.filter((b) => b.project.id === target.id) : bundles) {
    for (const issue of bundle.issues) {
      if (statusName && !bundle.statuses.some((s) => s.id === issue.statusId && s.name === statusName)) continue;
      const person = formatPerson(issue, people);
      if (assignee && person !== assignee) continue;
      const status = bundle.statuses.find((s) => s.id === issue.statusId)?.name ?? issue.statusId;
      rows.push(`${issue.identifier}　${status}　${issue.priority}　${person}　${issue.title}`);
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit) break;
  }
  if (!rows.length) return text("没有匹配的任务。");
  return text(rows.join("\n"));
}

async function toolGetIssue(client: DeskClient, args: Record<string, unknown>) {
  const identifier = str(args.identifier);
  if (!identifier) throw new Error("缺少 identifier。");
  const { issue, project, bundle } = await findIssue(client, identifier);
  const hydrated = await client.hydrateIssue(issue);
  const timeline = await client.loadIssueTimeline(issue).catch(() => null);
  const people = await client.listPeople();
  const status = bundle.statuses.find((s) => s.id === issue.statusId);
  const lines = [
    `${issue.identifier}　${issue.title}`,
    `项目：${project.name}（${project.identifier}）`,
    `状态：${status?.name ?? issue.statusId}　优先级：${issue.priority}　指派：${formatPerson(issue, people)}`,
    `描述：`,
    hydrated.description || "（空）",
  ];
  if (timeline) {
    const recent = [...timeline.comments].sort((a, b) => b.createdOn - a.createdOn).slice(0, 5);
    if (recent.length) {
      lines.push("最近评论：");
      for (const c of recent.reverse()) lines.push(`- ${c.authorName}：${c.body}`);
    }
  }
  return text(lines.join("\n"));
}

async function toolUpdateStatus(client: DeskClient, args: Record<string, unknown>) {
  const identifier = str(args.identifier);
  const statusName = str(args.status);
  if (!identifier || !statusName) throw new Error("缺少 identifier 或 status。");
  const { issue, bundle } = await findIssue(client, identifier);
  const match = bundle.statuses.find(
    (s) => s.name === statusName || s.name.toLowerCase() === statusName.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `项目里没有状态「${statusName}」。可用状态：${bundle.statuses.map((s) => s.name).join("、")}`,
    );
  }
  const updated = await client.updateIssue(issue.id, { statusId: match.id });
  return text(`已把 ${updated.identifier} 的状态改为「${match.name}」。`);
}

async function toolAddComment(client: DeskClient, args: Record<string, unknown>) {
  const identifier = str(args.identifier);
  const body = str(args.body);
  if (!identifier || !body.trim()) throw new Error("缺少 identifier 或 body。");
  const { issue } = await findIssue(client, identifier);
  await client.addComment(issue.id, body, "markdown");
  return text(`已在 ${issue.identifier} 添加评论。`);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const handlers: Record<string, (client: DeskClient, args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>> = {
  list_projects: async (client) => {
    const projects = await client.listProjects();
    if (!projects.length) return text("工作区没有项目。");
    return text(
      projects
        .map((p) => {
          const counts = p.issueCount !== undefined ? `　打开 ${p.openCount ?? 0} / 共 ${p.issueCount}` : "";
          return `${p.identifier}　${p.name}　projectId=${p.id}${counts}`;
        })
        .join("\n"),
    );
  },
  list_issues: toolListIssues,
  get_issue: toolGetIssue,
  update_issue_status: toolUpdateStatus,
  add_comment: toolAddComment,
};

export interface McpRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export function isMcpNotification(request: McpRequest): boolean {
  return request.id === undefined || request.id === null;
}

/**
 * Handle one JSON-RPC request. Returns the response object, or null for
 * notifications (which get no response per JSON-RPC 2.0).
 */
export async function dispatchMcp(
  request: McpRequest,
  client: DeskClient,
): Promise<McpResponse | null> {
  if (isMcpNotification(request)) return null;
  const reply = (result: unknown): McpResponse => ({ jsonrpc: "2.0", id: request.id as number | string, result });
  const fail = (code: number, message: string): McpResponse => ({ jsonrpc: "2.0", id: request.id as number | string, error: { code, message } });

  switch (request.method) {
    case "initialize": {
      const requested = (request.params?.protocolVersion as string) || LATEST_PROTOCOL_VERSION;
      const known = ["2025-06-18", "2025-03-26", "2024-11-05"];
      const version = known.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      return reply({
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: "huly-desk", version: "1.0.0" },
      });
    }
    case "notifications/initialized":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const name = (request.params?.name as string) || "";
      const args = (request.params?.arguments as Record<string, unknown>) || {};
      const handler = handlers[name];
      if (!handler) return fail(-32602, `未知工具：${name}`);
      try {
        return reply(await handler(client, args));
      } catch (reason) {
        return reply({
          content: [{ type: "text", text: reason instanceof Error ? reason.message : String(reason) }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, `未知方法：${request.method}`);
  }
}
