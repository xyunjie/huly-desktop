import { describe, expect, it } from "vitest";
import { buildSessionSecret, parseSessionSecret } from "./secrets";
import {
  ACCOUNT_EXPIRED_MESSAGE,
  AccountSessionError,
  isAccountTokenInvalid,
  isRenewableWorkspaceFailure,
  mapAccountWorkspace,
  planSessionLaunch,
  withWorkspaceRenewal,
} from "./session";

const workspaces = [
  { id: "ws-1", url: "company", name: "公司" },
  { id: "ws-2", url: "rd", name: "研发" },
];

describe("session secret", () => {
  it("stores the account token and default workspace, never a password", () => {
    const raw = buildSessionSecret({
      serverUrl: "https://lm.all666.cn:666",
      workspace: "company",
      workspaceName: "公司",
      email: "bill@example.com",
      token: "account-token-value",
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.password).toBeUndefined();
    expect(Object.keys(parsed).sort()).toEqual(["email", "serverUrl", "token", "workspace", "workspaceName"]);
    const stored = parseSessionSecret(raw);
    expect(stored.token).toBe("account-token-value");
    expect(stored.workspace).toBe("company");
    expect(stored.workspaceName).toBe("公司");
  });
});

describe("workspace mapping", () => {
  it("uses the display name and skips disabled workspaces", () => {
    expect(mapAccountWorkspace({ uuid: "1", url: "company", name: "公司" })).toEqual({
      id: "1",
      url: "company",
      name: "公司",
    });
    expect(mapAccountWorkspace({ uuid: "2", url: "old", name: "旧", isDisabled: true })).toBeNull();
    expect(mapAccountWorkspace({ uuid: "3", url: "plain" })).toEqual({ id: "3", url: "plain", name: "plain" });
  });
});

describe("session launch plan", () => {
  it("enters the stored default workspace when it still exists", () => {
    const plan = planSessionLaunch({
      stored: {
        serverUrl: "https://lm.all666.cn:666",
        workspace: "company",
        email: "bill@example.com",
        token: "account-token-value",
      },
      workspaces,
    });
    expect(plan).toEqual({ action: "enter", workspace: workspaces[0] });
  });

  it("shows the picker when there is no stored default", () => {
    const plan = planSessionLaunch({ stored: null, workspaces });
    expect(plan).toEqual({ action: "pick", workspaces });
  });

  it("shows the picker when the stored workspace is gone but others remain", () => {
    const plan = planSessionLaunch({
      stored: {
        serverUrl: "https://lm.all666.cn:666",
        workspace: "missing",
        email: "bill@example.com",
        token: "account-token-value",
      },
      workspaces,
    });
    expect(plan).toEqual({ action: "pick", workspaces });
  });

  it("returns to login when the account token is invalid", () => {
    const plan = planSessionLaunch({ stored: null, workspaces, accountInvalid: true });
    expect(plan).toEqual({ action: "login", message: ACCOUNT_EXPIRED_MESSAGE });
  });

  it("returns to login when the account has no workspaces", () => {
    const plan = planSessionLaunch({ stored: null, workspaces: [] });
    expect(plan.action).toBe("login");
  });
});

describe("workspace renewal", () => {
  it("retries selectWorkspace once when the workspace connection expired", async () => {
    let attempts = 0;
    let renewed = 0;
    const result = await withWorkspaceRenewal({
      run: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("workspace token expired");
        return "ok";
      },
      renew: async () => {
        renewed += 1;
      },
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(renewed).toBe(1);
  });

  it("returns relogin when renewal fails because the account token is invalid", async () => {
    await expect(
      withWorkspaceRenewal({
        run: async () => {
          throw new Error("workspace token expired");
        },
        renew: async () => {
          throw new Error("invalid token");
        },
      }),
    ).rejects.toBeInstanceOf(AccountSessionError);
  });

  it("does not retry an unrelated failure", async () => {
    await expect(
      withWorkspaceRenewal({
        run: async () => {
          throw new Error("找不到这个项目。");
        },
        renew: async () => {
          throw new Error("should not renew");
        },
      }),
    ).rejects.toThrow("找不到这个项目。");
  });

  it("recognizes account and workspace auth failures", () => {
    expect(isAccountTokenInvalid(new AccountSessionError())).toBe(true);
    expect(isAccountTokenInvalid(new Error("invalid token"))).toBe(true);
    expect(isRenewableWorkspaceFailure(new Error("WebSocket unauthorized"))).toBe(true);
    expect(isRenewableWorkspaceFailure(new Error("找不到这个项目。"))).toBe(false);
  });
});
