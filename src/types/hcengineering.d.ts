/* Published @hcengineering/* 0.7.423 packages omit their types/ directory.
   These declarations cover only the surface Huly Desk calls. */

declare module "@hcengineering/api-client" {
  export class MarkupContent {
    constructor(content: string, kind: "markdown" | "html");
    content: string;
    kind: string;
  }
  export const BrowserWebSocketFactory: (url: string) => unknown;
  export interface ServerConfig {
    ACCOUNTS_URL: string;
    COLLABORATOR_URL: string;
    FILES_URL?: string;
    UPLOAD_URL?: string;
  }
  export interface ConnectOptions {
    workspace: string;
    email?: string;
    password?: string;
    token?: string;
    socketFactory?: (url: string) => unknown;
    connectionTimeout?: number;
  }
  export interface PlatformClient {
    getAccount(): Promise<{ uuid?: string; primarySocialId?: string }>;
    close(): Promise<void>;
    findAll<T>(classRef: string, query: Record<string, unknown>, options?: Record<string, unknown>): Promise<T[]>;
    findOne<T>(classRef: string, query: Record<string, unknown>, options?: Record<string, unknown>): Promise<T | undefined>;
    createDoc(
      classRef: string,
      space: string,
      attributes: Record<string, unknown>,
      id?: string,
    ): Promise<string>;
    updateDoc(
      classRef: string,
      space: string,
      objectId: string,
      operations: Record<string, unknown>,
      retrieve?: boolean,
    ): Promise<unknown>;
    removeDoc(classRef: string, space: string, objectId: string): Promise<unknown>;
    addCollection(
      classRef: string,
      space: string,
      attachedTo: string,
      attachedToClass: string,
      collection: string,
      attributes: Record<string, unknown>,
      id?: string,
    ): Promise<string>;
    removeCollection(
      classRef: string,
      space: string,
      objectId: string,
      attachedTo: string,
      attachedToClass: string,
      collection: string,
    ): Promise<unknown>;
    uploadMarkup(objectClass: string, objectId: string, objectAttr: string, markup: string, format: "markdown" | "html" | "markup"): Promise<unknown>;
    fetchMarkup(
      objectClass: string,
      objectId: string,
      objectAttr: string,
      markup: unknown,
      format: "markdown" | "html" | "markup",
    ): Promise<string>;
  }
  export function connect(url: string, options: ConnectOptions): Promise<PlatformClient>;
  export function loadServerConfig(url: string): Promise<ServerConfig>;
}

declare module "@hcengineering/account-client" {
  // Verified against @hcengineering/account-client 0.7.423 src/types.ts and src/client.ts
  export interface LoginInfo {
    account: string;
    name?: string;
    socialId?: string;
    token?: string;
    tfaRequired?: boolean;
    extra?: Record<string, string>;
  }
  export interface WorkspaceLoginInfo extends LoginInfo {
    workspace: string;
    workspaceDataId?: string;
    workspaceUrl: string;
    endpoint: string;
    token: string;
    role: string;
    allowGuestSignUp?: boolean;
  }
  export type LoginInfoRequest = { request: true; firstName?: string; lastName?: string };
  export type LoginInfoByToken = LoginInfo | WorkspaceLoginInfo | LoginInfoRequest | null;
  export interface WorkspaceInfoWithStatus {
    uuid: string;
    name: string;
    url: string;
    dataId?: string;
    region?: string;
    isDisabled?: boolean;
    mode?: string;
  }
  export interface Person {
    uuid: string;
    firstName: string;
    lastName: string;
  }
  export interface AccountClient {
    login(email: string, password: string): Promise<LoginInfo>;
    getUserWorkspaces(): Promise<WorkspaceInfoWithStatus[]>;
    selectWorkspace(
      workspaceUrl: string,
      kind?: "external" | "internal" | "byregion",
      externalRegions?: string[],
    ): Promise<WorkspaceLoginInfo>;
    getLoginInfoByToken(data?: { firstName?: string; lastName?: string }): Promise<LoginInfoByToken>;
    getPerson(): Promise<Person>;
    getPersonInfo(account: string): Promise<{
      uuid?: string;
      firstName?: string;
      lastName?: string;
      socialIds?: { type?: string; value?: string; key?: string }[];
    }>;
    getWorkspaceMembers(): Promise<{ person: string; role: string }[]>;
    updateWorkspaceRole(targetAccount: string, targetRole: string): Promise<void>;
    sendInvite(email: string, role: string): Promise<void>;
    resendInvite(email: string, role: string): Promise<void>;
    createInviteLink(
      email: string,
      role: string,
      autoJoin: boolean,
      firstName: string,
      lastName: string,
      navigateUrl?: string,
      expHours?: number,
    ): Promise<string>;
    leaveWorkspace(account: string): Promise<LoginInfo | null>;
    changeUsername(first: string, last: string): Promise<void>;
    getUserProfile(personUuid?: string): Promise<{ firstName?: string; lastName?: string } | null>;
  }
  export function getClient(accountsUrl?: string, token?: string, retryTimeoutMs?: number): AccountClient;
}

