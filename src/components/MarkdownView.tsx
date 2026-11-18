import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { useEffect, useMemo, useRef } from "react";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// 1x1 transparent gif placeholder so StrictMode double-mount never loses rawSrc or flashes a broken icon.
const PLACEHOLDER_IMG =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
});

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(md.render(text), { USE_PROFILES: { html: true } });
}

function replaceWithFallbackLink(img: HTMLImageElement, rawSrc: string) {
  const link = document.createElement("a");
  link.href = rawSrc;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `[图片] ${img.alt || "附件"}`;
  img.replaceWith(link);
}

function needsAuthResolution(src: string): boolean {
  return (
    src.startsWith("https://huly-file.invalid/") ||
    src.startsWith("/files") ||
    src.includes("/files?workspace=") ||
    src.includes("/files/")
  );
}

export function MarkdownView({
  text,
  resolveImage,
}: {
  text: string;
  resolveImage?: (src: string) => Promise<string | null>;
}) {
  const html = useMemo(() => renderMarkdown(text.replace(/\r\n/g, "\n")), [text]);
  const ref = useRef<HTMLDivElement>(null);
  const resolveImageRef = useRef(resolveImage);
  resolveImageRef.current = resolveImage;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let disposed = false;
    const tried = new WeakSet<HTMLImageElement>();

    const tryResolve = async (img: HTMLImageElement, rawSrc: string) => {
      if (tried.has(img)) return;
      tried.add(img);
      const resolver = resolveImageRef.current;
      if (!resolver) {
        replaceWithFallbackLink(img, rawSrc);
        return;
      }
      const resolved = await resolver(rawSrc).catch(() => null);
      if (disposed || !img.isConnected) return;
      if (resolved) {
        img.src = resolved;
      } else {
        replaceWithFallbackLink(img, rawSrc);
      }
    };

    if (resolveImageRef.current) {
      const images = Array.from(root.querySelectorAll("img"));
      for (const img of images) {
        const rawSrc = img.dataset.rawSrc || img.getAttribute("src") || "";
        if (!rawSrc || rawSrc.startsWith("blob:") || rawSrc === PLACEHOLDER_IMG) continue;
        if (needsAuthResolution(rawSrc)) {
          img.dataset.rawSrc = rawSrc;
          if (img.src !== PLACEHOLDER_IMG && !img.src.startsWith("blob:")) {
            img.src = PLACEHOLDER_IMG;
          }
          void tryResolve(img, rawSrc);
        }
      }
    }

    const onError = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.tagName !== "IMG") return;
      const img = target as HTMLImageElement;
      const rawSrc = img.dataset.rawSrc || img.getAttribute("src") || "";
      if (!rawSrc || rawSrc === PLACEHOLDER_IMG) return;
      if (resolveImageRef.current && !tried.has(img)) {
        void tryResolve(img, rawSrc);
      } else {
        replaceWithFallbackLink(img, rawSrc);
      }
    };

    root.addEventListener("error", onError, true);
    return () => {
      disposed = true;
      root.removeEventListener("error", onError, true);
    };
  }, [html]);

  if (!text.trim()) return <p style={{ color: "#8c8c8c" }}>还没有描述。</p>;
  return (
    <div
      ref={ref}
      className="hd-markdown"
      style={{ fontSize: 13, lineHeight: 1.7, wordBreak: "break-word" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
