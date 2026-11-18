# Huly Desk 设计稿（待确认后再写正式代码）

- 状态：仅设计，不写正式代码、不提交仓库、未读取任何本地 token、未登录自建实例写数据
- 日期：2026-11-18（Asia/Shanghai）
- 目标：为自建实例做一个风格接近 Jira、简单清晰的 macOS 桌面客户端
- 自建地址：`https://lm.all666.cn:666/`
- 工作区显示名：公司（URL slug 待确认）
- 可点击原型：`/workspace/huly-mac-design/prototype.html`（全部为示例数据）
- 截图：同目录 `01-login.png` … `06-command-palette.png`

## 1. 结论先行

推荐技术：**Tauri 2 + React + TypeScript**，在 WebView 中直接使用官方 `@hcengineering/api-client`。

第一期 MVP：连接自建服务器、项目与任务列表、筛选/搜索、看板拖拽改状态、任务详情（描述与主要属性）、新建任务、基础命令面板。先不做文档、通知收件箱、附件、模板和关联任务。

需要 Bill 先确认：工作区「公司」对应的 URL slug、登录方式（邮箱密码还是 token）、是否接受自签证书处理，以及 MVP 是否只做任务跟踪。

## 2. 实例探测说明

允许的无凭证只读探测在本调研环境未成功，因此实例版本和 `config.json` 端点仍为**待验证**：

- `https://lm.all666.cn:666/config.json`：TLS 握手失败（`unexpected eof while reading`）
- 明文 HTTP 同端口：TCP 可连通，但返回 `HTTP 500`，响应头 `Server: Pingora`，体为空
- DNS 在本环境解析为 `198.18.0.1`（常见于代理/假 IP），失败更可能是调研环境影响，不能据此判断办公室网络也连不上

正式开发前，应在可访问该实例的网络再次读取 `{url}/config.json`，确认 `ACCOUNTS_URL`、`COLLABORATOR_URL`、`FILES_URL`、`UPLOAD_URL` 是否为客户端可达地址。

## 3. 功能与 API 支持对照

依据：

