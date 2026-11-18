import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoginDraft } from "@/domain/login";
import { LoginScreen } from "./LoginScreen";

describe("login screen", () => {
  it("shows a simple login form without workspace, mock, or probe controls", () => {
    const onSubmit = vi.fn(async (_draft: LoginDraft) => undefined);
    render(<LoginScreen mock={false} busy={false} error={null} onEnter={onSubmit} />);
    expect(screen.getByRole("heading", { name: "Huly Desk" })).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toBeInTheDocument();
    expect(screen.queryByText("连接到 Huly")).not.toBeInTheDocument();
    expect(screen.queryByText("使用示例数据（不连接服务器）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /探测配置/ })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("https://lm.all666.cn:666")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("高级设置"));
    expect(screen.getByDisplayValue("https://lm.all666.cn:666")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "bill@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const draft = onSubmit.mock.calls[0]?.[0];
    expect(draft?.email).toBe("bill@example.com");
    expect(draft?.mock).toBe(false);
  });

  it("in hidden mock mode can enter without credentials", () => {
    const onSubmit = vi.fn(async (_draft: LoginDraft) => undefined);
    render(<LoginScreen mock busy={false} error={null} onEnter={onSubmit} />);
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].mock).toBe(true);
  });
});
