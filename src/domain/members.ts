import { isOwner, isOwnerOrMaintainer, type WorkspaceRole } from "./roles";

export interface MemberRef {
  accountId: string;
  role: WorkspaceRole;
}

export function ownerCount(members: MemberRef[]): number {
  return members.filter((member) => member.role === "OWNER").length;
}

export function canRemoveWorkspaceMember(input: {
  actorRole: WorkspaceRole;
  actorAccountId: string;
  target: MemberRef;
  members: MemberRef[];
}): { ok: true } | { ok: false; reason: string } {
  if (!isOwner(input.actorRole)) return { ok: false, reason: "暂不支持" };
  if (input.target.accountId === input.actorAccountId) return { ok: false, reason: "不能移除自己" };
  if (input.target.role === "OWNER" && ownerCount(input.members) <= 1) {
    return { ok: false, reason: "不能移除最后一位所有者" };
  }
  return { ok: true };
}

export function canChangeWorkspaceRole(input: {
  actorRole: WorkspaceRole;
  target: MemberRef;
  nextRole: WorkspaceRole;
  members: MemberRef[];
}): { ok: true } | { ok: false; reason: string } {
  if (!isOwnerOrMaintainer(input.actorRole)) return { ok: false, reason: "暂不支持" };
  if (input.target.role === input.nextRole) return { ok: false, reason: "角色没有变化" };
  if (!isOwner(input.actorRole)) {
    if (input.target.role === "OWNER" || input.nextRole === "OWNER") {
      return { ok: false, reason: "维护者不能修改所有者" };
    }
  }
  if (input.target.role === "OWNER" && input.nextRole !== "OWNER" && ownerCount(input.members) <= 1) {
    return { ok: false, reason: "不能改掉最后一位所有者" };
  }
  return { ok: true };
}

export function addProjectMember(memberIds: string[], accountId: string): string[] {
  const id = accountId.trim();
  if (!id) return [...memberIds];
  if (memberIds.includes(id)) return [...memberIds];
  return [...memberIds, id];
}

export function removeProjectMember(memberIds: string[], accountId: string): string[] {
  return memberIds.filter((id) => id !== accountId);
}

export function personMatchesAccount(person: { id: string; accountId?: string }, accountId: string): boolean {
  return person.id === accountId || person.accountId === accountId;
}