declare module "@hcengineering/core" {
  export const SortingOrder: { Ascending: number; Descending: number };
  export function generateId(): string;
  const core: { space: { Space: string; Workspace: string } };
  export default core;
}

declare module "@hcengineering/rank" {
  export function makeRank(prev?: string, next?: string): string;
}

declare module "@hcengineering/tracker" {
  const tracker: {
    class: {
      Project: string;
      Issue: string;
      IssueTemplate: string;
      IssueStatus: string;
      Milestone: string;
      Component: string;
      TimeSpendReport: string;
    };
    status: Record<string, string>;
    taskTypes: { Issue: string; SubIssue: string };
    ids: { NoParent: string };
    category: { Other: string };
  };
  export default tracker;
}

declare module "@hcengineering/task" {
  const task: { class: { ProjectType: string } };
  export default task;
}

declare module "@hcengineering/tags" {
  const tags: { class: { TagElement: string; TagReference: string } };
  export default tags;
}

declare module "@hcengineering/contact" {
  const contact: { class: { Person: string; Channel: string }; mixin: { Employee: string } };
  export default contact;
}

declare module "@hcengineering/chunter" {
  const chunter: { class: { ChatMessage: string; ThreadMessage: string } };
  export default chunter;
}

declare module "@hcengineering/activity" {
  const activity: { class: { ActivityMessage: string; DocUpdateMessage: string; ActivityReference: string; ActivityInfoMessage: string } };
  export default activity;
}

declare module "@hcengineering/text-core" {
  export function jsonToMarkup(node: unknown): string;
  export function markupToJSON(markup: string): unknown;
  export function markupToText(markup: string): string;
}

declare module "@hcengineering/text-markdown" {
  export function markdownToMarkup(
    markdown: string,
    options?: { refUrl?: string; imageUrl?: string },
  ): unknown;
  export function markupToMarkdown(
    markup: unknown,
    options?: { refUrl?: string; imageUrl?: string },
  ): string;
}

declare module "@hcengineering/text" {
  import type { Extension, Mark } from "@tiptap/core";
  export const ServerKit: Extension;
  export const Highlight: Mark;
  export const Subscript: Mark;
  export const Superscript: Mark;
}

declare module "@hcengineering/collaborator-client" {
  export function getClient(workspace: string, token: string, url: string): {
    updateMarkup(document: { objectClass: string; objectId: string; objectAttr: string }, markup: string): Promise<void>;
  };
}

declare module "@hcengineering/attachment" {
  const attachment: { class: { Attachment: string } };
  export default attachment;
}

declare module "@hcengineering/notification" {
  const notification: {
    class: {
      InboxNotification: string;
      DocNotifyContext: string;
    };
  };
  export default notification;
}
