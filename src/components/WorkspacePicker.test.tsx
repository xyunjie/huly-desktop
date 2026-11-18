import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "./WorkspacePicker";

describe("workspace picker", () => {
  it("lists display names and enters the selected workspace", () => {
    const onEnter = vi.fn(async () => undefined);
    render(
      <WorkspacePicker
        workspaces={[
          { id: "ws-1", url: "company", name: "公司" },
          { id: "ws-2", url: "rd", name: "研发" },
        ]}
        busy={false}
        error={null}
        onEnter={onEnter}
      />,
    );
    expect(screen.getByText("公司")).toBeInTheDocument();
    expect(screen.getByText("研发")).toBeInTheDocument();
    expect(screen.queryByText("company")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("研发"));
    fireEvent.click(screen.getByRole("button", { name: "进入工作区" }));
    expect(onEnter).toHaveBeenCalledWith("rd");
  });
});
