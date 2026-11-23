import { PROJECT_ISSUE_LIMIT, type DeskClient } from "@/data/client";
import { safeErrorMessage } from "@/domain/secrets";
import type { Issue } from "@/domain/types";

/**
 * MCP tool catalog and calls. Rust handles the HTTP handshake and forwards
 * tool requests here so they can reuse the live DeskClient.
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations?: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "list_projects",
    description: "列出工作区内所有项目，包含项目 ID、编号、名称和任务统计。",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_issues",
    description: "列出任务。可按项目（projectId 或项目编号如 5093）、状态名称、指派人姓名过滤，limit 默认 30，最大 100。结果截断时会提示。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID 或项目编号，如 5093。留空表示所有项目" },
        status: { type: "string", description: "状态名称，如「进行中」「待开始」" },
        assignee: { type: "string", description: "指派人姓名" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "最多返回条数，默认 30" },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_issue",
    description: "按编号获取任务详情：标题、Markdown 描述、最近评论和元数据。",
    inputSchema: {
      type: "object",
      properties: { identifier: { type: "string", description: "任务编号，如 5093-174" } },
      required: ["identifier"],
    },
    annotations: { readOnlyHint: true },
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
    annotations: { readOnlyHint: false, idempotentHint: true },
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
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

function text(content: string): { content: { type: "text"; text: string }[]; isError?: boolean } {
  return { content: [{ type: "text", text: content }] };
}

function formatPerson(issue: Issue, people: { id: string; name: string }[]): string {
  return issue.assigneeId ? people.find((p) => p.id === issue.assigneeId)?.name ?? issue.assigneeId : "未指派";
}

async function findIssue(client: DeskClient, identifier: string) {
  const issue = await client.findIssueByIdentifier(identifier);
  if (!issue) throw new Error(`找不到任务 ${identifier}。`);
  return issue;
}

async function toolListIssues(client: DeskClient, args: Record<string, unknown>) {
  for (const key of ["projectId", "status", "assignee"]) {
    if (args[key] !== undefined && typeof args[key] !== "string") throw new Error(`${key} 必须是文本。`);
  }
  const projectHint = str(args.projectId);
  const statusName = str(args.status).toLowerCase();
  const assignee = str(args.assignee).toLowerCase();
  const limit = args.limit === undefined ? 30 : args.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit 必须是 1–100 之间的整数。");
  }
  const [projects, people] = await Promise.all([client.listProjects(), client.listPeople()]);
  const matching = projectHint
    ? projects.filter((p) => p.id === projectHint || p.identifier.toLowerCase() === projectHint.toLowerCase())
    : projects;
  if (projectHint && !matching.length) throw new Error(`找不到项目 ${projectHint}。`);
  // shortcut: bound cross-project MCP scans; use paged Huly queries when complete workspace lists are needed.
  const maxProjects = 20;
  let truncated = matching.length > maxProjects;
  const rows: string[] = [];
  for (const project of matching.slice(0, maxProjects)) {
    const bundle = await client.loadProject(project.id, { limit: PROJECT_ISSUE_LIMIT });
    truncated ||= client.mode === "huly" && bundle.issues.length >= PROJECT_ISSUE_LIMIT;
    const statuses = new Map(bundle.statuses.map((status) => [status.id, status.name]));
    for (const issue of bundle.issues) {
      const status = statuses.get(issue.statusId) ?? issue.statusId;
      if (statusName && status.toLowerCase() !== statusName) continue;
      const person = formatPerson(issue, people);
      if (assignee && person.toLowerCase() !== assignee) continue;
      rows.push(`${issue.identifier}　${status}　${issue.priority}　${person}　${issue.title}`);
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit) break;
  }
  if (!rows.length) rows.push(truncated ? "已扫描的范围内没有匹配任务。" : "没有匹配的任务。");
  if (rows.length >= limit || truncated) {
    rows.push(`结果可能不完整：最多返回 ${limit} 条，最多扫描 ${maxProjects} 个项目、每个项目前 ${PROJECT_ISSUE_LIMIT} 条。请按项目缩小范围，或用任务编号调用 get_issue。`);
  }
  return text(rows.join("\n"));
}

async function toolGetIssue(client: DeskClient, args: Record<string, unknown>) {
  const identifier = str(args.identifier);
  if (!identifier) throw new Error("缺少 identifier。");
  const issue = await findIssue(client, identifier);
  const [bundle, hydrated, projects, people] = await Promise.all([
    client.loadProject(issue.projectId, { targetIssueId: issue.id, limit: PROJECT_ISSUE_LIMIT }),
    client.hydrateIssue(issue), client.listProjects(), client.listPeople(),
  ]);
  const timeline = await client.loadIssueTimeline(issue).catch(() => null);
  const project = projects.find((p) => p.id === issue.projectId);
  const status = bundle.statuses.find((s) => s.id === issue.statusId);
  const lines = [
    `${issue.identifier}　${issue.title}`,
    `项目：${project ? `${project.name}（${project.identifier}）` : issue.projectId}`,
    `状态：${status?.name ?? issue.statusId}　优先级：${issue.priority}　指派：${formatPerson(issue, people)}`,
    `描述：`,
    hydrated.descriptionUnavailable ? "（暂不可用）" : hydrated.description || "（空）",
  ];
  if (timeline) {
    const recent = [...timeline.comments].sort((a, b) => b.createdOn - a.createdOn).slice(0, 5);
    if (recent.length) {
      lines.push("最近评论：");
      for (const c of recent.reverse()) lines.push(`- ${c.authorName}：${c.body}`);
    }
  } else lines.push("最近评论：暂不可用。");
  return text(lines.join("\n"));
}

async function toolUpdateStatus(client: DeskClient, args: Record<string, unknown>, ensureCurrent: () => void) {
  const identifier = str(args.identifier);
  const statusName = str(args.status);
  if (!identifier || !statusName) throw new Error("缺少 identifier 或 status。");
  const issue = await findIssue(client, identifier);
  const bundle = await client.loadProject(issue.projectId, { targetIssueId: issue.id, limit: PROJECT_ISSUE_LIMIT });
  const match = bundle.statuses.find(
    (s) => s.name === statusName || s.name.toLowerCase() === statusName.toLowerCase(),
  );
  if (!match) {
    throw new Error(
      `项目里没有状态「${statusName}」。可用状态：${bundle.statuses.map((s) => s.name).join("、")}`,
    );
  }
  ensureCurrent();
  if (issue.statusId === match.id) return text(`${issue.identifier} 已经是「${match.name}」。`);
  const updated = await client.updateIssue(issue.id, { statusId: match.id });
  return text(`已把 ${updated.identifier} 的状态改为「${match.name}」。`);
}

async function toolAddComment(client: DeskClient, args: Record<string, unknown>, ensureCurrent: () => void) {
  const identifier = str(args.identifier);
  const body = str(args.body);
  if (!identifier || !body.trim()) throw new Error("缺少 identifier 或 body。");
  if (!client.commentWrite) throw new Error("当前工作区不支持写入评论。");
  const issue = await findIssue(client, identifier);
  ensureCurrent();
  await client.addComment(issue.id, body, "markdown");
  return text(`已在 ${issue.identifier} 添加评论。`);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const handlers: Record<string, (client: DeskClient, args: Record<string, unknown>, ensureCurrent: () => void) => Promise<ReturnType<typeof text>>> = {
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
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function dispatchMcp(
  request: McpRequest,
  client: DeskClient | null,
  isCurrent: () => boolean = () => true,
): Promise<McpResponse> {
  const reply = (result: unknown): McpResponse => ({ jsonrpc: "2.0", id: request.id, result });
  const fail = (code: number, message: string): McpResponse => ({ jsonrpc: "2.0", id: request.id, error: { code, message } });
  const toolError = (message: string) => reply({ ...text(message), isError: true });
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error("工作区已切换或退出，请确认当前工作区后重试。");
  };

  switch (request.method) {
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const name = request.params?.name;
      if (typeof name !== "string" || !Object.hasOwn(handlers, name)) return fail(-32602, "未知或缺少工具名称。");
      const args = request.params?.arguments;
      if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args))) {
        return fail(-32602, "arguments 必须是对象。");
      }
      if (!client) return toolError("请先在 Huly Desk 连接工作区。");
      try {
        ensureCurrent();
        const result = await handlers[name](client, (args ?? {}) as Record<string, unknown>, ensureCurrent);
        if (name !== "update_issue_status" && name !== "add_comment") ensureCurrent();
        return reply(result);
      } catch (reason) {
        return toolError(safeErrorMessage(reason, [client.tokenForKeychain()]));
      }
    }
    default:
      return fail(-32601, `未知方法：${request.method}`);
  }
}
