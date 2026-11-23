import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoginDraft } from "@/domain/login";
import { LoginScreen } from "./LoginScreen";

describe("login screen", () => {
  it("shows a simple login form without workspace, mock, or probe controls", async () => {
    const onSubmit = vi.fn(async (_draft: LoginDraft) => undefined);
    render(<LoginScreen mock={false} busy={false} error={null} onEnter={onSubmit} />);
    expect(screen.getByRole("heading", { name: "Huly Desk" })).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toHaveAttribute("type", "submit");
    expect(screen.queryByText("连接到 Huly")).not.toBeInTheDocument();
    expect(screen.queryByText("使用示例数据（不连接服务器）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /探测配置/ })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("https://lm.all666.cn:666")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("高级设置"));
    expect(screen.getByDisplayValue("https://lm.all666.cn:666")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "bill@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret-pass" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const draft = onSubmit.mock.calls[0]?.[0];
    expect(draft?.email).toBe("bill@example.com");
    expect(draft?.mock).toBe(false);
  });

  it("in hidden mock mode can enter without credentials", async () => {
    const onSubmit = vi.fn(async (_draft: LoginDraft) => undefined);
    render(<LoginScreen mock busy={false} error={null} onEnter={onSubmit} />);
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0].mock).toBe(true);
  });

  it("submits credentials through the form, as when pressing Enter inside it", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<LoginScreen mock={false} busy={false} error={null} onEnter={onSubmit} />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "bill@example.com" } });
    const password = screen.getByLabelText<HTMLInputElement>("密码");
    fireEvent.change(password, { target: { value: "secret-pass" } });
    fireEvent.submit(password.form!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ email: "bill@example.com" }), expect.anything()));
  });
});
