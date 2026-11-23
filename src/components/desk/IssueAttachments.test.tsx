import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Attachment } from "@/domain/types";
import { IssueAttachments } from "./IssueAttachments";

const image: Attachment = {
  id: "image", issueId: "issue-1", fileId: "blob-image", name: "image.png",
  type: "image/png", size: 2048, lastModified: 0,
};

it("opens the image viewer, zooms with the wheel, and keeps the download fallback", async () => {
  const resolveMedia = vi.fn(async () => "blob:image-preview");
  const onDownload = vi.fn(async () => undefined);
  render(<IssueAttachments attachments={[image]} readOnly resolveMedia={resolveMedia} onDownload={onDownload} />);
  const card = screen.getByLabelText("预览 image.png");
  await waitFor(() => expect(card.querySelector("img")).toHaveAttribute("src", "blob:image-preview"));
  expect(card).toHaveTextContent("2.0 KB");
  expect(resolveMedia).toHaveBeenCalledWith("https://huly-file.invalid/blob-image");
  fireEvent.click(card);

  const dialog = await screen.findByRole("dialog", { name: "image.png" });
  const preview = await within(dialog).findByAltText("image.png");
  expect(preview).toHaveAttribute("src", "blob:image-preview");
  fireEvent.wheel(preview, { deltaY: -100, clientX: 160, clientY: 120 });
  await waitFor(() => expect(preview.style.transform).toContain("scale3d(1.5, 1.5, 1)"));
  fireEvent.wheel(preview, { deltaY: 100, clientX: 160, clientY: 120 });
  await waitFor(() => expect(preview.style.transform).toContain("scale3d(1, 1, 1)"));

  fireEvent.error(preview);
  expect(within(dialog).getByText("无法预览此附件，请下载查看。")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByText("下载附件"));
  expect(onDownload).toHaveBeenCalledWith(image);
  fireEvent.keyDown(window, { key: "Escape", keyCode: 27 });
  expect(dialog).not.toBeInTheDocument();
  expect(card).toHaveFocus();
});
