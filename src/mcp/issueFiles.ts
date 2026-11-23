import MarkdownIt from "markdown-it";
import { ISSUE_ATTACHMENT_LIMIT, type DeskClient } from "@/data/client";
import { isHulyFileId } from "@/data/huly/markup";
import type { Issue } from "@/domain/types";

const markdown = new MarkdownIt();
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface IssueFile {
  fileId: string;
  name: string;
  type?: string;
  size?: number;
  source?: string;
}

function inlineFiles(client: DeskClient, body: string, markup?: string): IssueFile[] {
  const files: IssueFile[] = [];
  if (markup) {
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
      if (node.type === "image" || node.type === "file") {
        const attrs = node.attrs ?? {};
        const id = attrs["file-id"];
        const fileId = isHulyFileId(id) ? id : typeof attrs.src === "string" ? client.workspaceFileId(attrs.src) : null;
        const name = [attrs["data-file-name"], attrs.alt, attrs.title].find((item): item is string => typeof item === "string" && item !== "");
        if (fileId) files.push({ fileId, name: name ?? fileId, type: typeof attrs["data-file-type"] === "string" ? attrs["data-file-type"] : undefined });
      }
      if (Array.isArray(node.content)) node.content.forEach(visit);
    };
    try {
      visit(JSON.parse(markup));
    } catch {
      // A malformed rich-text document can still have a Markdown fallback.
    }
  }
  for (const block of markdown.parse(body, {})) {
    for (const token of block.children ?? []) {
      const src = token.type === "image" ? token.attrGet("src") : token.type === "link_open" ? token.attrGet("href") : null;
      if (typeof src !== "string") continue;
      const fileId = client.workspaceFileId(src);
      const title = token.attrGet("title");
      if (fileId) files.push({ fileId, name: token.content || (typeof title === "string" && title) || fileId });
    }
  }
  return files;
}

export async function listIssueFiles(client: DeskClient, issue: Issue, fileId?: string) {
  const [hydrated, timeline] = await Promise.all([
    client.hydrateIssue(issue), client.loadIssueTimeline(issue, { commentsOnly: true }).catch(() => null),
  ]);
  const comments = timeline?.comments ?? [];
  const attachments = await client.listAttachments(issue.id, { commentIds: comments.map((comment) => comment.id), fileId });
  const files = new Map<string, IssueFile>();
  const addInline = (source: string, body: string, markup?: string) => {
    for (const file of inlineFiles(client, body, markup)) {
      if ((!fileId || file.fileId === fileId) && !files.has(file.fileId)) files.set(file.fileId, { ...file, source });
    }
  };
  if (!hydrated.descriptionUnavailable) addInline("描述", hydrated.description, hydrated.descriptionMarkup);
  for (const comment of comments) addInline("评论", comment.body, comment.nativeMarkup);
  for (const attachment of attachments) {
    if (isHulyFileId(attachment.fileId)) files.set(attachment.fileId, {
      fileId: attachment.fileId, name: attachment.name, type: attachment.type, size: attachment.size, source: "附件",
    });
  }
  const warnings = [];
  if (hydrated.descriptionUnavailable || !timeline || timeline.warning) warnings.push("部分描述或评论不可用，文件列表可能不完整。");
  // shortcut: keep the existing attachment listing cap; paginate when larger inventories need full discovery.
  if (attachments.length >= ISSUE_ATTACHMENT_LIMIT) warnings.push(`附件列表最多显示 ${ISSUE_ATTACHMENT_LIMIT} 条，已知 fileId 仍可直接读取。`);
  return { files, warnings };
}

function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const header = String.fromCharCode(...bytes.subarray(0, 12));
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "image/gif";
  if (header.startsWith("RIFF") && header.slice(8) === "WEBP") return "image/webp";
}

async function readBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const tooLarge = "文件超过 MCP 单文件上限（5 MiB），请从桌面端下载原件。";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error(tooLarge);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new Error(tooLarge);
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readIssueFile(client: DeskClient, issue: Issue, file: IssueFile) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await client.fetchWorkspaceFile(file.fileId, controller.signal);
    if (!response.ok || response.status === 206) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`无法读取完整文件（HTTP ${response.status}）。`);
    }
    const headerMime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (headerMime === "text/html" && file.type?.split(";")[0].trim().toLowerCase() !== headerMime) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("文件服务返回了网页而不是预期的文件。");
    }
    const bytes = await readBytes(response);
    const fileText = { type: "text" as const, text: `${file.name}（${bytes.byteLength} 字节，fileId=${file.fileId}）` };
    const chunks: string[] = [];
    // Encode multiples of three so only the last chunk can contain Base64 padding.
    for (let offset = 0; offset < bytes.byteLength; offset += 24_576) {
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
    }
    const data = chunks.join("");
    const image = imageMime(bytes);
    if (image) return { content: [fileText, { type: "image" as const, mimeType: image, data }] };
    const mimeType = (headerMime && headerMime !== "application/octet-stream" ? headerMime : file.type) || "application/octet-stream";
    const uri = `huly-attachment://file/${encodeURIComponent(issue.id)}/${encodeURIComponent(file.fileId)}`;
    return { content: [fileText, { type: "resource" as const, resource: { uri, mimeType, blob: data } }] };
  } catch (reason) {
    if (controller.signal.aborted) throw new Error("读取文件超时，请重试。");
    throw reason;
  } finally {
    clearTimeout(timeout);
  }
}
