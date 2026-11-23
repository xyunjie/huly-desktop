import { DeleteOutlined, DownloadOutlined, FileOutlined, PaperClipOutlined, PictureOutlined, PlayCircleOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Modal, Popconfirm, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { ImageViewer } from "@/components/ImageViewer";
import { HULY_IMAGE_PREFIX } from "@/data/huly/markup";
import { formatFileSize } from "@/domain/format";
import type { Attachment } from "@/domain/types";

type ResolveMedia = (src: string) => Promise<string | null>;

type CardProps = {
  attachments: Attachment[];
  onDownload?: (attachment: Attachment) => Promise<void>;
  onDelete?: (attachmentId: string) => Promise<void>;
  resolveMedia?: ResolveMedia;
  label?: string;
};

export function IssueAttachments({ attachments, readOnly, onUpload, onDownload, onDelete, resolveMedia }: CardProps & {
  readOnly: boolean;
  onUpload?: (file: File) => Promise<Attachment | void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="hd-detail-section" aria-label="附件">
      <div className="hd-detail-section-head">
        <span className="hd-attachment-heading">
          <PaperClipOutlined />
          <Typography.Text strong style={{ fontSize: 14 }}>附件</Typography.Text>
          <span className="hd-group-count">{attachments.length}</span>
        </span>
        {!readOnly && onUpload ? (
          <>
            <input ref={fileInput} type="file" hidden onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file || uploading) return;
              setUploading(true);
              setError(null);
              try {
                await onUpload(file);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "附件上传失败。");
              } finally {
                setUploading(false);
              }
            }} />
            <Button size="small" icon={<UploadOutlined />} loading={uploading} onClick={() => fileInput.current?.click()}>
              上传附件
            </Button>
          </>
        ) : null}
      </div>
      {error ? <Typography.Paragraph type="danger" role="alert">{error}</Typography.Paragraph> : null}
      {attachments.length === 0 ? <Typography.Text type="secondary">没有附件。</Typography.Text> :
        <AttachmentCards attachments={attachments} onDownload={onDownload} onDelete={readOnly ? undefined : onDelete} resolveMedia={resolveMedia} />}
    </section>
  );
}

export function AttachmentCards({ attachments, onDownload, onDelete, resolveMedia, label = "附件列表" }: CardProps) {
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback);
    }
  }

  return <>
      {error && !preview ? <Typography.Paragraph type="danger" role="alert">{error}</Typography.Paragraph> : null}
      <ul className="hd-attachment-grid" aria-label={label}>
          {attachments.map((attachment) => (
            <li key={attachment.id} className="hd-attachment-card">
              <button type="button" className="hd-attachment-open" aria-label={`预览 ${attachment.name}`} onClick={(event) => {
                previewTrigger.current = event.currentTarget;
                setError(null);
                setPreview(attachment);
              }}>
                <AttachmentMedia attachment={attachment} resolveMedia={resolveMedia} />
                <span className="hd-attachment-info">
                  <span className="hd-attachment-name" title={attachment.name}>{attachment.name}</span>
                  <span className="hd-attachment-size">{formatFileSize(attachment.size)}</span>
                </span>
              </button>
              {onDownload ? (
                <Button className="hd-attachment-action" type="text" size="small" icon={<DownloadOutlined />} title="下载" aria-label={`下载 ${attachment.name}`}
                  onClick={() => void run(() => onDownload(attachment), "附件下载失败。")} />
              ) : null}
              {onDelete ? (
                <Popconfirm title="确认删除该附件？" okText="删除" cancelText="取消"
                  onConfirm={() => run(() => onDelete(attachment.id), "附件删除失败。")}>
                  <Button className="hd-attachment-action" type="text" size="small" icon={<DeleteOutlined />} danger title="删除" aria-label={`删除 ${attachment.name}`} />
                </Popconfirm>
              ) : null}
            </li>
          ))}
      </ul>
      {preview ? (
        <AttachmentMedia key={preview.id} attachment={preview} resolveMedia={resolveMedia} viewer={{
          close: () => { setPreview(null); previewTrigger.current?.focus(); },
          download: onDownload && (() => void run(() => onDownload(preview), "附件下载失败。")),
          error,
        }} />
      ) : null}
  </>;
}

function mediaKind({ type, name }: Attachment) {
  const mime = type.toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (!mime || mime === "application/octet-stream") {
    if (/\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name)) return "image";
    if (/\.(m4v|mov|mp4|webm)$/i.test(name)) return "video";
  }
  return null;
}

function AttachmentMedia({ attachment, resolveMedia, viewer }: {
  attachment: Attachment;
  resolveMedia?: ResolveMedia;
  viewer?: { close: () => void; download?: () => void; error: string | null };
}) {
  const kind = mediaKind(attachment);
  const thumbnail = !viewer;
  const frame = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>();
  const { blobUrl, fileId, name } = attachment;

  useEffect(() => {
    if (!kind || (thumbnail && kind !== "image")) return;
    let active = true;
    const load = async () => {
      const resolved = blobUrl || (fileId && resolveMedia
        ? await resolveMedia(`${HULY_IMAGE_PREFIX}${encodeURIComponent(fileId)}`).catch(() => null) : null);
      if (active) setUrl(resolved);
    };
    let observer: IntersectionObserver | undefined;
    if (thumbnail && frame.current && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        void load();
      });
      observer.observe(frame.current);
    } else void load();
    return () => { active = false; observer?.disconnect(); };
  }, [blobUrl, fileId, kind, resolveMedia, thumbnail]);

  if (!viewer) return (
    <span ref={frame} className="hd-attachment-thumbnail" aria-hidden="true">
      {url ? <img src={url} alt="" onError={() => setUrl(null)} /> :
        kind === "image" ? <PictureOutlined /> : kind === "video" ? <PlayCircleOutlined /> : <FileOutlined />}
    </span>
  );
  const download = viewer.download ? <Button icon={<DownloadOutlined />} onClick={viewer.download}>下载附件</Button> : null;
  if (kind === "image") return (
    <ImageViewer src={url} name={name} onClose={viewer.close} unavailableText="无法预览此附件，请下载查看。"
      actions={<>
        {viewer.error ? <span role="alert">{viewer.error}</span> : null}
        {download}
      </>} />
  );

  const message = !kind ? "此文件类型不支持预览，请下载查看。" :
    url === undefined ? "正在加载预览…" : "无法预览此附件，请下载查看。";
  return (
    <Modal open title={name} width="min(880px, calc(100vw - 32px))" onCancel={viewer.close} footer={download}>
      {kind === "video" && url ? (
        <video className="hd-attachment-preview-media" src={url} aria-label={name} controls playsInline onError={() => setUrl(null)} />
      ) : <p className="hd-attachment-preview-hint" role="status">{message}</p>}
      {viewer.error ? <Typography.Paragraph type="danger" role="alert">{viewer.error}</Typography.Paragraph> : null}
    </Modal>
  );
}
