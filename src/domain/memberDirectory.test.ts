import { describe, expect, it } from "vitest";
import { emailFromSocial, mergeWorkspaceMembers, normalizeMemberRows } from "./memberDirectory";
import { canManageWorkspaceMembers, isOwnerOrMaintainer } from "./roles";

describe("normalizeMemberRows", () => {
  it("reads person/role rows and wrapped payloads", () => {
    expect(normalizeMemberRows(null)).toEqual([]);
    expect(
      normalizeMemberRows([
        { person: "acc-1", role: "OWNER" },
        { account: "acc-2", role: "user" },
        { accountId: "acc-1", role: "MAINTAINER" },
      ]),
    ).toEqual([
      { accountId: "acc-1", role: "OWNER" },
      { accountId: "acc-2", role: "USER" },
    ]);
    expect(
      normalizeMemberRows({ members: [{ person: "acc-3", role: "MAINTAINER" }] }),
    ).toEqual([{ accountId: "acc-3", role: "MAINTAINER" }]);
  });
});

describe("emailFromSocial", () => {
  it("reads email values and strips prefixes", () => {
    expect(emailFromSocial({ type: "EMAIL", value: "a@example.com" })).toBe("a@example.com");
    expect(emailFromSocial({ key: "email", value: "email:b@example.com" })).toBe("b@example.com");
    expect(emailFromSocial({ provider: "telegram", value: "@bob" })).toBeUndefined();
    expect(emailFromSocial({ address: "c@example.com" })).toBe("c@example.com");
  });
});

describe("mergeWorkspaceMembers", () => {
  const people = [
    { id: "p-bill", accountId: "acc-bill", name: "Bill Murphy", email: undefined, active: true },
    { id: "p-zhang", accountId: "acc-zhang", name: "张三", active: true },
    { id: "p-ghost", accountId: "acc-ghost", name: "已停用", active: false },
  ];
  const employees = [
    { id: "p-bill", accountId: "acc-bill", name: "Bill Murphy", active: true },
    { id: "p-zhang", accountId: "acc-zhang", name: "张三", active: true },
  ];
  const emails = [
    { personId: "p-zhang", email: "zhang@example.com" },
    { accountId: "acc-li", email: "li@example.com" },
  ];

  it("joins getWorkspaceMembers roles with Person and SocialIdentity emails", () => {
    const members = mergeWorkspaceMembers({
      roles: [
        { accountId: "acc-bill", role: "OWNER" },
        { accountId: "acc-zhang", role: "USER" },
        { accountId: "acc-li", role: "USER" },
      ],
      people,
      employees,
      emails,
      profiles: [{ accountId: "acc-bill", name: "Bill Murphy", email: "bill@example.com" }],
    });
    expect(members).toEqual([
      {
        accountId: "acc-bill",
        personId: "p-bill",
        name: "Bill Murphy",
        email: "bill@example.com",
        role: "OWNER",
        active: true,
      },
      {
        accountId: "acc-zhang",
        personId: "p-zhang",
        name: "张三",
        email: "zhang@example.com",
        role: "USER",
        active: true,
      },
      {
        accountId: "acc-li",
        personId: undefined,
        name: "未命名",
        email: "li@example.com",
        role: "USER",
        active: true,
      },
    ]);
  });

  it("falls back to Employee/Person as USER when role rows are missing", () => {
    const members = mergeWorkspaceMembers({
      roles: [],
      people,
      employees,
      emails,
    });
    expect(members.map((member) => member.accountId)).toEqual(["acc-bill", "acc-zhang"]);
    expect(members.every((member) => member.role === "USER")).toBe(true);
    expect(members[1]?.email).toBe("zhang@example.com");
  });

  it("matches person documents by either id or personUuid", () => {
    const members = mergeWorkspaceMembers({
      roles: [{ accountId: "p-only", role: "MAINTAINER" }],
      people: [{ id: "p-only", name: "仅文档 id" }],
    });
    expect(members[0]).toMatchObject({ accountId: "p-only", personId: "p-only", name: "仅文档 id", role: "MAINTAINER" });
  });
});

describe("role gating source", () => {
  it("treats ADMIN and OWNER from selectWorkspace as managers", () => {
    expect(canManageWorkspaceMembers("ADMIN")).toBe(true);
    expect(canManageWorkspaceMembers("OWNER")).toBe(true);
    expect(isOwnerOrMaintainer("ADMIN")).toBe(true);
    expect(canManageWorkspaceMembers("USER")).toBe(false);
  });
});
