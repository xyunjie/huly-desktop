export const WORKSPACE_ROLES = [
  "READONLYGUEST",
  "DocGuest",
  "GUEST",
  "USER",
  "MAINTAINER",
  "OWNER",
  "ADMIN",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_ORDER: Record<WorkspaceRole, number> = {
  READONLYGUEST: 5,
  DocGuest: 10,
  GUEST: 20,
  USER: 30,
  MAINTAINER: 40,
  OWNER: 50,
  ADMIN: 100,
};

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  READONLYGUEST: "只读访客",
  DocGuest: "文档访客",
  GUEST: "访客",
  USER: "成员",
  MAINTAINER: "维护者",
  OWNER: "所有者",
  ADMIN: "管理员",
};

export const ASSIGNABLE_ROLES: WorkspaceRole[] = ["GUEST", "USER", "MAINTAINER", "OWNER"];

export function isWorkspaceRole(value: string | null | undefined): value is WorkspaceRole {
  return Boolean(value && (WORKSPACE_ROLES as readonly string[]).includes(value));
}

export function parseWorkspaceRole(value: string | null | undefined, fallback: WorkspaceRole = "USER"): WorkspaceRole {
  if (!value) return fallback;
  const normalized = value.trim();
  if (isWorkspaceRole(normalized)) return normalized;
  const upper = normalized.toUpperCase();
  if (isWorkspaceRole(upper)) return upper;
  if (upper === "DOCGUEST") return "DocGuest";
  return fallback;
}

export function isOwnerOrMaintainer(role: WorkspaceRole | null | undefined): boolean {
  if (!role) return false;
  return ROLE_ORDER[role] >= ROLE_ORDER.MAINTAINER;
}

export function isOwner(role: WorkspaceRole | null | undefined): boolean {
  if (!role) return false;
  return ROLE_ORDER[role] >= ROLE_ORDER.OWNER;
}

export function canManageWorkspaceMembers(role: WorkspaceRole | null | undefined): boolean {
  return isOwnerOrMaintainer(role);
}

export function canEditProject(role: WorkspaceRole | null | undefined): boolean {
  return isOwnerOrMaintainer(role);
}

export function initialMockRole(): WorkspaceRole {
  if (typeof window === "undefined") return "OWNER";
  try {
    return parseWorkspaceRole(new URLSearchParams(window.location.search).get("role"), "OWNER");
  } catch {
    return "OWNER";
  }
}
