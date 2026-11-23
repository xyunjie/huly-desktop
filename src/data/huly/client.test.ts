import { describe, expect, it, vi } from "vitest";
import { HulyDeskClient } from "./client";

describe("Huly assigned tasks", () => {
  it("loads all assigned tasks and resolves status names without loading a project", async () => {
    const status = "6afac43b3bdbbe14f03549b4";
    const findAll = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 201 }, (_, index) => ({
        _id: `issue-${index}`, space: index % 2 ? "proj-1" : "proj-2", status, assignee: "me",
      })))
      .mockResolvedValueOnce([{ _id: status, name: "待复核", category: "task:statusCategory:Active" }]);
    const client = new HulyDeskClient();
    vi.spyOn(client as unknown as { api(): { findAll: typeof findAll } }, "api").mockReturnValue({ findAll });

    const result = await client.listAssigned("me");

    expect(result.issues).toHaveLength(201);
    expect(result.statuses).toMatchObject([{ id: status, name: "待复核", category: "in-progress" }]);
    expect(findAll).toHaveBeenNthCalledWith(1, "tracker:class:Issue", { assignee: "me" }, { sort: { modifiedOn: -1 } });
    expect(findAll).toHaveBeenNthCalledWith(2, "tracker:class:IssueStatus", { _id: { $in: [status] } });
  });
});
