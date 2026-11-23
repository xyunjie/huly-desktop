import { CloseOutlined } from "@ant-design/icons";
import { Button, Image } from "antd";
import { cloneElement, useState, type ReactElement, type ReactNode } from "react";

export type OpenImageViewer = (src: string, name: string, trigger: HTMLElement) => void;

export function ImageViewer({ src, name, onClose, actions, unavailableText = "无法预览此图片。" }: {
  src: string | null | undefined;
  name: string;
  onClose: () => void;
  actions?: ReactNode;
  unavailableText?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageSrc = src === failedSrc ? null : src;

  return (
    <Image.PreviewGroup items={[{ src: imageSrc ?? undefined, draggable: false, referrerPolicy: "no-referrer" }]} preview={{
      visible: true,
      onVisibleChange: (visible) => { if (!visible) onClose(); },
      title: name,
      closeIcon: null,
      rootClassName: "hd-image-viewer",
      classNames: { header: "hd-image-viewer-title", footer: "hd-image-viewer-actions" },
      styles: { mask: { background: "rgba(8, 15, 26, 0.94)" } },
      footer: <>
        {actions}
        <Button icon={<CloseOutlined />} aria-label="关闭预览" onClick={onClose} />
      </>,
      toolbarRender: (toolbar) => imageSrc ? toolbar : null,
      countRender: () => imageSrc ? "滚轮缩放 · 拖动查看" : null,
      imageRender: (node) => imageSrc
        ? cloneElement(node as ReactElement<{ alt: string; onError: () => void }>, { alt: name, onError: () => setFailedSrc(imageSrc) })
        : <p className="hd-image-viewer-hint" role="status">{imageSrc === undefined ? "正在加载预览…" : unavailableText}</p>,
    }} />
  );
}
