import type { Issue, Person, Project, ProjectBundle, Status, WorkspaceMember } from "./types";

export interface OfflineWorkspaceSnapshot {
  savedAt: number;
  projects: Project[];
  people: Person[];
  members: WorkspaceMember[];
  bundles: Record<string, ProjectBundle>;
  mine: Issue[];
  mineStatuses?: Status[];
}

const PREFIX = "huly-desk:offline-cache:v1:";

function cacheKey(serverUrl: string, workspace: string): string {
  return `${PREFIX}${serverUrl.trim().toLowerCase()}::${workspace.trim()}`;
}

export function loadOfflineSnapshot(serverUrl: string, workspace: string): OfflineWorkspaceSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(serverUrl, workspace));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineWorkspaceSnapshot>;
    if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.people)) return null;
    return {
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
      projects: parsed.projects,
      people: parsed.people,
      members: Array.isArray(parsed.members) ? parsed.members : [],
      bundles: parsed.bundles && typeof parsed.bundles === "object" ? parsed.bundles : {},
      mine: Array.isArray(parsed.mine) ? parsed.mine : [],
      mineStatuses: Array.isArray(parsed.mineStatuses) ? parsed.mineStatuses : undefined,
    };
  } catch {
    return null;
  }
}

export function saveOfflineSnapshot(
  serverUrl: string,
  workspace: string,
  snapshot: OfflineWorkspaceSnapshot,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(cacheKey(serverUrl, workspace), JSON.stringify(snapshot));
  } catch {
    /* Ignore quota / private mode storage errors */
  }
}

export function clearOfflineSnapshot(serverUrl: string, workspace: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(cacheKey(serverUrl, workspace));
  } catch {
    /* Ignore storage errors */
  }
}