- 产品功能：[docs.huly.io](https://docs.huly.io/)（创建任务、标签、里程碑、组件、关联、模板、通知/收件箱、文档等）
- 官方客户端：[hcengineering/huly.core](https://github.com/hcengineering/huly.core) 中 `packages/api-client` 的 README、`types.ts`、`client.ts`、`config.ts`、`markup/`、`storage/`
- 官方示例：[hcengineering/huly-examples](https://github.com/hcengineering/huly-examples) 的 `issue-list.ts`、`issue-create.ts`、`issue-update.ts`、`issue-labels.ts`、`documents/*`
- 社区参考（非官方承诺）：[dearlordylord/huly-mcp](https://github.com/dearlordylord/huly-mcp) 的 issues/labels/milestones/components/templates/relations/time 等操作

通用能力（所有「支持」项的基础）：

- 连接：`connect(url, options)`（WebSocket）或 `connectRest(url, options)`（REST）
- 查询：`findOne` / `findAll`
- 文档：`createDoc` / `updateDoc` / `removeDoc`
- 附属集合：`addCollection` / `updateCollection` / `removeCollection`
- Mixin：`createMixin` / `updateMixin`
- 富文本：`fetchMarkup` / `uploadMarkup`，格式 `'markup' | 'html' | 'markdown'`，也可在字段里传 `markdown(content)` / `html(content)`
- 对象存储：`connectStorage` → `StorageClient.put/get/stat/partial/remove`，上传到 `UPLOAD_URL`，下载走 `FILES_URL`，认证为 `Authorization: Bearer <token>`

`workspace` 参数在类型注释中是 **Workspace URL name**，官方 README 写明取自 `https://huly.app/workbench/<workspace-name>`，**不是**界面上的显示名。

| 功能 | 支持情况 | 对应 class / 方法 | 说明与依据 |
| --- | --- | --- | --- |
| 连接自建实例 | 支持 | `connect` / `connectRest`；`loadServerConfig` → `GET {url}/config.json` | 第一参数为实例 URL，可带非标准端口。config 字段：`ACCOUNTS_URL`、`COLLABORATOR_URL`、`FILES_URL`、`UPLOAD_URL`。本环境尚未读到该实例的真实 config。 |
| 邮箱密码登录 | 支持 | `ConnectOptions`：`email`、`password`、`workspace` | 官方 README 与 examples 均使用。登录后 `getAccount()` 可取当前账户。 |
| Token 登录 | 支持 | `ConnectOptions`：`token`、`workspace` | 官方 README 明确支持。token 应写入 macOS 钥匙串，不要明文文件。 |
| 工作区「公司」 | 部分支持 | `accountClient.selectWorkspace(options.workspace)` | 必须传 URL slug。显示名「公司」能否直接用、能否列出全部工作区再让用户选，**待验证**。 |
| 项目列表 | 支持 | `findAll` / `findOne(tracker.class.Project)` | 示例按 `identifier`（如 `HULY`）查找；可 lookup `type: task.class.ProjectType` 以读取状态流。 |
| 任务列表 | 支持 | `findAll(tracker.class.Issue, { space: project._id })` | 支持 `limit`、`sort`（如 `modifiedOn`）、`lookup`。 |
| 看板（按状态分列） | 支持 | `Issue.status`；状态定义来自 `task.class.ProjectType.statuses` 或项目默认状态 | 看板是客户端视图。改列即 `updateDoc(tracker.class.Issue, space, id, { status })`。 |
| 任务详情 | 支持 | `findOne(tracker.class.Issue)`；`fetchMarkup(..., 'description', ..., 'markdown')` | 描述是协同文档引用，不能只当普通字符串显示。 |
| 新建任务 | 支持 | `updateDoc(tracker.class.Project, ..., { $inc: { sequence: 1 } }, true)`；`uploadMarkup`；`addCollection(tracker.class.Issue, project._id, project._id, project._class, 'issues', attrs)` | 官方 `issue-create.ts` 字段：`title`、`description`、`status`（`project.defaultIssueStatus`）、`number`、`kind: tracker.taskTypes.Issue`、`identifier`、`priority`、`assignee`、`component`、`estimation`、`remainingTime`、`reportedTime`、`reports`、`subIssues`、`parents`、`childInfo`、`dueDate`、`rank`（`makeRank`）。 |
| 更新任务 | 支持 | `updateDoc(tracker.class.Issue, project._id, issue._id, operations)` | 官方示例更新 `milestone`、`dueDate`。状态、指派人、优先级同理。 |
| 子任务 | 部分支持 | `Issue` 字段 `parents`、`childInfo`、`subIssues`；产品文档支持 parent/sub-issue | 官方 examples 未演示如何创建子任务。社区 MCP 有 parent 相关操作。是设 `parent` 还是对父任务 `addCollection(..., 'subIssues')`，**待验证**。 |
| 评论 | 待验证 | 疑似 `chunter.class.ChatMessage` + `addCollection(..., 'comments')` | 产品有任务 Activity / 评论。官方 examples **没有**评论脚本。社区 MCP 提供 add/list comment。类名与 collection 名需在实例上验证后再写入正式代码。 |
| 标签 | 支持 | `createDoc(tags.class.TagElement, core.space.Workspace, { title, description, targetClass: tracker.class.Issue, color, category: tracker.category.Other })`；`addCollection(tags.class.TagReference, project._id, issueId, tracker.class.Issue, 'labels', { title, color, tag })` | 来自官方 `issue-labels.ts`。查询用 `findAll(tags.class.TagReference, { attachedTo, attachedToClass })`。 |
| 里程碑 | 支持 | `tracker.class.Milestone`；`createDoc` / `updateDoc`；`MilestoneStatus`；`Issue.milestone` | 官方 `issue-update.ts`：`label`、`status`、`targetDate`、`comments: 0`。 |
| 组件 | 部分支持 | `Issue.component`（官方创建示例置 `null`）；社区多用 `tracker.class.Component` | 产品文档有 Components（一任务只能属于一个组件）。完整 CRUD **待对照实例模型验证**。 |
| 筛选 | 支持 | `findAll` 查询字段：`space`、`status`、`assignee`、`milestone`、`component`、`priority`、`dueDate` 等 | 官方示例：`status: { $nin: [tracker.status.Done, tracker.status.Canceled] }`。 |
| 搜索 | 部分支持 | 公开 `PlatformClient` **没有**独立 search 方法 | 可用精确/前缀条件查询，或先拉列表再过滤。全文检索是否走独立接口 **待验证**。 |
| 指派 | 支持 | `Issue.assignee`；人员 `contact.class.Person`（及 `contact.mixin.Employee`） | 官方有 `person-list.ts` / `person-create.ts`。 |
| 状态流转 | 支持 | `updateDoc` 更新 `status`；`project.defaultIssueStatus`；`tracker.status.Done` / `Canceled` | 具体状态 ID 应以该项目的 `ProjectType.statuses` 为准，避免写死。 |
| 优先级 | 支持 | `Issue.priority`，`IssuePriority` | 产品与 SDK：无 / 低 / 中 / 高 / 紧急。 |
| 估算与工时 | 部分支持 | 字段 `estimation`、`remainingTime`、`reportedTime`、`reports` | 估算在官方创建示例中已出现。上报工时的独立记录 class 官方 examples 未覆盖；社区 MCP 有 time 操作，**待验证**。 |
| 截止日期 | 支持 | `Issue.dueDate` | 官方更新示例已使用。 |
| 开始日期 | 待验证 | 社区记录 `startDate` 于 2026-07-09 进入 platform（#10851） | 已发布的 `@hcengineering/tracker@0.7.423`（2026-05-10）可能尚无此字段，需对照自建版本。 |
| 关联 / 阻塞 | 待验证 | 产品：Related to、Blocked by；社区 MCP 有 relations 操作 | 官方 examples 未演示。具体 class 或字段 **待验证**。 |
| 任务模板 | 待验证 | 产品有 Issue templates；社区多用 `tracker.class.IssueTemplate` | 官方 examples 未演示。 |
| 通知 / 收件箱 | 待验证 | 产品有 Inbox 与通知设置 | `PlatformClient` 无专用通知方法。可能为 `notification.class.*`，**待验证**。 |
| 文档 | 支持 | `document.class.Teamspace`；`document.class.Document`；`uploadMarkup` / `fetchMarkup`（属性 `content`） | 官方 `document-list.ts`、`document-create.ts`：`title`、`content`、`parent: document.ids.NoParent`、`rank`。 |
| 附件 | 部分支持 | `connectStorage`；`StorageClient.put/get/stat/remove`；`core.class.Blob` | 上传下载链路是官方的。把 blob 挂到任务上的 attachment class / collection，官方 examples **未演示**，**待验证**。 |
| 实时更新 | 部分支持 | `connect()` 维持 WebSocket；公开类型未提供 `subscribe` | 底层连接具备实时潜力，但 api-client 未封装订阅。第一期可用短轮询，实时方案 **待验证**。 |
| 协作者 | 待验证 | 产品有 Collaborators | 官方 examples 未出现对应字段。 |
| 排序 | 支持 | `Issue.rank` + `@hcengineering/rank` 的 `makeRank`；`SortingOrder` | 官方创建/列表示例使用。 |
| 活动时间线 | 待验证 | 产品有 Activity | 官方 api-client 示例未演示 activity class。 |
| 删除任务 | 支持（通用能力） | `removeDoc` / `removeCollection` | 通用 API 支持；官方 issue 示例未单独演示删除，权限与级联 **待验证**。 |

未发现「产品有、但 API 明确做不到」的项。缺口主要是：**官方示例没有覆盖到的 class 名称**，以及 **公开客户端没有封装的实时/搜索/通知接口**。这些一律标为待验证，不编造。

## 4. 界面说明

设计原则：接近 Jira 的清晰信息层级（列表 + 看板 + 右侧属性），但使用中文、自己的产品名 **Huly Desk**，不做 Jira 品牌模仿。窗口采用浅色 macOS 标题栏与交通灯，界面克制、密度适中。

可点击原型（浏览器直接打开）：

`/workspace/huly-mac-design/prototype.html`

原型全部为虚构示例数据，顶部黄条已标明；登录、评论、创建都不会访问 `https://lm.all666.cn:666/`。快捷键：⌘K / Ctrl+K 命令面板，C 新建，/ 聚焦搜索，Esc 关闭。

关键页面截图：

1. `01-login.png` — 连接服务器：地址（含 666 端口）、工作区 slug、邮箱密码 / token 两种方式
2. `02-issue-list.png` — 左侧栏（项目、我的任务、通知、文档）+ 列表（筛选、搜索、按状态分组）+ 右侧任务详情
3. `03-board.png` — 看板（可拖拽卡片改状态）
4. `04-issue-detail.png` — 加宽后的详情：描述、子任务、附件、评论、活动；右侧状态、指派人、优先级、标签、里程碑、组件、截止日期、估算
5. `05-create-issue.png` — 新建任务弹窗
6. `06-command-palette.png` — 命令面板

界面结构建议（与原型一致）：

- 左侧：工作区名、搜索/命令入口、我的任务、通知、文档、项目列表
- 主区：列表或看板，顶部筛选芯片与搜索
- 右侧：任务详情与属性栏，可加宽或关闭
- 全局：创建任务弹窗、命令面板

## 5. 技术选型

| 方案 | 优点 | 缺点 | 与 api-client 的关系 |
| --- | --- | --- | --- |
| Swift / SwiftUI 原生 | 最符合 macOS 观感，钥匙串与证书体系成熟 | 工作量大；要重写连接协议，或只走 REST 再自己接协作与上传 | api-client 是 TypeScript。原生不能直接用。虽然有 `connectRest`，但描述依赖 `COLLABORATOR_URL` 的 markup 客户端，存储实现还用到 Node stream。等于几乎重写 SDK。 |
| Electron | 与官方桌面端同类，可直接用 TS SDK | 体积大、内存高；窗口质感偏网页；官方发行通道已不可用，不代表要沿用这个壳 | 前端可复用 `@hcengineering/api-client`，但体验与安装包都偏重。 |
| **Tauri 2 + React + TS（推荐）** | 安装包小，有原生窗口；前端直接用官方 TS/WebSocket 库；Rust 侧做钥匙串与证书 | 需要处理 SDK 里部分 Node 假设（见风险） | `packages/api-client/src/socket/browser.ts` 提供浏览器 WebSocket factory。数据层不必自研。 |

**推荐：Tauri 2 + React + TypeScript + 官方 `@hcengineering/api-client`。**

理由：这个项目的核心难点是正确使用 Huly 的文档模型、markup 和登录，而不是再做一套原生网络协议。SDK 已支持自建 URL、密码和 token。Swift 会把「重写协议」变成主风险；Electron 能跑 SDK，但太重，也不符合「简单清晰」的桌面观感。

配套建议：

- 前端：`connect()` + 浏览器 WebSocket factory（Node 环境才用 `NodeWebSocketFactory`）
- Rust 插件：Keychain 存 token、自定义 CA / 用户信任自签证书、必要时协助上传文件
- 描述编辑第一期用 Markdown（`uploadMarkup` / `fetchMarkup`），不做完整协同光标
- 注意：`StorageClient` 源码使用 Node `Readable`，WebView 里可能要做薄封装，这是第一期技术风险之一

## 6. 连接与登录

### 6.1 服务器地址

用户填写完整 Origin，例如 `https://lm.all666.cn:666/`。非标准端口是 URL 的一部分，SDK 没有特殊限制。客户端应：

1. 规范化末尾斜杠
2. 请求 `{url}/config.json`
3. 用返回的 `ACCOUNTS_URL`、`COLLABORATOR_URL`、`FILES_URL`、`UPLOAD_URL` 继续登录与上传

若 config 里是内网主机名或另一端口，本机必须也能解析访问，否则会出现「首页连得上、登录或描述加载失败」。这一点要在拿到真实 config 后复核。

### 6.2 工作区「公司」

API 要的是 **URL slug**，不是显示名。网页里若显示「公司」，应查看地址栏 `/workbench/` 后面那一段。

界面建议：

- 登录表单明确标注「工作区标识（URL 中的名字，不是显示名）」
- 若后续能列出工作区（account API，待验证），登录后再用显示名选择，并保存 slug
- 在未验证列表接口前，请 Bill 提供 slug。原型里暂用示例 `gongsi`，**不可当作真实值**

### 6.3 两种登录

- 邮箱 + 密码 + workspace → `connect(url, { email, password, workspace, socketFactory, connectionTimeout })`
- token + workspace → `connect(url, { token, workspace, ... })`

成功后只把 **token**（以及 url、slug）写入钥匙串；密码不要长期保存。下次启动用 token 静默登录，失败再回登录页。

### 6.4 钥匙串

- 服务名建议：`Huly Desk`
- 账号键：`{serverOrigin}|{workspaceSlug}`
- 存 token，不存密码明文
- 不要使用社区 CLI 常见的 `~/.huly/token` 明文文件

### 6.5 自签 / 内网证书

本环境未能完成 TLS，证书情况未知。设计上预留：

- 优先：把机构 CA 或自签根证导入系统钥匙串并标记信任
- 应用内：高级选项「信任该服务器证书」（须明确风险提示，且仅针对用户确认的主机+端口）
- Tauri/Rust 使用自定义根证书；避免全局关闭证书校验

## 7. 分期计划

### 第一期 MVP（建议 1 人 4–6 周，或 2 人 3–4 周）

范围尽量小、但日常能用：

1. 连接页：服务器 URL、workspace slug、邮箱密码 / token，探测 `config.json`
2. 钥匙串保存 token；自签证书策略
3. 项目列表、任务列表、按状态/指派人/优先级筛选、标题与编号搜索
4. 看板，拖拽修改 `status`
5. 任务详情：Markdown 描述、状态、指派人、优先级、标签、截止日期；可选只读里程碑/组件
6. 新建任务（标题、描述、项目、状态、优先级、指派人、截止日期）
7. 基础命令面板（新建、切视图、跳转任务）

明确不做：文档、通知收件箱、附件、模板、关联/阻塞、工时上报、实时推送、子任务创建、评论（若前期验证 API 顺利，评论可作为 MVP 弹性项）。

风险：SDK 在 WebView 中的 Node 假设；`config.json` 内网端点不可达；workspace slug 与显示名不一致；自建版本与 npm 包 0.7.x 模型不一致；证书问题。

### 第二期（约 3–4 周）

- 评论（在验证 class 之后）
- 附件上传下载
- 子任务创建与父任务
- 里程碑、组件的完整管理
- 通知收件箱只读 + 标记已读（若 API 验证通过）
- 更完整筛选（标签、里程碑、截止日期）

风险：评论/附件/通知的 class 与权限未在官方示例中写清，需要对照实例模型做一次只读探查（仍不写数据直到确认方案）。

### 第三期（约 4–6 周）

- 文档（Teamspace + Document）
- 模板、关联/阻塞
- 工时上报
- 实时更新（若能封装订阅；否则优化轮询）
- 多工作区切换、离线只读缓存、菜单栏快捷创建、打磨快捷键与无障碍

风险：协同编辑深度、实时协议不稳定、范围膨胀。第三期仍应保持「简单清晰」，不把官方网页端全功能搬过来。

## 8. 待确认问题（请 Bill 回复）

1. 工作区「公司」在浏览器地址栏 `/workbench/` 后面的 **精确 slug** 是什么？
2. 日常登录用邮箱密码，还是个人 API token？token 由谁颁发、是否会过期？
3. 自建证书是公开 CA 还是自签/内网 CA？若自签，根证书能否导入公司 Mac 的钥匙串？
4. 第一期是否同意只做任务跟踪（列表 + 看板 + 详情 + 新建），文档和通知放到第二、三期？
5. 主要使用机型是 Apple Silicon 还是还要兼容 Intel？最低 macOS 版本？（建议 13+）
6. 是否需要窗口内切换多个工作区，还是先绑定这一个自建实例？
7. 若 `config.json` 里的账户/协作地址是内网主机名，客户端所在网络能否直接访问？
8. 界面语言是否固定简体中文，还是需要中英切换？

确认以上问题（尤其是 1–4）后，再开始写正式代码。
