import { FileAddOutlined, PaperClipOutlined, SendOutlined, SmileOutlined, TableOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { Button, Input, Popover, Space } from "antd";
import DOMPurify from "dompurify";
import { Editor, generateJSON, type JSONContent } from "@tiptap/core";
import type {} from "@tiptap/extension-table";
import { Highlight, ServerKit, Subscript, Superscript } from "@hcengineering/text";
import { useEffect, useRef, useState, type RefObject } from "react";
import { markdownToMarkup } from "@hcengineering/text-markdown";
import { MarkdownView } from "@/components/MarkdownView";
import { HULY_IMAGE_PREFIX } from "@/data/huly/markup";
import type { Attachment, EditorTemplate, Person } from "@/domain/types";
import { compatibleEditorExtensions, fromEditorDocument, toEditorDocument } from "./hulyEditorDocument";

type Props = {
  issueId: string;
  markdown: string;
  markup?: string;
  readOnly: boolean;
  people: Person[];
  onUpload?: (file: File) => Promise<Attachment | void>;
  onDownload?: (attachment: Attachment) => Promise<void>;
  onResolveImage?: (src: string) => Promise<string | null>;
  onLoadTemplates?: () => Promise<EditorTemplate[]>;
} & (
  | { mode?: "description"; onSave: (markup: string, previousMarkup?: string) => Promise<void>; flushRef: RefObject<(() => Promise<boolean>) | null> }
  | { mode: "comment"; onSubmit: (markup: string) => Promise<void> }
);

const emojis = ["👍", "👎", "✅", "🎉", "😊", "🔥", "🚀", "👀", "❤️", "⚠️", "🤔", "🙏"];
const extensions = compatibleEditorExtensions([ServerKit, Highlight, Subscript, Superscript]);

function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export default function IssueDescriptionEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const loadedEditor = useRef<Editor | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const raw = useRef(props.markup);
  const saved = useRef("");
  const draft = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [ready, setReady] = useState(false);
  const [inTable, setInTable] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const commentMode = props.mode === "comment";
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [mention, setMention] = useState(false);
  const [tableMenu, setTableMenu] = useState(false);
  const [emojiMenu, setEmojiMenu] = useState(false);
  const [templateMenu, setTemplateMenu] = useState(false);
  const [templates, setTemplates] = useState<EditorTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);
  const [templateQuery, setTemplateQuery] = useState("");
  const [query, setQuery] = useState("");

  function cancelTimer() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function flush(): Promise<boolean> {
    cancelTimer();
    if (inflight.current) return inflight.current;
    if (draft.current === saved.current) return Promise.resolve(true);
    const pending = (async () => {
      while (draft.current !== saved.current) {
        const current = latest.current;
        if (current.readOnly || current.mode === "comment") return false;
        const value = draft.current;
        setError("");
        setStatus("保存中…");
        try {
          await current.onSave(value, raw.current);
        } catch (reason) {
          cancelTimer();
          setError(reason instanceof Error ? reason.message : "描述保存失败。");
          setStatus("");
          return false;
        }
        raw.current = saved.current = value;
      }
      cancelTimer();
      setStatus("已保存");
      return true;
    })().finally(() => {
      if (inflight.current === pending) inflight.current = null;
    });
    inflight.current = pending;
    return pending;
  }

  async function submit() {
    const current = latest.current;
    const instance = editor.current;
    if (current.mode !== "comment" || current.readOnly || !instance || instance.isEmpty || uploading.current || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    setUploadError("");
    instance.setEditable(false, false);
    try {
      await current.onSubmit(JSON.stringify(fromEditorDocument(instance.getJSON())));
      if (!instance.isDestroyed) {
        instance.commands.clearContent(false);
        saved.current = draft.current = JSON.stringify(fromEditorDocument(instance.getJSON()));
        setHasContent(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "评论发送失败。");
    } finally {
      sendingRef.current = false;
      setSending(false);
      if (!instance.isDestroyed) instance.setEditable(!latest.current.readOnly, false);
    }
  }

  async function addFiles(files: File[]) {
    const upload = latest.current.onUpload;
    const instance = editor.current;
    if (!upload || !instance || uploading.current || sendingRef.current || latest.current.readOnly || !files.length) return;
    uploading.current = true;
    setUploadBusy(true);
    setUploadError("");
    try {
      for (const file of files) {
        const attachment = await upload(file);
        if (!attachment || instance.isDestroyed) break;
        const mime = (!attachment.type || attachment.type === "application/octet-stream") && file.type ? file.type : attachment.type;
        const type = mime.startsWith("image/") ? "image" : "file";
        instance.chain().focus().insertContent({
          type,
          attrs: type === "image" ? {
            "file-id": attachment.fileId, "data-file-type": mime, alt: attachment.name, title: attachment.name,
          } : {
            "file-id": attachment.fileId, "data-file-name": attachment.name,
            "data-file-type": mime, "data-file-size": attachment.size,
          },
        }).run();
      }
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "附件上传失败。");
    } finally {
      uploading.current = false;
      setUploadBusy(false);
    }
  }

  async function openTemplates(open: boolean) {
    setTemplateMenu(open);
    if (!open || !latest.current.onLoadTemplates) return;
    setTemplateQuery("");
    setTemplatesLoading(true);
    setTemplatesError(false);
    try {
      setTemplates(await latest.current.onLoadTemplates());
    } catch {
      setTemplatesError(true);
    } finally {
      setTemplatesLoading(false);
    }
  }

  function insertTemplate(template: EditorTemplate) {
    const instance = editor.current;
    if (!instance?.isEditable) return;
    try {
      const body = parseDocument(template.body);
      const content = toEditorDocument(body, instance.schema).content ?? [];
      if (content.length) instance.chain().focus().insertContent(content).run();
      setTemplateMenu(false);
    } catch {
      setUploadError("这个模板无法插入，请在 Huly 网页端使用。");
    }
  }

  useEffect(() => {
    if (!host.current) return;
    const makePreview = (kind: "image" | "video", fileId: string, source: string | null, name: string) => {
      const dom = document.createElement("span");
      dom.className = "hd-editor-media";
      dom.contentEditable = "false";
      const media = document.createElement(kind === "image" ? "img" : "video");
      if (media instanceof HTMLImageElement) { media.referrerPolicy = "no-referrer"; media.alt = name; }
      if (media instanceof HTMLVideoElement) { media.controls = true; media.preload = "metadata"; }
      const hint = document.createElement("span");
      hint.textContent = `正在加载 · ${name}`;
      dom.append(hint);
      let disposed = false;
      media.onerror = () => { hint.textContent = `无法预览 · ${name}`; dom.replaceChildren(hint); };
      const resolve = latest.current.onResolveImage;
      const lookup = fileId ? `${HULY_IMAGE_PREFIX}${encodeURIComponent(fileId)}` : source;
      void (async () => {
        const localUrl = lookup && resolve ? await resolve(lookup).catch(() => null) : null;
        const url = localUrl ?? (!fileId ? source : null);
        if (disposed) return;
        if (url) { media.src = url; dom.replaceChildren(media); }
        else hint.textContent = `无法预览 · ${name}`;
      })();
      return { dom, destroy() { disposed = true; } };
    };

    const instance = new Editor({
      element: host.current,
      extensions,
      editable: !latest.current.readOnly,
      editorProps: {
        attributes: { role: "textbox", "aria-label": latest.current.mode === "comment" ? "评论内容" : "任务描述", "aria-multiline": "true" },
        transformPastedHTML: (html) => DOMPurify.sanitize(html, { FORBID_TAGS: ["iframe", "object", "embed"] }),
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length || !latest.current.onUpload || latest.current.readOnly) return false;
          void addFiles(files);
          return true;
        },
        handleDrop: (_view, event, _slice, moved) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (moved || !files.length || !latest.current.onUpload || latest.current.readOnly) return false;
          void addFiles(files);
          return true;
        },
        nodeViews: {
          image: (node) => makePreview("image", String(node.attrs["file-id"] ?? ""), safeMediaUrl(node.attrs.src), String(node.attrs.alt || node.attrs.title || "图片")),
          file: (node) => {
            const name = String(node.attrs["data-file-name"] || "附件");
            const fileId = String(node.attrs["file-id"] ?? "");
            const type = String(node.attrs["data-file-type"] || "application/octet-stream");
            if (fileId && type.startsWith("video/")) return makePreview("video", fileId, null, name);
            const dom = document.createElement("span");
            dom.className = "hd-editor-file";
            dom.contentEditable = "false";
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `📎 ${name}`;
            button.title = `下载 ${name}`;
            if (fileId && latest.current.onDownload) {
              button.onclick = () => {
                setUploadError("");
                void latest.current.onDownload?.({
                  id: fileId, issueId: latest.current.issueId, fileId, name, type,
                  size: Number(node.attrs["data-file-size"]) || 0, lastModified: 0,
                }).catch(() => setUploadError("无法下载附件。"));
              };
              dom.append(button);
            } else dom.textContent = button.textContent;
            return { dom, stopEvent: (event) => event.target === button };
          },
          embed: () => {
            const dom = document.createElement("div");
            dom.contentEditable = "false";
            dom.textContent = "嵌入内容（在 Huly 网页端打开）";
            return { dom };
          },
        },
      },
      onUpdate: ({ editor: current }) => {
        draft.current = JSON.stringify(fromEditorDocument(current.getJSON()));
        if (latest.current.mode === "comment") {
          setHasContent(!current.isEmpty);
          return;
        }
        setStatus(draft.current === saved.current ? "" : "待保存");
        cancelTimer();
        if (draft.current !== saved.current) timer.current = setTimeout(() => void flush(), 1600);
      },
      onSelectionUpdate: ({ editor: current }) => setInTable(current.isActive("table")),
    });
    editor.current = instance;
    const flushRef = latest.current.mode === "comment" ? undefined : latest.current.flushRef;
    if (flushRef) flushRef.current = async () => {
      if (uploading.current) return false;
      return flush();
    };
    return () => {
      // Navigation through links in this page is guarded; still flush on external navigation.
      if (timer.current !== null) void flush();
      if (flushRef) flushRef.current = null;
      editor.current = null;
      if (loadedEditor.current === instance) loadedEditor.current = null;
      instance.destroy();
    };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    // Strict Mode can recreate the editor while keeping all React refs, so a
    // matching server snapshot is only loaded if this very instance has it.
    const alreadyLoaded = loadedEditor.current === instance;
    const hasLocalChanges = Boolean(inflight.current) || draft.current !== saved.current;
    if (alreadyLoaded && (hasLocalChanges || (props.markup !== undefined && props.markup === raw.current))) return;
    try {
      const content = parseDocument(hasLocalChanges ? draft.current : props.markup ?? props.markdown);
      instance.commands.setContent(toEditorDocument(content, instance.schema), false, undefined, { errorOnInvalidContent: true });
      loadedEditor.current = instance;
      if (!hasLocalChanges) {
        raw.current = props.markup;
        draft.current = saved.current = JSON.stringify(fromEditorDocument(instance.getJSON()));
        setError("");
      }
      instance.setEditable(!latest.current.readOnly, false);
      setReady(true);
    } catch {
      instance.setEditable(false, false);
      setReady(false);
      setError("这条描述包含当前客户端不支持的富文本内容。请在 Huly 网页端编辑，避免丢失内容。");
    }
  }, [props.markdown, props.markup]);

  useEffect(() => { editor.current?.setEditable(ready && !props.readOnly, false); }, [props.readOnly, ready]);

  const disabled = props.readOnly || !ready || sending;
  const iconButton = (label: string, icon: React.ReactNode, action?: () => void, blocked = false) => (
    <Button type="text" size="small" title={label} aria-label={label} icon={icon} disabled={disabled || blocked}
      onMouseDown={(event) => event.preventDefault()} onClick={action} />
  );

  return (
    <div className={commentMode ? "hd-rich-description hd-rich-comment" : "hd-rich-description"} onBlur={(event) => {
      if (!commentMode && !event.currentTarget.contains(event.relatedTarget)) void flush();
    }} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "Enter" || (!commentMode && event.key.toLowerCase() === "s"))) {
        event.preventDefault();
        if (commentMode) void submit();
        else void flush();
      }
    }}>
      <div ref={host} className="hd-rich-description-body" hidden={!ready} />
      {!ready && error && props.markdown.trim() ? (
        <div className="hd-detail-desc-box"><MarkdownView text={props.markdown} resolveImage={props.onResolveImage} /></div>
      ) : null}
      {!props.readOnly ? (
        <div className="hd-rich-description-footer">
          <div role="group" aria-label={commentMode ? "评论工具" : "描述工具"}>
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addFiles(files);
            }} />
            <input ref={videoInput} type="file" accept="video/*" hidden onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addFiles(files);
            }} />
            {iconButton("添加附件", <PaperClipOutlined />, () => fileInput.current?.click(), !props.onUpload || uploadBusy)}
            {iconButton("上传视频", <VideoCameraOutlined />, () => videoInput.current?.click(), !props.onUpload || uploadBusy)}
            <span className="hd-rich-tool-divider" />
            {!commentMode ? <><Popover trigger="click" placement="bottomLeft" open={tableMenu} onOpenChange={setTableMenu} content={<Space direction="vertical" size={4} onClick={() => setTableMenu(false)}>
              {inTable ? <>
                <Button type="text" size="small" onClick={() => editor.current?.chain().focus().addRowAfter().run()}>添加行</Button>
                <Button type="text" size="small" onClick={() => editor.current?.chain().focus().addColumnAfter().run()}>添加列</Button>
                <Button type="text" size="small" onClick={() => editor.current?.chain().focus().deleteRow().run()}>删除行</Button>
                <Button type="text" size="small" onClick={() => editor.current?.chain().focus().deleteColumn().run()}>删除列</Button>
                <Button type="text" size="small" danger onClick={() => editor.current?.chain().focus().deleteTable().run()}>删除表格</Button>
              </> : [2, 3, 4].map((size) => <Button key={size} type="text" size="small"
                onClick={() => editor.current?.chain().focus().insertTable({ rows: size, cols: size, withHeaderRow: true }).run()}>{size} × {size}</Button>)}
            </Space>}>
              {iconButton("插入表格", <TableOutlined />)}
            </Popover>
            <span className="hd-rich-tool-divider" /></> : null}
            <Popover trigger="click" placement="bottomLeft" open={mention} onOpenChange={setMention} content={
              <div className="hd-rich-mention-menu">
                <Input autoFocus size="small" aria-label="搜索成员" placeholder="搜索成员" value={query} onChange={(event) => setQuery(event.target.value)} />
                {props.people.filter((person) => person.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 10).map((person) => (
                  <Button key={person.id} type="text" onClick={() => {
                    editor.current?.chain().focus().insertContent([
                      { type: "reference", attrs: { id: person.id, objectclass: "contact:class:Person", label: person.name } },
                      { type: "text", text: " " },
                    ]).run();
                    setMention(false);
                    setQuery("");
                  }}>{person.name}</Button>
                ))}
              </div>
            }>
              {iconButton("提及成员", <span aria-hidden="true">@</span>)}
            </Popover>
            <Popover trigger="click" placement="bottomLeft" open={emojiMenu} onOpenChange={setEmojiMenu} content={<div className="hd-rich-emoji-menu">
              {emojis.map((emoji) => <Button key={emoji} type="text" size="small" aria-label={`插入 ${emoji}`} onClick={() => {
                editor.current?.chain().focus().insertContent({ type: "emoji", attrs: { emoji, kind: "unicode" } }).run();
                setEmojiMenu(false);
              }}>{emoji}</Button>)}
            </div>}>
              {iconButton("插入表情", <SmileOutlined />)}
            </Popover>
            <span className="hd-rich-tool-divider" />
            <Popover trigger="click" placement="bottomLeft" open={templateMenu} onOpenChange={(open) => void openTemplates(open)} content={
              <div className="hd-rich-mention-menu">
                <Input size="small" aria-label="搜索模板" placeholder="搜索模板" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} />
                {templatesLoading ? <span role="status">正在加载模板…</span> : templatesError ? <Button type="link" onClick={() => void openTemplates(true)}>模板未能加载，重试</Button>
                  : !templates.length ? <span>工作区没有可用的文本模板。</span>
                  : templates.filter((item) => item.title.toLowerCase().includes(templateQuery.trim().toLowerCase())).map((item) =>
                    <Button key={item.id} type="text" onClick={() => insertTemplate(item)}>{item.title}</Button>)}
              </div>
            }>
              {iconButton("插入模板", <FileAddOutlined />, undefined, !props.onLoadTemplates)}
            </Popover>
          </div>
          {commentMode ? <div className="hd-comment-send">
            {uploadBusy ? <span className="hd-rich-save-status" role="status">正在上传…</span> : null}
            <Button type="text" title="发表评论（⌘/Ctrl + Enter）" aria-label="发表评论" icon={<SendOutlined />}
              loading={sending} disabled={!hasContent || disabled || uploadBusy} onClick={() => void submit()} />
          </div> : <span className="hd-rich-save-status" role="status">{uploadBusy ? "正在上传…" : status}</span>}
        </div>
      ) : null}
      {error || uploadError ? <div className="hd-rich-error" role="alert">
        {error || uploadError}{ready && error && !props.readOnly && !commentMode ? <Button size="small" type="link" onClick={() => void flush()}>重试保存</Button> : null}
      </div> : null}
    </div>
  );
}

function parseDocument(body: string): JSONContent {
  const raw = body.trim();
  if (raw.startsWith("{")) return JSON.parse(raw) as JSONContent;
  if (/^<(?:p|div|br|img|h[1-6]|ul|ol|table|blockquote|pre|span)\b/i.test(raw)) {
    return generateJSON(DOMPurify.sanitize(raw, { FORBID_TAGS: ["iframe", "object", "embed"] }), extensions);
  }
  return markdownToMarkup(body) as JSONContent;
}
