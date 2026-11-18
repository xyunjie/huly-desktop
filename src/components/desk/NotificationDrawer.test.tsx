import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockNotifications } from "@/data/mock/fixtures";
import { NotificationDrawer } from "./NotificationDrawer";

describe("NotificationDrawer", () => {
  it("shows a task number, title and project, and opens the linked task", async () => {
    const onOpenTarget = vi.fn();
    const onMarkRead = vi.fn(async () => undefined);
    render(<NotificationDrawer open notifications={mockNotifications} loading={false} onClose={vi.fn()} onRefresh={vi.fn()}
      onOpenTarget={onOpenTarget} onMarkRead={onMarkRead} onMarkAllRead={vi.fn(async () => undefined)} />);
    const item = await screen.findByRole("button", { name: "打开任务 CORE-128 登录页在弱网下会重复提交" });
    expect(item).toHaveTextContent("核心平台");
    expect(item).toHaveTextContent("可以先用按钮");
    fireEvent.click(item);
    await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith("notif-1"));
    expect(onOpenTarget).toHaveBeenCalledWith(expect.objectContaining({ objectId: "i-128", projectId: "proj-core" }));
  });
});
