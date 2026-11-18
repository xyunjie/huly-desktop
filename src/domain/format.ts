export function projectHeading(identifier: string, name: string): string {
  const id = identifier.trim();
  const title = name.trim();
  if (!title) return id || "项目";
  if (!id || title.startsWith(id)) return title;
  return `${id} ${title}`;
}

export function formatDue(value: number | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDueInput(value: string): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

export function dueInputValue(value: number | null): string {
  if (!value) return "";
  return formatDue(value) === "—" ? "" : formatDue(value);
}

export function formatCommentTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const clock = `${hours}:${minutes}`;
  const startOf = (value: number) => {
    const current = new Date(value);
    return new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  };
  const day = 24 * 60 * 60 * 1000;
  const delta = startOf(now) - startOf(timestamp);
  if (delta === 0) return `今天 ${clock}`;
  if (delta === day) return `昨天 ${clock}`;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const dayOfMonth = `${date.getDate()}`.padStart(2, "0");
  return `${month}-${dayOfMonth} ${clock}`;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = Array.from(trimmed)[0] ?? "?";
  return first.toUpperCase();
}

export function avatarColor(id: string): string {
  const palette = ["#1868db", "#2f9e44", "#7048e8", "#e8590c", "#0c8599", "#c2255c"];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length] ?? palette[0];
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded}h`;
}
