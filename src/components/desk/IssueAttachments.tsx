import { DeleteOutlined, DownloadOutlined, FileOutlined, PaperClipOutlined, PictureOutlined, PlayCircleOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Modal, Popconfirm, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { HULY_IMAGE_PREFIX } from "@/data/huly/markup";
import { formatFileSize } from "@/domain/format";
import type { Attachment } from "@/domain/types";

type ResolveMedia = (src: string) => Promise<string | null>;

export function IssueAttachments({ attachments, readOnly, onUpload, onDownload, onDelete, resolveMedia }: {
  attachments: Attachment[];
  readOnly: boolean;
  onUpload?: (file: File) => Promise<Attachment | void>;
  onDownload?: (attachment: Attachment) => Promise<void>;
  onDelete?: (attachmentId: string) => Promise<void>;
  resolveMedia?: ResolveMedia;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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
              await run(() => onUpload(file), "附件上传失败。");
              setUploading(false);
            }} />
            <Button size="small" icon={<UploadOutlined />} loading={uploading} onClick={() => fileInput.current?.click()}>
              上传附件
            </Button>
          </>
        ) : null}
      </div>
      {error && !preview ? <Typography.Paragraph type="danger" role="alert">{error}</Typography.Paragraph> : null}
      {attachments.length === 0 ? <Typography.Text type="secondary">没有附件。</Typography.Text> : (
        <ul className="hd-attachment-grid" aria-label="附件列表">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="hd-attachment-card">
              <button type="button" className="hd-attachment-open" aria-label={`预览 ${attachment.name}`} onClick={() => {
                setError(null);
                setPreview(attachment);
              }}>
                <AttachmentMedia attachment={attachment} resolveMedia={resolveMedia} thumbnail />
                <span className="hd-attachment-info">
                  <span className="hd-attachment-name" title={attachment.name}>{attachment.name}</span>
                  <span className="hd-attachment-size">{formatFileSize(attachment.size)}</span>
                </span>
              </button>
              {onDownload ? (
                <Button className="hd-attachment-action" type="text" size="small" icon={<DownloadOutlined />} title="下载" aria-label={`下载 ${attachment.name}`}
                  onClick={() => void run(() => onDownload(attachment), "附件下载失败。")} />
              ) : null}
              {!readOnly && onDelete ? (
                <Popconfirm title="确认删除该附件？" okText="删除" cancelText="取消"
                  onConfirm={() => run(() => onDelete(attachment.id), "附件删除失败。")}>
                  <Button className="hd-attachment-action" type="text" size="small" icon={<DeleteOutlined />} danger title="删除" aria-label={`删除 ${attachment.name}`} />
                </Popconfirm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal open={preview !== null} title={preview?.name} width="min(880px, calc(100vw - 32px))" destroyOnHidden
        onCancel={() => setPreview(null)} footer={preview && onDownload ? (
          <Button icon={<DownloadOutlined />} onClick={() => void run(() => onDownload(preview), "附件下载失败。")}>下载附件</Button>
        ) : null}>
        {preview ? <AttachmentMedia key={preview.id} attachment={preview} resolveMedia={resolveMedia} /> : null}
        {error ? <Typography.Paragraph type="danger" role="alert">{error}</Typography.Paragraph> : null}
      </Modal>
    </section>
  );
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

function AttachmentMedia({ attachment, resolveMedia, thumbnail = false }: {
  attachment: Attachment;
  resolveMedia?: ResolveMedia;
  thumbnail?: boolean;
}) {
  const kind = mediaKind(attachment);
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

  if (thumbnail) return (
    <span ref={frame} className="hd-attachment-thumbnail" aria-hidden="true">
      {url ? <img src={url} alt="" onError={() => setUrl(null)} /> :
        kind === "image" ? <PictureOutlined /> : kind === "video" ? <PlayCircleOutlined /> : <FileOutlined />}
    </span>
  );
  if (!kind) return <p className="hd-attachment-preview-hint">此文件类型不支持预览，请下载查看。</p>;
  if (url === undefined) return <p className="hd-attachment-preview-hint" role="status">正在加载预览…</p>;
  if (!url) return <p className="hd-attachment-preview-hint" role="status">无法预览此附件，请下载查看。</p>;
  return kind === "image" ? (
    <img className="hd-attachment-preview-media" src={url} alt={name} onError={() => setUrl(null)} />
  ) : (
    <video className="hd-attachment-preview-media" src={url} aria-label={name} controls playsInline onError={() => setUrl(null)} />
  );
}
