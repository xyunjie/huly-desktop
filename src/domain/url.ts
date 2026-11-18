export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("请填写服务器地址。");
  }
  if (trimmed.includes("@")) {
    throw new Error("地址里不要写账号或密码，请只填 https://主机:端口。");
  }
  let withProtocol = trimmed;
  if (!/^https?:\/\//i.test(withProtocol)) {
    throw new Error("服务器地址需要以 http:// 或 https:// 开头。");
  }
  withProtocol = withProtocol.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("服务器地址无法解析。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务器地址需要以 http:// 或 https:// 开头。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("地址里不要写账号或密码，请只填 https://主机:端口。");
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

export function configJsonUrl(serverUrl: string): string {
  return `${normalizeServerUrl(serverUrl)}/config.json`;
}

export function normalizeWorkspaceSlug(input: string): string {
  let slug = input.trim();
  if (!slug) {
    throw new Error("请填写工作区标识。");
  }
  const marker = "/workbench/";
  const index = slug.indexOf(marker);
  if (index >= 0) {
    slug = slug.slice(index + marker.length);
  }
  slug = slug.split(/[/?#]/)[0]?.trim() ?? "";
  if (!slug) {
    throw new Error("工作区标识无效。请填写 /workbench/ 后面的那段文字，不是显示名。");
  }
  return slug;
}

export function workspaceDisplayName(slug: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim();
  return slug;
}
