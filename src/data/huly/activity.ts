import type { PlatformClient } from "@hcengineering/api-client";
import type { Issue, IssueTimeline, Person, Status } from "@/domain/types";
import { descriptionIsRef } from "./mapping";
import { decodeMarkupToMarkdown, formatDocUpdateBody, isInlineMarkupJson, type RawDocUpdateMessage } from "./markup";
import { hasActivityDescriptionVersion, resolveActivityDescription } from "./activityDescription";

export interface ActivityClasses {
  ActivityMessage: string;
  DocUpdateMessage: string;
  ActivityReference: string;
  ActivityInfoMessage: string;
  ChatMessage: string;
  ThreadMessage: string;
}

interface TimelineRow extends RawDocUpdateMessage {
  message?: unknown;
  modifiedOn?: number;
  attachments?: number;
  title?: string;
  provider?: string;
}

export async function loadActivityFeed(
  client: Pick<PlatformClient, "findAll" | "fetchMarkup">,
  issue: Pick<Issue, "id" | "projectId" | "referenceCount">,
  classes: ActivityClasses,
  options: {
    descending: number;
    statuses: Status[];
    people: Person[];
    resolveAuthor: (ref?: string) => string;
    readDescriptionSnapshot?: (ref: string) => Promise<string>;
    refUrl?: string;
  },
): Promise<IssueTimeline> {
  const readOptions = { sort: { createdOn: options.descending }, showArchived: true };
  // The official activity panel queries the parent class: comments and document
  // updates are subclasses in the same feed, not two independent collections.
  const rows = await client.findAll<TimelineRow>(classes.ActivityMessage, {
    attachedTo: issue.id, space: issue.projectId,
  }, readOptions);
  let warning: string | undefined;
  const externalReferences = (issue.referenceCount ?? 0) > 0
    ? await client.findAll<TimelineRow>(classes.ActivityReference, {
      attachedTo: issue.id, space: { $ne: issue.projectId },
    }, readOptions).catch(() => {
      warning = "部分跨项目引用未能加载。";
      return [] as TimelineRow[];
    })
    : [];
  const unique = new Map([...rows, ...externalReferences].map((row) => [row._id, row]));
  const timeline: IssueTimeline = { comments: [], activity: [], warning };
  for (const row of unique.values()) {
    const author = row.createdBy ?? row.modifiedBy;
    const base = {
      id: row._id,
      issueId: issue.id,
      authorId: author ?? null,
      authorName: options.resolveAuthor(author),
      createdOn: row.createdOn ?? row.modifiedOn ?? 0,
    };
    const isChat = row._class === classes.ChatMessage || row._class === classes.ThreadMessage;
    if (isChat) {
      let body = "";
      if (isInlineMarkupJson(row.message) || (typeof row.message === "string" && !descriptionIsRef(row.message))) {
        body = decodeMarkupToMarkdown(row.message, { refUrl: options.refUrl });
      } else if (row.message) {
        try {
          body = await client.fetchMarkup(row._class ?? classes.ChatMessage, row._id, "message", row.message, "markdown");
        } catch {
          body = "（评论正文暂时无法加载）";
          timeline.warning ??= "部分评论正文未能加载。";
        }
      }
      body = body.trim() || ((row.attachments ?? 0) > 0 ? `（含 ${row.attachments} 个附件）` : "（无文字内容）");
      const providerLabel = row.provider && /(?:^|[:_-])email$/i.test(row.provider) ? "email" : undefined;
      const nativeMarkup = typeof row.message === "string" && isInlineMarkupJson(row.message) ? row.message : undefined;
      timeline.comments.push({ ...base, body, providerLabel, nativeMarkup });
      continue;
    }

    let body = "更新了任务信息";
    let change: IssueTimeline["activity"][number]["change"];
    if (row._class === classes.DocUpdateMessage) {
      // The corresponding chat item already presents the comment itself.
      if (row.action === "create" && row.objectClass === classes.ChatMessage && row.objectId && unique.has(row.objectId)) continue;
      body = formatDocUpdateBody(row, options);
      const { attrKey, set } = row.attributeUpdates ?? {};
      if (row.action === "create" && row.objectId === issue.id) change = { type: "created" };
      else if (attrKey === "status" && typeof set?.[0] === "string") change = { type: "status", statusId: set[0] };
      else if (attrKey === "assignee") change = { type: "assignee" };
      else if (attrKey === "description") {
        const previous = row.attributeUpdates?.prevValue;
        const next = set?.[0];
        change = {
          type: "description",
          before: typeof previous === "string" ? previous : previous === null ? "" : undefined,
          after: typeof next === "string" ? next : next === null ? "" : undefined,
        };
        body = "更改了描述";
      }
    } else if (row._class === classes.ActivityReference) {
      body = "从其他记录引用了此任务";
    } else if (row._class === classes.ActivityInfoMessage) {
      const text = typeof row.message === "string" ? row.message : row.title;
      if (text && !/^[\w-]+:string:/.test(text)) body = text;
    }
    timeline.activity.push({ ...base, kind: "update", body, change });
  }
  // Old/new values can point to the same immutable blobs across adjacent edits.
  // Keep requests bounded and cached for this feed, and keep unverified entries.
  const texts = new Map<string | undefined, Promise<string | undefined>>();
  function resolveText(value?: string) {
    const cached = texts.get(value);
    if (cached) return cached;
    const pending = resolveActivityDescription(value, options.readDescriptionSnapshot);
    texts.set(value, pending);
    return pending;
  }
  const changes = timeline.activity.filter((item) => item.change?.type === "description");
  const unchanged = new Set<string>();
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(changes.length, 3) }, async () => {
    for (let item = changes[index++]; item; item = changes[index++]) {
      const change = item.change;
      if (change?.type !== "description" || !hasActivityDescriptionVersion(change.before) || !hasActivityDescriptionVersion(change.after)) continue;
      const [before, after] = await Promise.all([resolveText(change.before), resolveText(change.after)]);
      if (before !== undefined && before === after) unchanged.add(item.id);
      else change.text = { before, after };
    }
  }));
  timeline.activity = timeline.activity.filter((item) => !unchanged.has(item.id));
  return timeline;
}
