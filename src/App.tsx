import { BellOutlined, PlusOutlined } from "@ant-design/icons";
import { Badge, Button, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { DeskScreen } from "@/components/desk/DeskScreen";
import type { DeskNav } from "@/components/desk/Sidebar";
import { LoginScreen } from "@/components/LoginScreen";
import { WorkspacePicker } from "@/components/WorkspacePicker";
import { WindowFrame } from "@/components/WindowFrame";
import { MockDeskClient } from "@/data/mock/client";
import { HulyDeskClient } from "@/data/huly/client";
import type { DeskClient } from "@/data/client";
import { descriptionIsRef, mapStatus } from "@/data/huly/mapping";
import { loadOfflineSnapshot, saveOfflineSnapshot } from "@/domain/cache";
import { connectMcpBridge } from "@/mcp/bridge";
import { explainConnectionError, initialDataMode, validateLogin, type LoginDraft } from "@/domain/login";
import { redactSecrets, type StoredSession } from "@/domain/secrets";
import { ACCOUNT_EXPIRED_MESSAGE, isAccountTokenInvalid, planSessionLaunch } from "@/domain/session";
import { canManageWorkspaceMembers, parseWorkspaceRole, type WorkspaceRole } from "@/domain/roles";
import { RequestGate } from "@/domain/stale";
import {
  EMPTY_FILTERS,
  type AccountSession,
  type ActivityItem,
  type Attachment,
  type Comment,
  type Component,
  type CreateIssueInput,
  type InboxNotification,
  type Issue,
  type IssueFilters,
  type IssuePatch,
  type IssueTemplate,
  type Label,
  type Milestone,
  type Person,
  type Project,
  type ProjectBundle,
  type ProjectPatch,
  type Session,
  type Status,
  type WorkspaceMember,
} from "@/domain/types";
import {
  clearStoredSession,
  loadStoredCa,
  loadStoredSession,
  probeServer,
  saveStoredCa,
  saveStoredSession,
} from "@/platform/runtime";

interface DeskModel {
  session: Session;
  projects: Project[];
  people: Person[];
  members: WorkspaceMember[];
  statuses: Status[];
  milestones: Milestone[];
  components: Component[];
  labels: Label[];
  issues: Issue[];
  mine: Issue[];
  mineStatuses: Status[];
  comments: Comment[];
  activity: ActivityItem[];
  activityLoading?: boolean;
  activityError?: string | null;
  attachments: Attachment[];
  templates: IssueTemplate[];
  projectId: string | null;
  nav: DeskNav;
  view: "list" | "board";
  filters: IssueFilters;
  mineFilters: IssueFilters;
  selectedId: string | null;
  detail: "side" | "wide" | "closed";
  commentWrite: boolean;
  loading: boolean;
  refreshing: boolean;
  descriptionLoading: boolean;
}

interface WorkspaceCache {
  projects: Project[];
  people: Person[];
  members: WorkspaceMember[];
}

export default function App() {
  const clientRef = useRef<DeskClient | null>(null);
  const resolveImage = useCallback((src: string) => clientRef.current?.resolveImageSrc?.(src) ?? Promise.resolve(null), []);
  const mcpWorkspace = useRef<{ client: DeskClient } | null>(null);
  const savedRef = useRef<StoredSession | null>(null);
  const autoTried = useRef(false);
  const [phase, setPhase] = useState<"login" | "pick-workspace" | "desk">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialCa, setInitialCa] = useState("");
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [desk, setDesk] = useState<DeskModel | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [offlineReadOnly, setOfflineReadOnly] = useState(false);
  const [offlineSavedAt, setOfflineSavedAt] = useState<number | null>(null);
  const [addMemberProject, setAddMemberProject] = useState<Project | null>(null);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const mockDefault = initialDataMode() === "mock";
  const navGate = useRef(new RequestGate());
  const detailGen = useRef(0);
  const timelineGate = useRef(new RequestGate());
  const notificationsGate = useRef(new RequestGate());
  const lastNotificationRequest = useRef(0);
  const projectCache = useRef(new Map<string, ProjectBundle>());
  const templateCache = useRef(new Map<string, IssueTemplate[]>());
  const mineCache = useRef<({ userId: string } & Awaited<ReturnType<DeskClient["listAssigned"]>>) | null>(null);
  const workspaceCache = useRef(new Map<string, WorkspaceCache>());
  const deskRef = useRef<DeskModel | null>(null);
  deskRef.current = desk;

  useEffect(() => {
    void loadStoredCa().then(setInitialCa);
    if (mockDefault) return;
    void loadStoredSession().then((saved) => {
      if (!saved) return;
      savedRef.current = saved;
      if (!autoTried.current) {
        autoTried.current = true;
        void restoreSession(saved);
      }
    });
  }, [mockDefault]);

  // Local MCP server: forward AI tool calls to the live client.
  useEffect(() => connectMcpBridge(() => mcpWorkspace.current), []);

  useEffect(() => {
    const debug = {
      setMockRole(role: string) {
        const client = clientRef.current;
        const next = parseWorkspaceRole(role);
        if (client instanceof MockDeskClient) client.setActingRole(next);
        setDesk((current) => {
          if (!current) return current;
          const nav = current.nav === "members" && !canManageWorkspaceMembers(next) ? "projects" : current.nav;
          return { ...current, nav, session: { ...current.session, role: next } };
        });
      },
    };
    (window as unknown as { __hulyDesk: typeof debug }).__hulyDesk = debug;
    return () => {
      delete (window as unknown as { __hulyDesk?: typeof debug }).__hulyDesk;
    };
  }, []);

  useEffect(() => {
    if (phase !== "desk" || !desk?.session) return;
    const client = clientRef.current;
    if (!client) return;

    const silentSync = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      const current = deskRef.current;
      if (!current) return;
      if (current.nav === "project" && current.projectId) {
        const activeId = current.detail !== "closed" ? current.selectedId : null;
        void refreshProject(current.projectId, navGate.current.current(), activeId, true);
      } else if (current.nav === "mine" && !current.loading && !current.refreshing) {
        void refreshMine(navGate.current.current(), true);
      }
      void refreshNotifications(true);
    };

    const unsub = client.subscribe?.(() => silentSync());
    const timer = setInterval(silentSync, 25000);
    const onOnline = () => {
      setOfflineReadOnly(false);
      silentSync();
    };
    const onOffline = () => {
      setOfflineReadOnly(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      unsub?.();
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [phase, desk?.session.workspace]);

  function persistOfflineCache(session: Session) {
    const bundles: Record<string, ProjectBundle> = {};
    for (const [id, bundle] of projectCache.current.entries()) {
      bundles[id] = bundle;
    }
    const cachedWs = workspaceCache.current.get(session.workspace);
    const snapshot = {
      savedAt: Date.now(),
      projects: cachedWs?.projects ?? deskRef.current?.projects ?? [],
      people: cachedWs?.people ?? deskRef.current?.people ?? [],
      members: cachedWs?.members ?? deskRef.current?.members ?? [],
      bundles,
      mine: mineCache.current?.issues ?? deskRef.current?.mine ?? [],
      mineStatuses: mineCache.current?.statuses ?? deskRef.current?.mineStatuses ?? [],
    };
    saveOfflineSnapshot(session.serverUrl, session.workspace, snapshot);
    setOfflineSavedAt(snapshot.savedAt);
  }

  async function applyCertificate(cert: { caPem: string; trustServerCert: boolean }, serverUrl: string) {
    if (cert.caPem.trim()) {
      await saveStoredCa(cert.caPem);
    }
    if (cert.caPem.trim() || cert.trustServerCert) {
      await probeServer(serverUrl, cert);
    }
  }

  async function onSubmit(draft: LoginDraft, cert: { caPem: string; trustServerCert: boolean }) {
    setBusy(true);
    setError(null);
    const checked = validateLogin({ ...draft, mock: draft.mock || mockDefault });
    if (!checked.ok) {
      setError(checked.message);
      setBusy(false);
      return;
    }
    try {
      if (!draft.mock && checked.value.kind !== "mock") {
        await applyCertificate(cert, checked.value.serverUrl);
      }
      const client = checked.value.kind === "mock" ? new MockDeskClient() : new HulyDeskClient();
      const nextAccount = await client.authenticate(checked.value);
      clientRef.current = client;
      setAccount(nextAccount);
      if (nextAccount.workspaces.length === 0) {
        setError("这个账号还没有工作区。");
        setPhase("login");
        return;
      }
      setPhase("pick-workspace");
    } catch (reason) {
      const secrets = [draft.password, draft.token];
      setError(redactSecrets(explainConnectionError(reason, draft.method), secrets));
      setPhase("login");
    } finally {
      setBusy(false);
    }
  }

  async function restoreSession(saved: StoredSession) {
    setBusy(true);
    setError(null);
    try {
      const client = new HulyDeskClient();
      const nextAccount = await client.authenticate({ kind: "token", serverUrl: saved.serverUrl, token: saved.token });
      clientRef.current = client;
      setAccount(nextAccount);
      const plan = planSessionLaunch({ stored: saved, workspaces: nextAccount.workspaces });
      if (plan.action === "enter") {
        await openWorkspace(plan.workspace.url);
        return;
      }
      if (plan.action === "pick") {
        setPhase("pick-workspace");
        return;
      }
      await clearStoredSession();
      savedRef.current = null;
      setError(plan.message);
      setPhase("login");
    } catch (reason) {
      const offline = loadOfflineSnapshot(saved.serverUrl, saved.workspace);
      if (offline && !isAccountTokenInvalid(reason)) {
        const offlineSession: Session = {
          mode: "huly",
          serverUrl: saved.serverUrl,
          workspace: saved.workspace,
          workspaceName: saved.workspaceName || saved.workspace,
          workspaces: [{ id: saved.workspace, url: saved.workspace, name: saved.workspaceName || saved.workspace }],
          email: saved.email || undefined,
          userId: null,
          accountId: null,
          userName: saved.email || "离线用户",
          role: "USER",
        };
        workspaceCache.current.set(saved.workspace, {
          projects: offline.projects,
          people: offline.people,
          members: offline.members,
        });
        for (const [id, bundle] of Object.entries(offline.bundles)) {
          projectCache.current.set(id, bundle);
        }
        setOfflineReadOnly(true);
        setOfflineSavedAt(offline.savedAt);
        setDesk({
          session: offlineSession,
          projects: offline.projects,
          people: offline.people,
          members: offline.members,
          statuses: [],
          milestones: [],
          components: [],
          labels: [],
          issues: [],
          mine: offline.mine,
          mineStatuses: offline.mineStatuses ?? [],
          comments: [],
          activity: [],
          attachments: [],
          templates: [],
          projectId: null,
          nav: "projects",
          view: "list",
          filters: EMPTY_FILTERS,
          mineFilters: EMPTY_FILTERS,
          selectedId: null,
          detail: "closed",
          commentWrite: false,
          loading: false,
          refreshing: false,
          descriptionLoading: false,
        });
        setPhase("desk");
        setBusy(false);
        return;
      }
      const secrets = [saved.token];
      if (isAccountTokenInvalid(reason)) {
        await clearStoredSession();
        savedRef.current = null;
        setError(ACCOUNT_EXPIRED_MESSAGE);
      } else {
        setError(redactSecrets(explainConnectionError(reason), secrets));
      }
      setPhase("login");
    } finally {
      setBusy(false);
    }
  }

  async function persistSession(client: DeskClient, session: Session): Promise<void> {
    if (client.mode !== "huly") return;
    const token = client.tokenForKeychain();
    const stored = await saveStoredSession({
      serverUrl: session.serverUrl,
      workspace: session.workspace,
      workspaceName: session.workspaceName,
      email: session.email,
      token,
    });
    savedRef.current = token
      ? {
          serverUrl: session.serverUrl,
          workspace: session.workspace,
          workspaceName: session.workspaceName,
          email: session.email ?? "",
          token,
        }
      : savedRef.current;
    void stored;
  }

  async function openWorkspace(workspaceUrl: string) {
    const client = clientRef.current;
    if (!client) throw new Error("尚未登录。");
    setBusy(true);
    setError(null);
    try {
      const session = await client.enterWorkspace(workspaceUrl);
      setOfflineReadOnly(false);
      await persistSession(client, session);
      openDesk(client, session);
    } catch (reason) {
      if (isAccountTokenInvalid(reason)) {
        await clearStoredSession();
        savedRef.current = null;
        clientRef.current = null;
        setAccount(null);
        setError(ACCOUNT_EXPIRED_MESSAGE);
        setPhase("login");
        return;
      }
      setError(explainConnectionError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function switchWorkspace(workspaceUrl: string) {
    const client = clientRef.current;
    if (!client) return;
    mcpWorkspace.current = null;
    projectCache.current.clear();
    templateCache.current.clear();
    mineCache.current = null;
    setError(null);
    try {
      const session = await client.switchWorkspace(workspaceUrl);
      setOfflineReadOnly(false);
      await persistSession(client, session);
      openDesk(client, session);
    } catch (reason) {
      if (isAccountTokenInvalid(reason)) {
        await clearStoredSession();
        savedRef.current = null;
        setError(ACCOUNT_EXPIRED_MESSAGE);
        setPhase("login");
        return;
      }
      setError(explainConnectionError(reason));
    }
  }

  function needsDescription(issue: Issue): boolean {
    return !issue.descriptionMarkup && descriptionIsRef(issue.descriptionRef);
  }

  function openDesk(client: DeskClient, session: Session) {
    mcpWorkspace.current = { client };
    notificationsGate.current.next();
    lastNotificationRequest.current = 0;
    setNotifications([]);
    setNotificationsError(null);
    setNotificationsLoading(false);
    setNotificationsOpen(false);
    const cached = workspaceCache.current.get(session.workspace);
    const offline = loadOfflineSnapshot(session.serverUrl, session.workspace);
    if (offline) setOfflineSavedAt(offline.savedAt);
    const initialProjects = cached?.projects ?? offline?.projects ?? [];
    const initialPeople = cached?.people ?? offline?.people ?? [];
    const initialMembers = cached?.members ?? offline?.members ?? [];
    const hasInitial = initialProjects.length > 0;
    const gen = navGate.current.next();
    setDesk({
      session,
      projects: initialProjects,
      people: initialPeople,
      members: initialMembers,
      statuses: [],
      milestones: [],
      components: [],
      labels: [],
      issues: [],
      mine: offline?.mine ?? [],
      mineStatuses: offline?.mineStatuses ?? [],
      comments: [],
      activity: [],
      attachments: [],
      templates: [],
      projectId: null,
      nav: "projects",
      view: "list",
      filters: EMPTY_FILTERS,
      mineFilters: EMPTY_FILTERS,
      selectedId: null,
      detail: "closed",
      commentWrite: client.commentWrite,
      loading: !hasInitial,
      refreshing: hasInitial,
      descriptionLoading: false,
    });
    setPhase("desk");
    void loadWorkspace(gen, session);
    void refreshNotifications(true);
  }

  async function loadWorkspace(gen: number, session: Session) {
    const client = clientRef.current;
    if (!client) {
      setDesk((current) => (current ? { ...current, loading: false, refreshing: false } : current));
      return;
    }
    try {
      const [projects, people, members] = await Promise.all([
        client.listProjects(),
        client.listPeople(),
        client.listWorkspaceMembers().catch(() => [] as WorkspaceMember[]),
      ]);
      const ownsNavigation = navGate.current.isCurrent(gen);
      const active = deskRef.current;
      if (clientRef.current !== client || (!ownsNavigation && (active?.session !== session || active.nav !== "mine"))) return;
      if (ownsNavigation) setOfflineReadOnly(false);
      workspaceCache.current.set(session.workspace, { projects, people, members });
      setDesk((current) =>
        current && current.session.workspace === session.workspace
          ? { ...current, projects, people, members, ...(ownsNavigation ? { loading: false, refreshing: false } : {}) }
          : current,
      );
      persistOfflineCache(session);
      if (ownsNavigation) void enrichCounts(gen, session);
    } catch (reason) {
      if (!navGate.current.isCurrent(gen)) return;
      const offline = loadOfflineSnapshot(session.serverUrl, session.workspace);
      if (offline) {
        setOfflineReadOnly(true);
        setOfflineSavedAt(offline.savedAt);
        setDesk((current) =>
          current
            ? {
                ...current,
                projects: offline.projects,
                people: offline.people,
                members: offline.members,
                loading: false,
                refreshing: false,
              }
            : current,
        );
        return;
      }
      setDesk((current) => (current ? { ...current, loading: false, refreshing: false } : current));
      setError(reason instanceof Error ? reason.message : "工作区没有加载出来。");
    }
  }

  async function enrichCounts(gen: number, session: Session) {
    const client = clientRef.current;
    if (!client) return;
    try {
      const counts = await client.countIssuesByProject();
      if (!navGate.current.isCurrent(gen)) return;
      setDesk((current) => {
        if (!current || current.session.workspace !== session.workspace) return current;
        const projects = current.projects.map((project) => {
          const count = counts[project.id];
          return count ? { ...project, issueCount: count.total, openCount: count.open } : project;
        });
        const cached = workspaceCache.current.get(session.workspace);
        if (cached) workspaceCache.current.set(session.workspace, { ...cached, projects });
        return { ...current, projects };
      });
      persistOfflineCache(session);
    } catch {
      /* counts stay as placeholders */
    }
  }

  async function refreshNotifications(silent = false) {
    const client = clientRef.current;
    if (!client) return;
    // WebSocket responses also trigger silent sync. Don't let the inbox's own
    // reads cause it to continuously resolve the same notifications again.
    if (silent && Date.now() - lastNotificationRequest.current < 25_000) return;
    lastNotificationRequest.current = Date.now();
    const request = notificationsGate.current.next();
    if (!silent) {
      setNotificationsLoading(true);
      setNotificationsError(null);
    }
    try {
      const items = await client.listNotifications();
      if (notificationsGate.current.isCurrent(request) && clientRef.current === client) {
        setNotifications(items);
        setNotificationsError(null);
      }
    } catch {
      if (!silent && notificationsGate.current.isCurrent(request)) setNotificationsError("通知未能加载，请刷新重试。");
    } finally {
      if (notificationsGate.current.isCurrent(request)) setNotificationsLoading(false);
    }
  }

  function showProjects() {
    const gen = navGate.current.next();
    setError(null);
    setDesk((current) =>
      current
        ? {
            ...current,
            nav: "projects",
            projectId: null,
            selectedId: null,
            detail: "closed",
            comments: [],
            activity: [],
            attachments: [],
            loading: current.projects.length === 0,
            refreshing: current.projects.length > 0,
          }
        : current,
    );
    const session = deskRef.current?.session;
    if (session) void loadWorkspace(gen, session);
  }

  function showMembers() {
    if (desk && !canManageWorkspaceMembers(desk.session.role)) return;
    const gen = navGate.current.next();
    setError(null);
    setDesk((current) =>
      current
        ? { ...current, nav: "members", loading: current.members.length === 0, refreshing: current.members.length > 0 }
        : current,
    );
    const session = deskRef.current?.session;
    if (session) void loadWorkspace(gen, session);
  }

  async function refreshProject(
    projectId: string,
    gen: number,
    preferredId?: string | null,
    silent = false,
    expectedDetailToken?: number,
  ) {
    const client = clientRef.current;
    const session = deskRef.current?.session;
    if (!client || !session) return;
    const capturedDetailToken = expectedDetailToken ?? detailGen.current;
    try {
      const [bundle, templates] = await Promise.all([
        client.loadProject(projectId, { targetIssueId: preferredId ?? undefined }),
        client.listTemplates(projectId).catch(() => [] as IssueTemplate[]),
      ]);
      if (!navGate.current.isCurrent(gen)) return;
      const active = deskRef.current;
      const oldIssue = active?.detail !== "closed" && active?.projectId === projectId
        ? active.issues.find((item) => item.id === active.selectedId)
        : undefined;
      const freshIndex = oldIssue ? bundle.issues.findIndex((item) => item.id === oldIssue.id) : -1;
      if (silent && oldIssue && freshIndex >= 0) {
        const fresh = bundle.issues[freshIndex];
        if (fresh.descriptionRef !== oldIssue.descriptionRef && needsDescription(fresh)) {
          const hydrated = await client.hydrateIssue(fresh);
          if (!navGate.current.isCurrent(gen)) return;
          bundle.issues[freshIndex] = hydrated.descriptionUnavailable && oldIssue.descriptionMarkup
            ? { ...fresh, description: oldIssue.description, descriptionMarkup: oldIssue.descriptionMarkup }
            : hydrated;
        }
      }
      setOfflineReadOnly(false);
      projectCache.current.set(projectId, bundle);
      templateCache.current.set(projectId, templates);
      persistOfflineCache(session);
      const snapshot = deskRef.current;
      const detailUntouched = capturedDetailToken === detailGen.current;
      const shouldKeepOpen = Boolean(snapshot && snapshot.nav === "project" && snapshot.projectId === projectId && snapshot.detail !== "closed");
      const canOpenPreferred = Boolean(!silent && preferredId && detailUntouched);
      const wantedId = canOpenPreferred ? preferredId : shouldKeepOpen ? snapshot?.selectedId ?? null : null;
      const targetIssue = wantedId ? bundle.issues.find((issue) => issue.id === wantedId) ?? null : null;
      if (canOpenPreferred && !targetIssue) setError("这条任务已不存在或当前账号不可见。");

      setDesk((current) => {
        if (!current || current.nav !== "project" || current.projectId !== projectId) return current;
        const issues = mergeDescriptions(bundle.issues, current.issues);
        const keepOpen = current.detail !== "closed";
        const allowPreferred = Boolean(!silent && preferredId && detailUntouched);
        const wanted = allowPreferred ? preferredId : keepOpen ? current.selectedId : null;
        const resolved = wanted ? issues.find((issue) => issue.id === wanted) ?? null : null;
        return {
          ...current,
          statuses: withFallbackStatuses(bundle.statuses, issues),
          milestones: bundle.milestones,
          components: bundle.components,
          labels: bundle.labels,
          templates,
          issues,
          loading: false,
          refreshing: false,
          selectedId: resolved?.id ?? (keepOpen ? current.selectedId : null),
          detail: allowPreferred && resolved ? "side" : current.detail,
          descriptionLoading: silent ? current.descriptionLoading : Boolean(resolved && (keepOpen || allowPreferred) && needsDescription(resolved)),
        };
      });
      if (!silent && targetIssue && (canOpenPreferred || shouldKeepOpen)) {
        void hydrateSelection(targetIssue);
      }
    } catch (reason) {
      if (!navGate.current.isCurrent(gen)) return;
      if (silent) return;
      const offline = loadOfflineSnapshot(session.serverUrl, session.workspace);
      const cachedBundle = offline?.bundles[projectId];
      if (cachedBundle) {
        setOfflineReadOnly(true);
        setOfflineSavedAt(offline.savedAt);
        setDesk((current) =>
          current && current.projectId === projectId
            ? {
                ...current,
                statuses: withFallbackStatuses(cachedBundle.statuses, cachedBundle.issues),
                milestones: cachedBundle.milestones,
                components: cachedBundle.components,
                labels: cachedBundle.labels,
                issues: cachedBundle.issues,
                loading: false,
                refreshing: false,
              }
            : current,
        );
        return;
      }
      setDesk((current) => (current ? { ...current, loading: false, refreshing: false } : current));
      setError(reason instanceof Error ? reason.message : "项目没有加载出来。");
    }
  }

  function showProject(projectId: string, options?: { issueId?: string; openDetail?: boolean }) {
    const gen = navGate.current.next();
    const detailToken = ++detailGen.current;
    const cached = projectCache.current.get(projectId);
    const cachedTemplates = templateCache.current.get(projectId) ?? [];
    const selected = options?.issueId
      ? cached?.issues.find((issue) => issue.id === options.issueId) ?? null
      : null;
    setError(null);
    setDesk((current) =>
      current
        ? {
            ...current,
            nav: "project",
            projectId,
            loading: !cached,
            refreshing: Boolean(cached),
            issues: cached?.issues ?? [],
            statuses: cached ? withFallbackStatuses(cached.statuses, cached.issues) : [],
            milestones: cached?.milestones ?? [],
            components: cached?.components ?? [],
            labels: cached?.labels ?? [],
            templates: cachedTemplates,
            comments: [],
            activity: [],
            attachments: [],
            activityLoading: Boolean(selected && options?.openDetail),
            activityError: null,
            selectedId: selected?.id ?? null,
            detail: selected && options?.openDetail ? "side" : "closed",
            descriptionLoading: selected ? needsDescription(selected) : false,
          }
        : current,
    );
    if (selected && options?.openDetail) void hydrateSelection(selected);
    void refreshProject(projectId, gen, options?.openDetail ? options?.issueId ?? null : null, false, detailToken);
  }

  function showMine() {
    const client = clientRef.current;
    const session = deskRef.current?.session;
    if (!session) return;
    const gen = navGate.current.next();
    detailGen.current += 1;
    const cached = session.userId && mineCache.current?.userId === session.userId ? mineCache.current : null;
    setError(null);
    setDesk((current) =>
      current
        ? {
            ...current,
            nav: "mine",
            projectId: null,
            view: "list",
            loading: !cached && Boolean(client && session.userId),
            refreshing: Boolean(cached && client),
            mine: cached?.issues ?? current.mine,
            mineStatuses: cached?.statuses ?? current.mineStatuses,
            milestones: [],
            components: [],
            labels: [],
            templates: [],
            comments: [],
            activity: [],
            attachments: [],
            selectedId: null,
            detail: "closed",
          }
        : current,
    );
    void refreshMine(gen);
  }

  async function refreshMine(gen: number, silent = false) {
    const client = clientRef.current;
    const session = deskRef.current?.session;
    if (!client || !session?.userId) return;
    try {
      const { issues, statuses } = await client.listAssigned(session.userId);
      if (!navGate.current.isCurrent(gen) || clientRef.current !== client) return;
      setOfflineReadOnly(false);
      mineCache.current = { userId: session.userId, issues, statuses };
      setDesk((current) =>
        current && current.nav === "mine"
          ? { ...current, mine: mergeDescriptions(issues, current.mine), mineStatuses: statuses, loading: false, refreshing: false }
          : current,
      );
      persistOfflineCache(session);
    } catch (reason) {
      if (silent || !navGate.current.isCurrent(gen) || clientRef.current !== client) return;
      const offline = loadOfflineSnapshot(session.serverUrl, session.workspace);
      if (offline) {
        setOfflineReadOnly(true);
        setOfflineSavedAt(offline.savedAt);
        setDesk((current) =>
          current && current.nav === "mine"
            ? { ...current, mine: offline.mine, mineStatuses: offline.mineStatuses ?? [], loading: false, refreshing: false }
            : current,
        );
        return;
      }
      setDesk((current) => (current ? { ...current, loading: false, refreshing: false } : current));
      setError(reason instanceof Error ? reason.message : "我的任务没有加载出来。");
    }
  }

  async function loadTimeline(issue: Issue, token: number) {
    const client = clientRef.current;
    const request = timelineGate.current.next();
    const startedAt = Date.now();
    const apply = (update: (current: DeskModel) => DeskModel) => {
      setDesk((current) => current && current.selectedId === issue.id && current.detail !== "closed"
        && token === detailGen.current && timelineGate.current.isCurrent(request) ? update(current) : current);
    };
    if (!client) {
      apply((current) => ({ ...current, activityLoading: false, activityError: "离线时无法加载活动。" }));
      return;
    }
    apply((current) => ({ ...current, activityLoading: true, activityError: null }));
    try {
      const timeline = await client.loadIssueTimeline(issue);
      apply((current) => {
        const seen = new Set(timeline.comments.map((item) => item.id));
        const postedDuringLoad = current.comments.filter((item) => item.createdOn >= startedAt && !seen.has(item.id));
        return { ...current, comments: [...timeline.comments, ...postedDuringLoad], activity: timeline.activity,
          activityLoading: false, activityError: timeline.warning ?? null };
      });
    } catch {
      apply((current) => ({ ...current, activityLoading: false, activityError: "活动加载失败，请重试。" }));
    }
  }

  async function hydrateSelection(issue: Issue) {
    const client = clientRef.current;
    const token = ++detailGen.current;
    setDesk((current) =>
      current && current.detail !== "closed"
        ? {
            ...current,
            selectedId: issue.id,
            descriptionLoading: client ? needsDescription(issue) : false,
          }
        : current,
    );
    void loadTimeline(issue, token);
    if (!client) return;
    const [hydrated, attachments] = await Promise.all([
      client.hydrateIssue(issue),
      client.listAttachments(issue.id).catch(() => [] as Attachment[]),
    ]);
    if (token !== detailGen.current) return;
    setDesk((current) => {
      if (!current || current.detail === "closed" || current.selectedId !== issue.id) return current;
      const replace = (items: Issue[]) => items.map((item) => (item.id === hydrated.id ? { ...item, ...hydrated } : item));
      return {
        ...current,
        issues: replace(current.issues),
        mine: replace(current.mine),
        attachments,
        descriptionLoading: false,
      };
    });
  }

  async function selectIssue(id: string, known?: Issue) {
    const current = deskRef.current;
    if (current?.nav === "mine") {
      const issue = known ?? current.mine.find((item) => item.id === id);
      if (issue) showProject(issue.projectId, { issueId: issue.id, openDetail: true });
      return;
    }
    const issue = known ?? [...(current?.issues ?? []), ...(current?.mine ?? [])].find((item) => item.id === id);
    if (!issue) return;
    setDesk((prev) =>
      prev
        ? {
            ...prev,
            selectedId: issue.id,
            detail: "side",
            comments: [],
            activity: [],
            attachments: [],
            activityLoading: Boolean(clientRef.current),
            activityError: null,
            descriptionLoading: Boolean(clientRef.current) && needsDescription(issue),
          }
        : prev,
    );
    await hydrateSelection(issue);
  }

  async function updateIssue(id: string, patch: IssuePatch) {
    const client = clientRef.current;
    if (!client || offlineReadOnly) throw new Error("当前处于离线只读模式。");
    const updated = await client.updateIssue(id, patch);
    setDesk((current) => {
      if (!current) return current;
      const replace = (items: Issue[]) => items.map((item) => (item.id === id ? { ...item, ...mergeDescriptions([updated], [item])[0] } : item));
      const nextIssues = replace(current.issues);
      const cached = current.projectId ? projectCache.current.get(current.projectId) : undefined;
      if (cached && current.projectId) {
        projectCache.current.set(current.projectId, { ...cached, issues: nextIssues });
      }
      return { ...current, issues: nextIssues, mine: replace(current.mine) };
    });
  }

  async function createIssue(input: CreateIssueInput) {
    const client = clientRef.current;
    if (!client || !desk || offlineReadOnly) throw new Error("当前处于离线只读模式。");
    const created = await client.createIssue(input);
    projectCache.current.delete(created.projectId);
    setCreateParentId(null);
    if (input.parentId && deskRef.current?.detail !== "closed" && deskRef.current?.projectId === created.projectId) {
      setDesk((current) => (current ? { ...current, issues: [...current.issues, created] } : current));
      return;
    }
    showProject(created.projectId, { issueId: created.id, openDetail: true });
    setDesk((current) => (current ? { ...current, selectedId: created.id, detail: "side", view: "list" } : current));
  }

  function triggerManualRefresh() {
    const current = deskRef.current;
    if (!current) return;
    if (current.nav === "mine") {
      mineCache.current = null;
      void showMine();
      return;
    }
    if (current.nav === "project" && current.projectId) {
      projectCache.current.delete(current.projectId);
      showProject(current.projectId, {
        issueId: current.selectedId ?? undefined,
        openDetail: current.detail !== "closed",
      });
      return;
    }
    const cached = workspaceCache.current.get(current.session.workspace);
    if (cached) workspaceCache.current.delete(current.session.workspace);
    const gen = navGate.current.next();
    setDesk((prev) => (prev ? { ...prev, refreshing: true, loading: prev.projects.length === 0 } : prev));
    void loadWorkspace(gen, current.session);
  }

  async function logout() {
    mcpWorkspace.current = null;
    notificationsGate.current.next();
    await clientRef.current?.disconnect();
    clientRef.current = null;
    projectCache.current.clear();
    templateCache.current.clear();
    mineCache.current = null;
    workspaceCache.current.clear();
    if (!mockDefault) await clearStoredSession();
    savedRef.current = null;
    setAccount(null);
    setDesk(null);
    setNotifications([]);
    setOfflineReadOnly(false);
    setPhase("login");
    setError(null);
  }

  function replaceProject(project: Project) {
    setDesk((current) => {
      if (!current) return current;
      const projects = current.projects
        .map((item) => (item.id === project.id ? project : item))
        .filter((item) => !item.archived);
      const cached = workspaceCache.current.get(current.session.workspace);
      if (cached) workspaceCache.current.set(current.session.workspace, { ...cached, projects });
      return { ...current, projects };
    });
  }

  const shownIssues = desk ? (desk.nav === "mine" ? desk.mine : desk.issues) : [];
  const shownStatuses = desk ? withFallbackStatuses(desk.nav === "mine" ? desk.mineStatuses : desk.statuses, shownIssues) : [];
  const unreadNotifications = notifications.filter((item) => !item.isViewed).length;

  const inDesk = phase === "desk" && desk !== null;

  return (
    <WindowFrame
      actions={inDesk ? (
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          disabled={offlineReadOnly}
          onClick={() => {
            setCreateParentId(null);
            setCreateOpen(true);
          }}
        >
          新建任务
        </Button>
      ) : null}
      utilities={inDesk ? (
        <>
          {offlineReadOnly ? (
            <Tooltip title="当前使用本地缓存快照">
              <Tag color="warning" style={{ marginInlineEnd: 4 }}>离线只读</Tag>
            </Tooltip>
          ) : null}
          <Tooltip title="通知收件箱">
            <Badge count={unreadNotifications} size="small" offset={[-4, 4]}>
              <Button
                size="small"
                type="text"
                icon={<BellOutlined />}
                aria-label="通知收件箱"
                onClick={() => {
                  setNotificationsOpen(true);
                  void refreshNotifications(false);
                }}
              />
            </Badge>
          </Tooltip>
        </>
      ) : null}
    >
      {phase === "login" || (phase !== "desk" && phase !== "pick-workspace") ? (
        <LoginScreen mock={mockDefault} busy={busy} error={error} initialCa={initialCa} onEnter={onSubmit} />
      ) : phase === "pick-workspace" && account ? (
        <WorkspacePicker workspaces={account.workspaces} busy={busy} error={error} onEnter={openWorkspace} />
      ) : desk ? (
        <DeskScreen
          session={desk.session}
          projects={desk.projects}
          people={desk.people}
          members={desk.members}
          statuses={shownStatuses}
          milestones={desk.milestones}
          components={desk.components}
          labels={desk.labels}
          issues={shownIssues}
          comments={desk.comments}
          activity={desk.activity}
          activityLoading={desk.activityLoading}
          activityError={desk.activityError}
          onRefreshActivity={() => {
            const issue = shownIssues.find((item) => item.id === desk.selectedId);
            if (issue) void loadTimeline(issue, detailGen.current);
          }}
          attachments={desk.attachments}
          templates={desk.templates}
          notifications={notifications}
          notificationsOpen={notificationsOpen}
          notificationsLoading={notificationsLoading}
          notificationsError={notificationsError}
          metaModalOpen={metaModalOpen}
          templateModalOpen={templateModalOpen}
          offlineReadOnly={offlineReadOnly}
          offlineSavedAt={offlineSavedAt}
          commentWrite={desk.commentWrite}
          loading={desk.loading}
          refreshing={desk.refreshing}
          descriptionLoading={desk.descriptionLoading}
          projectId={desk.projectId}
          nav={desk.nav}
          view={desk.view}
          filters={desk.nav === "mine" ? desk.mineFilters : desk.filters}
          selectedId={desk.selectedId}
          detail={desk.detail}
          error={error}
          createOpen={createOpen}
          createParentId={createParentId}
          addMemberProject={addMemberProject}
          editProject={editProject}
          inviteOpen={inviteOpen}
          profileSaving={profileSaving}
          onNav={(nav) => {
            if (nav === "mine") void showMine();
            else if (nav === "projects") showProjects();
            else if (nav === "members") showMembers();
            else setDesk({ ...desk, nav });
          }}
          onProject={(projectId) => showProject(projectId)}
          onView={(view) => setDesk({ ...desk, view, detail: view === "board" ? "closed" : desk.detail })}
          onFilters={(filters) => setDesk((current) => current && (current.nav === "mine"
            ? { ...current, mineFilters: filters }
            : { ...current, filters }))}
          onSelect={(id) => void selectIssue(id)}
          onDetail={(detail) => {
            if (detail === "closed") {
              detailGen.current += 1;
              setDesk((current) =>
                current
                  ? {
                      ...current,
                      detail: "closed",
                      selectedId: null,
                      comments: [],
                      activity: [],
                      activityLoading: false,
                      activityError: null,
                      attachments: [],
                      descriptionLoading: false,
                    }
                  : current,
              );
            } else {
              setDesk((current) => (current ? { ...current, detail } : current));
            }
          }}
          onUpdate={updateIssue}
          onCreate={createIssue}
          onOpenCreateSubIssue={(parentId) => {
            setCreateParentId(parentId);
            setCreateOpen(true);
          }}
          onComment={async (markup, files) => {
            const client = clientRef.current;
            if (!client || !desk.selectedId || offlineReadOnly) throw new Error("当前无法发表评论。");
            const token = detailGen.current;
            const comment = await client.addComment(desk.selectedId, markup, "markup", files);
            setDesk((current) => current && current.selectedId === comment.issueId && current.detail !== "closed"
              && detailGen.current === token && !current.comments.some((item) => item.id === comment.id)
              ? { ...current, comments: [...current.comments, comment] } : current);
          }}
          onUploadDescriptionFile={async (file) => {
            const client = clientRef.current;
            if (!client || !desk.selectedId || offlineReadOnly) throw new Error("当前无法在描述中插入文件。");
            return client.uploadInlineFile(desk.selectedId, file);
          }}
          onUploadAttachment={async (file) => {
            const client = clientRef.current;
            if (!client || !desk.selectedId || offlineReadOnly) throw new Error("当前无法上传附件。");
            const attachment = await client.uploadAttachment(desk.selectedId, file);
            setDesk((current) =>
              current?.selectedId === attachment.issueId ? { ...current, attachments: [attachment, ...current.attachments] } : current,
            );
            return attachment;
          }}
          onDownloadAttachment={async (attachment) => {
            const client = clientRef.current;
            if (!client) return;
            await client.downloadAttachment(attachment);
          }}
          onDeleteAttachment={async (attachmentId) => {
            const client = clientRef.current;
            if (!client || !desk.selectedId || offlineReadOnly) return;
            await client.deleteAttachment(desk.selectedId, attachmentId);
            setDesk((current) =>
              current
                ? { ...current, attachments: current.attachments.filter((item) => item.id !== attachmentId) }
                : current,
            );
          }}
          onCreateMilestone={async (input) => {
            const client = clientRef.current;
            if (!client || !desk.projectId || offlineReadOnly) return;
            const created = await client.createMilestone(desk.projectId, input);
            setDesk((current) => (current ? { ...current, milestones: [...current.milestones, created] } : current));
          }}
          onUpdateMilestone={async (id, patch) => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) return;
            const updated = await client.updateMilestone(id, patch);
            setDesk((current) =>
              current
                ? {
                    ...current,
                    milestones: current.milestones.map((item) => (item.id === id ? updated : item)),
                  }
                : current,
            );
          }}
          onDeleteMilestone={async (id) => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) return;
            await client.deleteMilestone(id);
            setDesk((current) =>
              current
                ? {
                    ...current,
                    milestones: current.milestones.filter((item) => item.id !== id),
                    issues: current.issues.map((issue) =>
                      issue.milestoneId === id ? { ...issue, milestoneId: null } : issue,
                    ),
                  }
                : current,
            );
          }}
          onCreateComponent={async (input) => {
            const client = clientRef.current;
            if (!client || !desk.projectId || offlineReadOnly) return;
            const created = await client.createComponent(desk.projectId, input);
            setDesk((current) => (current ? { ...current, components: [...current.components, created] } : current));
          }}
          onUpdateComponent={async (id, patch) => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) return;
            const updated = await client.updateComponent(id, patch);
            setDesk((current) =>
              current
                ? {
                    ...current,
                    components: current.components.map((item) => (item.id === id ? updated : item)),
                  }
                : current,
            );
          }}
          onDeleteComponent={async (id) => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) return;
            await client.deleteComponent(id);
            setDesk((current) =>
              current
                ? {
                    ...current,
                    components: current.components.filter((item) => item.id !== id),
                    issues: current.issues.map((issue) =>
                      issue.componentId === id ? { ...issue, componentId: null } : issue,
                    ),
                  }
                : current,
            );
          }}
          onCreateTemplate={async (input) => {
            const client = clientRef.current;
            if (!client || !desk.projectId || offlineReadOnly) return;
            const created = await client.createTemplate(desk.projectId, input);
            setDesk((current) => (current ? { ...current, templates: [...current.templates, created] } : current));
          }}
          onUpdateTemplate={async (id, patch) => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) return;
            const updated = await client.updateTemplate(id, patch);
            setDesk((current) =>
              current
                ? {
                    ...current,
                    templates: current.templates.map((item) => (item.id === id ? updated : item)),
                  }
                : current,
            );
          }}
          onDeleteTemplate={async (id) => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) return;
            await client.deleteTemplate(id);
            setDesk((current) =>
              current
                ? { ...current, templates: current.templates.filter((item) => item.id !== id) }
                : current,
            );
          }}
          onNotificationsOpen={setNotificationsOpen}
          onRefreshNotifications={() => void refreshNotifications(false)}
          onMarkNotificationRead={async (id) => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) throw new Error("当前无法更新通知。");
            await client.markNotificationRead(id);
            if (deskRef.current?.session.workspace === desk.session.workspace && clientRef.current === client) {
              notificationsGate.current.next();
              setNotificationsLoading(false);
              setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, isViewed: true } : item)));
            }
          }}
          onMarkAllNotificationsRead={async () => {
            const client = clientRef.current;
            if (!client || offlineReadOnly) throw new Error("当前无法更新通知。");
            await client.markAllNotificationsRead();
            if (deskRef.current?.session.workspace === desk.session.workspace && clientRef.current === client) {
              notificationsGate.current.next();
              setNotificationsLoading(false);
              setNotifications((prev) => prev.map((item) => ({ ...item, isViewed: true })));
            }
          }}
          onOpenNotificationTarget={(notification) => {
            if (notification.projectId && notification.objectId) {
              setNotificationsOpen(false);
              showProject(notification.projectId, { issueId: notification.objectId, openDetail: true });
            }
          }}
          onMetaModalOpen={setMetaModalOpen}
          onTemplateModalOpen={setTemplateModalOpen}
          onMove={(issueId, statusId) => void updateIssue(issueId, { statusId })}
          onLogout={() => void logout()}
          onCreateOpen={(open) => {
            if (!open) setCreateParentId(null);
            setCreateOpen(open);
          }}
          onRefresh={triggerManualRefresh}
          onSwitchWorkspace={(workspaceUrl) => void switchWorkspace(workspaceUrl)}
          onAddMemberOpen={setAddMemberProject}
          onEditProjectOpen={setEditProject}
          onSaveMembers={async (projectId, memberIds) => {
            const client = clientRef.current;
            if (!client) return;
            const project = await client.updateProjectMembers(projectId, memberIds);
            replaceProject(project);
          }}
          onSaveProject={async (projectId, patch: ProjectPatch) => {
            const client = clientRef.current;
            if (!client) return;
            const project = await client.updateProject(projectId, patch);
            replaceProject(project);
          }}
          onInviteOpen={setInviteOpen}
          onSendInvite={async (email, role) => {
            await clientRef.current?.sendInvite(email, role);
          }}
          onCopyInviteLink={async (email, role) => {
            const link = await clientRef.current?.createInviteLink(email, role);
            if (!link) throw new Error("没有生成邀请链接。");
            return link;
          }}
          onChangeRole={async (accountId, role: WorkspaceRole) => {
            const client = clientRef.current;
            if (!client) return;
            await client.updateWorkspaceRole(accountId, role);
            const members = await client.listWorkspaceMembers();
            setDesk((current) => (current ? { ...current, members } : current));
          }}
          onRemoveMember={async (accountId) => {
            const client = clientRef.current;
            if (!client) return;
            await client.removeWorkspaceMember(accountId);
            const members = await client.listWorkspaceMembers();
            setDesk((current) => (current ? { ...current, members } : current));
          }}
          onSaveProfileName={async (firstName, lastName) => {
            const client = clientRef.current;
            if (!client) return;
            setProfileSaving(true);
            try {
              const userName = await client.changeDisplayName(firstName, lastName);
              setDesk((current) => {
                if (!current) return current;
                const people = current.people.map((person) =>
                  person.id === current.session.userId || person.accountId === current.session.accountId
                    ? { ...person, name: userName }
                    : person,
                );
                const members = current.members.map((member) =>
                  member.accountId === current.session.accountId || member.personId === current.session.userId
                    ? { ...member, name: userName }
                    : member,
                );
                const cached = workspaceCache.current.get(current.session.workspace);
                if (cached) workspaceCache.current.set(current.session.workspace, { ...cached, people, members });
                return { ...current, people, members, session: { ...current.session, userName } };
              });
            } finally {
              setProfileSaving(false);
            }
          }}
          onResolveImage={resolveImage}
          onLoadEditorTemplates={async () => {
            const client = clientRef.current;
            if (!client) throw new Error("尚未连接工作区。");
            return client.listEditorTemplates();
          }}
          onReadDescriptionSnapshot={async (ref) => {
            const client = clientRef.current;
            if (!client?.readDescriptionSnapshot || offlineReadOnly) throw new Error("历史描述暂不可用。");
            return client.readDescriptionSnapshot(ref);
          }}
        />
      ) : (
        <LoginScreen mock={mockDefault} busy={busy} error={error} initialCa={initialCa} onEnter={onSubmit} />
      )}
    </WindowFrame>
  );
}

function mergeDescriptions(next: Issue[], previous: Issue[]): Issue[] {
  const previousById = new Map(previous.map((issue) => [issue.id, issue]));
  return next.map((issue) => {
    const older = previousById.get(issue.id);
    if (older && issue.descriptionRef && issue.descriptionRef === older.descriptionRef && !issue.descriptionMarkup && !issue.descriptionUnavailable) {
      return { ...issue, description: older.description, descriptionMarkup: older.descriptionMarkup, descriptionUnavailable: older.descriptionUnavailable };
    }
    return issue;
  });
}

function withFallbackStatuses(statuses: Status[], issues: Issue[]): Status[] {
  const known = new Set(statuses.map((status) => status.id));
  const extra: Status[] = [];
  for (const issue of issues) {
    if (!issue.statusId || known.has(issue.statusId)) continue;
    known.add(issue.statusId);
    extra.push(mapStatus(issue.statusId));
  }
  return [...statuses, ...extra];
}
