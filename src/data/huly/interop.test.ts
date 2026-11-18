import { describe, expect, it } from "vitest";
import * as accountClient from "@hcengineering/account-client";
import apiClient from "@hcengineering/api-client";
import contact from "@hcengineering/contact";
import * as coreNs from "@hcengineering/core";
import rank from "@hcengineering/rank";
import tags from "@hcengineering/tags";
import task from "@hcengineering/task";
import tracker from "@hcengineering/tracker";
import { moduleBinding, readPlugin } from "./interop";

describe("huly package interop", () => {
  it("unwraps the actual CommonJS activity and chunter modules on dynamic import", async () => {
    const activity = readPlugin<{ class: { ActivityMessage: string } }>(await import("@hcengineering/activity"));
    const chunter = readPlugin<{ class: { ChatMessage: string } }>(await import("@hcengineering/chunter"));
    expect(activity.class.ActivityMessage).toBe("activity:class:ActivityMessage");
    expect(chunter.class.ChatMessage).toBe("chunter:class:ChatMessage");
    expect(readPlugin({ default: { default: activity } })).toBe(activity);
  });

  it("reads the published 0.7 plugin ids", () => {
    const trackerPlugin = readPlugin<{ class: { Issue: string }; taskTypes: { Issue: string } }>(tracker);
    const taskPlugin = readPlugin<{ class: { ProjectType: string } }>(task);
    const tagsPlugin = readPlugin<{ class: { TagReference: string } }>(tags);
    const contactPlugin = readPlugin<{ class: { Person: string } }>(contact);
    expect(trackerPlugin.class.Issue).toBe("tracker:class:Issue");
    expect(trackerPlugin.taskTypes.Issue).toBe("tracker:taskTypes:Issue");
    expect(taskPlugin.class.ProjectType).toBe("task:class:ProjectType");
    expect(tagsPlugin.class.TagReference).toBe("tags:class:TagReference");
    expect(contactPlugin.class.Person).toBe("contact:class:Person");
    expect(moduleBinding<() => string>(coreNs, "generateId")()).toMatch(/^[0-9a-f]+$/);
    expect(moduleBinding<{ Ascending: number }>(coreNs, "SortingOrder").Ascending).toBe(1);
    expect(typeof moduleBinding(rank, "makeRank")).toBe("function");
    expect(typeof moduleBinding(accountClient, "getClient")).toBe("function");
    expect(typeof moduleBinding(apiClient, "connect")).toBe("function");
    expect(typeof moduleBinding(apiClient, "BrowserWebSocketFactory")).toBe("function");
    const makeRank = moduleBinding<(prev?: string, next?: string) => string>(rank, "makeRank");
    expect(makeRank(undefined, undefined)).toEqual(expect.any(String));
  });
});
