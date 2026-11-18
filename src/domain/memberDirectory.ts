import type { WorkspaceMember } from "./types";
import { parseWorkspaceRole, type WorkspaceRole } from "./roles";

export interface MemberRoleRow {
  accountId: string;
  role: WorkspaceRole;
}

export interface DirectoryPerson {
  id: string;
  accountId?: string;
  name?: string;
  email?: string;
  active?: boolean;
}

export interface SocialEmail {
  personId?: string;
  accountId?: string;
  email: string;
}

export interface PersonInfoLite {
  accountId: string;
  name?: string;
  email?: string;
}

function stringId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Accept a raw array or a wrapped account-client payload. */
export function extractMemberArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["members", "value", "result", "data"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

export function normalizeMemberRows(raw: unknown): MemberRoleRow[] {
  const rows: MemberRoleRow[] = [];
  const seen = new Set<string>();
  for (const item of extractMemberArray(raw)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const accountId = stringId(record.person ?? record.account ?? record.accountId ?? record.uuid);
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);
    const roleValue = typeof record.role === "string" ? record.role : undefined;
    rows.push({ accountId, role: parseWorkspaceRole(roleValue) });
  }
  return rows;
}

/** Pull a mailbox from SocialIdentity / Channel / getPersonInfo socialIds. */
export function emailFromSocial(item: {
  type?: unknown;
  key?: unknown;
  provider?: unknown;
  value?: unknown;
  address?: unknown;
} | null | undefined): string | undefined {
  if (!item) return undefined;
  const type = String(item.type ?? item.key ?? item.provider ?? "").toLowerCase();
  const candidates = [item.value, item.address].filter((value): value is string => typeof value === "string");
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const normalized = trimmed.replace(/^(email|mailto):/i, "");
    if (isMailbox(normalized)) return normalized;
    if (type.includes("email") && isMailbox(normalized)) return normalized;
  }
  return undefined;
}

function lookupEmail(ids: Array<string | undefined>, emails: Map<string, string>): string | undefined {
  for (const id of ids) {
    if (id && emails.has(id)) return emails.get(id);
  }
  return undefined;
}

function findPerson(people: DirectoryPerson[], accountId: string): DirectoryPerson | undefined {
  return people.find((person) => person.accountId === accountId || person.id === accountId);
}

/**
 * Join workspace role rows with Person / Employee documents and social emails.
 * If getWorkspaceMembers returned nothing, fall back to Employee (then Person) as USER.
 */
export function mergeWorkspaceMembers(input: {
  roles: MemberRoleRow[];
  people: DirectoryPerson[];
  employees?: DirectoryPerson[];
  emails?: SocialEmail[];
  profiles?: PersonInfoLite[];
}): WorkspaceMember[] {
  const emailById = new Map<string, string>();
  for (const item of input.emails ?? []) {
    const email = item.email.trim();
    if (!email) continue;
    if (item.personId) emailById.set(item.personId, email);
    if (item.accountId) emailById.set(item.accountId, email);
  }
  const directory = [...(input.employees ?? []), ...input.people];
  const profiles = new Map((input.profiles ?? []).map((profile) => [profile.accountId, profile]));

  const build = (accountId: string, role: WorkspaceRole, person?: DirectoryPerson): WorkspaceMember => {
    const profile = profiles.get(accountId);
    const email =
      profile?.email ||
      person?.email ||
      lookupEmail([person?.id, person?.accountId, accountId], emailById);
    const name = (profile?.name || person?.name || "").trim() || "未命名";
    return {
      accountId,
      personId: person?.id,
      name,
      email,
      role,
      active: person?.active !== false,
    };
  };

  if (input.roles.length > 0) {
    return input.roles.map((row) => build(row.accountId, row.role, findPerson(directory, row.accountId)));
  }

  const fallback = (input.employees && input.employees.length > 0 ? input.employees : input.people) ?? [];
  const seen = new Set<string>();
  const members: WorkspaceMember[] = [];
  for (const person of fallback) {
    const accountId = person.accountId || person.id;
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);
    members.push(build(accountId, "USER", person));
  }
  return members;
}

function isMailbox(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
