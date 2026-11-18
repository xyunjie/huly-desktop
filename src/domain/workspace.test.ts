import { describe, expect, it } from "vitest";
import { addProjectMember, canChangeWorkspaceRole, canRemoveWorkspaceMember, ownerCount, removeProjectMember } from "./members";
import {
  canEditProject,
  canManageWorkspaceMembers,
  isOwner,
  isOwnerOrMaintainer,
  parseWorkspaceRole,
  ROLE_LABEL,
} from "./roles";
import { dropIfStale, RequestGate } from "./stale";
import { displayPersonName, namePartsFromDisplay, storedPersonName } from "@/data/huly/mapping";

const members = [
  { accountId: "acc-bill", role: "OWNER" as const },
  { accountId: "acc-zhang", role: "MAINTAINER" as const },
  { accountId: "acc-li", role: "USER" as const },
];

describe("workspace roles", () => {
  it("parses Huly account roles and gates the admin menu", () => {
    expect(parseWorkspaceRole("OWNER")).toBe("OWNER");
    expect(parseWorkspaceRole("maintainer")).toBe("MAINTAINER");
    expect(parseWorkspaceRole("mystery", "USER")).toBe("USER");
    expect(isOwnerOrMaintainer("OWNER")).toBe(true);
    expect(isOwnerOrMaintainer("MAINTAINER")).toBe(true);
    expect(isOwnerOrMaintainer("USER")).toBe(false);
    expect(isOwner("MAINTAINER")).toBe(false);
    expect(canManageWorkspaceMembers("USER")).toBe(false);
    expect(canEditProject("GUEST")).toBe(false);
    expect(canEditProject("OWNER")).toBe(true);
    expect(ROLE_LABEL.MAINTAINER).toBe("维护者");
  });
});

describe("member add/remove logic", () => {
  it("does not remove the last owner or the current user", () => {
    expect(ownerCount(members)).toBe(1);
    expect(
      canRemoveWorkspaceMember({
        actorRole: "OWNER",
        actorAccountId: "acc-bill",
        target: members[0],
        members,
      }).ok,
    ).toBe(false);
    expect(
      canRemoveWorkspaceMember({
        actorRole: "OWNER",
        actorAccountId: "acc-bill",
        target: members[2],
        members,
      }),
    ).toEqual({ ok: true });
    expect(
      canRemoveWorkspaceMember({
        actorRole: "USER",
        actorAccountId: "acc-li",
        target: members[2],
        members,
      }),
    ).toEqual({ ok: false, reason: "暂不支持" });
    expect(
      canChangeWorkspaceRole({
        actorRole: "MAINTAINER",
        target: members[0],
        nextRole: "USER",
        members,
      }).ok,
    ).toBe(false);
    expect(
      canChangeWorkspaceRole({
        actorRole: "OWNER",
        target: members[0],
        nextRole: "USER",
        members,
      }),
    ).toEqual({ ok: false, reason: "不能改掉最后一位所有者" });
    expect(
      canChangeWorkspaceRole({
        actorRole: "OWNER",
        target: members[2],
        nextRole: "MAINTAINER",
        members,
      }),
    ).toEqual({ ok: true });
  });

  it("adds a project member once and can remove them", () => {
    expect(addProjectMember(["acc-bill"], "acc-li")).toEqual(["acc-bill", "acc-li"]);
    expect(addProjectMember(["acc-bill"], "acc-bill")).toEqual(["acc-bill"]);
    expect(removeProjectMember(["acc-bill", "acc-li"], "acc-bill")).toEqual(["acc-li"]);
  });
});

describe("stale request dropping", () => {
  it("only keeps the current generation", () => {
    const gate = new RequestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    expect(dropIfStale(first, gate.current(), { projects: ["old"] })).toBeUndefined();
    expect(dropIfStale(second, gate.current(), { projects: ["new"] })).toEqual({ projects: ["new"] });
  });
});

describe("display name formatting", () => {
  it("stores Last,First and displays CJK without a space", () => {
    expect(displayPersonName("陈,文杰")).toBe("陈文杰");
    expect(displayPersonName("Murphy,Bill")).toBe("Bill Murphy");
    expect(namePartsFromDisplay("陈文杰")).toEqual({ last: "陈", first: "文杰" });
    expect(namePartsFromDisplay("Bill Murphy")).toEqual({ first: "Bill", last: "Murphy" });
    expect(namePartsFromDisplay("Murphy,Bill")).toEqual({ first: "Bill", last: "Murphy" });
    expect(displayPersonName(storedPersonName("文杰", "陈"))).toBe("陈文杰");
    expect(displayPersonName(storedPersonName("Bill", "Murphy"))).toBe("Bill Murphy");
  });
});
