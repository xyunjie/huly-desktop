import { markupToText } from "@hcengineering/text-core";
import { descriptionIsRef } from "./mapping";
import { isInlineMarkupJson } from "./markup";

const unavailable = "activity:string:ValueTooLarge";

export function hasActivityDescriptionVersion(value?: string): value is string {
  return value !== undefined && value !== unavailable;
}

export function inlineDescriptionText(value?: string): string | undefined {
  if (!hasActivityDescriptionVersion(value) || descriptionIsRef(value)) return undefined;
  if (!isInlineMarkupJson(value)) return value;
  try {
    // A storage error or malformed JSON must not be mistaken for empty text.
    const parsed = JSON.parse(value) as { type?: string } | null;
    if (parsed?.type === "doc") return markupToText(value.trim());
  } catch {
    /* old snapshots are sometimes unavailable */
  }
  return undefined;
}

export async function resolveActivityDescription(value?: string, readSnapshot?: (ref: string) => Promise<string>): Promise<string | undefined> {
  if (!value || value === unavailable || !descriptionIsRef(value) || !readSnapshot) return inlineDescriptionText(value);
  try {
    const snapshot = await readSnapshot(value);
    return isInlineMarkupJson(snapshot) ? inlineDescriptionText(snapshot) : undefined;
  } catch {
    return undefined;
  }
}
