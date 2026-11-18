import type { Issue } from "./types";

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  keywords?: string;
  group: "命令" | "任务";
}

export function buildCommands(issues: Issue[], view: "list" | "board"): PaletteCommand[] {
  const commands: PaletteCommand[] = [
    { id: "create", title: "新建任务", hint: "C / ⌘N", group: "命令", keywords: "new create" },
    {
      id: view === "list" ? "board" : "list",
      title: view === "list" ? "切换到看板" : "切换到列表",
      hint: "B",
      group: "命令",
      keywords: "board list kanban",
    },
    { id: "list", title: "切换到列表", group: "命令" },
    { id: "board", title: "切换到看板", group: "命令" },
    { id: "mine", title: "打开我的任务", group: "命令" },
    { id: "projects", title: "打开项目列表", group: "命令" },
    { id: "notifications", title: "打开通知收件箱", group: "命令", keywords: "inbox notify" },
    { id: "milestones", title: "管理里程碑与组件", group: "命令", keywords: "milestone component" },
    { id: "templates", title: "管理任务模板", group: "命令", keywords: "template" },
    { id: "refresh", title: "刷新当前数据", hint: "R", group: "命令", keywords: "sync reload" },
    { id: "search", title: "聚焦搜索", hint: "/", group: "命令" },
    { id: "disconnect", title: "退出登录", group: "命令", keywords: "logout disconnect" },
  ];
  const unique = new Map<string, PaletteCommand>();
  for (const command of commands) unique.set(command.id, command);
  const issueCommands = issues.slice(0, 40).map((issue) => ({
    id: `issue:${issue.id}`,
    title: `打开 ${issue.identifier} ${issue.title}`,
    group: "任务" as const,
    keywords: `${issue.identifier} ${issue.title}`,
  }));
  return [...unique.values(), ...issueCommands];
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  return commands.filter((command) => {
    const haystack = `${command.title} ${command.keywords ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}
