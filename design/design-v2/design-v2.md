# Huly Desk 工作区内结构改版（设计稿 v2）

- 状态：仅设计，不改 `/workspace/huly-desk/local/app` 的正式代码，不提交、不推送，未连接真实服务器，未读取 token
- 日期：2026-11-18（Asia/Shanghai）
- 范围：进入工作区之后的信息架构（项目列表、员工管理、沉浸式项目视图、账号区）
- 登录与工作区选择沿用上一轮方案，本稿不再展开
- 可点击原型：同目录 `prototype-v2.html`（示例数据，1440×900，macOS 覆盖式标题栏 28px）
- 截图：同目录 `01-project-list.png` … `16-project-switcher.png`

## 1. 结论先行

进入工作区后，改为「左侧导航 + 右侧内容」：

1. **项目列表**：一眼看到该工作区的全部项目（表格），再点「进入项目」。
2. **员工管理**：工作区成员的管理后台（名单、角色、邀请）；接口不支持的操作在界面上只读，并标「暂不支持」。
3. **进入项目**后是沉浸式任务界面：去掉标准左侧导航，整窗给列表 / 看板 / 详情（右侧抽屉）。顶栏提供返回、可搜索的项目切换、视图与筛选。

左下角账号区只保留 **头像 + 姓名**。点击后出现菜单：切换工作区、个人中心、退出登录。去掉「令牌已写入 macOS 钥匙串」「断开连接」，以及顶栏的工作区下拉。

建议同时把 **我的任务** 留在左侧菜单（跨项目、常用）；**通知** 放到 28px 标题栏右侧铃铛，第一期只做占位。

## 2. 窗口与整体布局

- 窗口 1440×900。覆盖式标题栏高 **28px**，左上角留出系统红黄绿按钮区域（三颗 12px 圆点，垂直居中）。标题「Huly Desk」与按钮垂直对齐，位于灯号右侧，不再画第二套按钮，内容铺满标题栏以下区域。
- 进入工作区后：左侧栏约 240px，右侧为内容区。左侧自上而下：工作区显示名（纯文字，不可点）、菜单、底部账号。
- 账号区只有头像和姓名，不加说明文字。菜单向上弹出：
  - **切换工作区**：右侧子菜单，列出全部工作区的**显示名**（不展示 slug），当前项打勾；选中后设为默认工作区并立即切换，先出现项目列表骨架再后台加载。
  - **个人中心**
  - **退出登录**（清除钥匙串会话，回到登录页）

## 3. 项目列表

右侧展示该工作区**全部项目**，默认用**表格**（不用卡片）：

- 项目往往带「代号、任务数、负责人、操作」等多列信息，表格更接近 Jira，密度合适，操作列也放得下。
- 卡片适合少量项目的浏览，会把操作和数字折到第二行。若项目经常少于 5 个，可在后续加视图切换；第一期只做表格。

| 列 | 内容 | 数据来源 |
| --- | --- | --- |
| 代号 | 如 CORE、509南昌 | `tracker.class.Project.identifier` |
| 名称 | 项目名 | `Project.name`（继承自 Space） |
| 任务数 | `未完成 / 全部`，如 4 / 6 | 进入工作区后按项目统计 `tracker.class.Issue`（已完成 / 已取消不算未完成） |
| 成员 | 头像组，最多 4 个，超出显示 +N | `Project.members`（`Space.members: AccountUuid[]`） |
| 负责人 | 头像 + 姓名，没有则「未设置」 | 优先 `Project.defaultAssignee`，否则 `owners[0]` |
| 更新时间 | 相对或 `YYYY-MM-DD` | `Doc.modifiedOn` |
| 操作 | 进入项目、添加成员、编辑；归档放在编辑对话框里 | 见第 6 节 |

表头右侧：搜索项目名称或代号；所有者 / 维护者可看到「新建项目」按钮（建议这一期不做，见开放问题）。空状态见第 8 节。

行点击或「进入项目」进入沉浸式项目视图。「添加成员」「编辑」打开对话框，不离开列表。

权限：所有成员都可以进入自己可见的项目；添加成员、编辑、归档仅 **Owner / Maintainer** 可操作，其余人只看到「进入项目」，或看到灰色操作并带「暂不支持」提示。

## 4. 员工管理

定位为工作区的管理后台，不是项目内的成员条。

表格列：姓名、邮箱、角色、状态、操作。

- 角色与 Huly `AccountRole` 对齐，界面主推四档：**所有者 OWNER、维护者 MAINTAINER、成员 USER、访客 GUEST**。若实例返回 `ADMIN` / `READONLYGUEST` / `DocGuest`，只读显示对应中文名。
- 状态：来自 `contact.mixin.Employee.active`，显示「在职 / 停用」。**没有**「待接受邀请」列表接口，邀请发出后无法在本页列出待办邀请。
- 操作（视角色而定）：
  - Owner / Maintainer：邀请成员、修改角色（不能把最后一个 Owner 改掉；Maintainer 不能改 Owner 或把别人升为 Owner，具体以服务端报错为准）。
  - Owner：移除成员（确认后调用 `leaveWorkspace(account)`，需在实例上确认可以移除他人而不只是自己）。
  - 普通成员 / 访客：整表只读，邀请与移除按钮不可用，旁注「暂不支持」。

「邀请成员」对话框：填写邮箱、选择角色（默认 USER），可选「复制邀请链接」。发送走 `sendInvite`；链接走 `createInviteLink`。没有列出历史邀请的接口，`resendInvite(email, role)` 仅在用户再次输入同一邮箱时可用。

建议：**所有角色都能看到「员工管理」菜单**，避免菜单随分身隐藏造成「功能丢失」的错觉；权限不够时页面只读。若 Bill 希望菜单本身对普通成员隐藏，也可以，见开放问题。

## 5. 沉浸式项目视图

进入项目后不再显示工作区左侧导航。

顶栏（标题栏下方）：

- **← 返回项目列表**
- **可搜索的项目切换**：当前项目名称作为标题，下拉列出本工作区全部项目（显示代号 + 名称，可搜），切换时立刻换标题并出骨架，后台加载任务；已访问过的项目先出缓存。
- 列表 / 看板切换
- 筛选、搜索、创建任务（沿用现有能力）

任务详情在右侧抽屉（约 400px），列表或看板仍留在左侧，不另开整页。关闭详情后仍停留在该项目中。

「我的任务」点进某条任务时：打开该任务所在项目的沉浸式视图并展开详情，顶栏仍可返回项目列表或回到「我的任务」。

## 6. API 支持一览

依据本机已安装的 `@hcengineering/account-client` / `@hcengineering/api-client` / `@hcengineering/core` / `@hcengineering/tracker` / `@hcengineering/contact` **0.7.423** 源码与类型（只读查看，未打真实服务）。客户端库**没有写明**各 RPC 所需角色，下面「建议权限」按 `hasAccountRole` / `roleOrder`（Maintainer=40、Owner=50）以及常见后台行为推断，**真正限制以服务端为准**，失败时用中文说明。

| 功能 | 支持情况 | 确切方法 / 字段 | 说明与建议权限 |
| --- | --- | --- | --- |
| 列出工作区成员 | 支持 | `accountClient.getWorkspaceMembers()` → `WorkspaceMemberInfo[]`（`person: AccountUuid`, `role: AccountRole`） | 需再补姓名邮箱。建议所有已登录成员可调。 |
| 补全姓名 | 支持 | `accountClient.getPersonInfo(account)`（`PersonInfo`：`name`、`socialIds`）；或工作区内 `findAll(contact.class.Person)` / `contact.mixin.Employee` | `name` 多为「姓,名」，中文展示姓在前。 |
| 补全邮箱 | 支持 | `getPersonInfo` 的 `socialIds`（`SocialIdType.EMAIL`）；或 Person 上的 Channel / SocialIdentity | 没有单独的「成员邮箱」字段。 |
| 在职状态 | 支持 | `contact.mixin.Employee.active`（另有非正式的 `role?: 'USER' \| 'GUEST'`，以工作区 `AccountRole` 为准） | 只读展示。 |
| 修改工作区角色 | 支持 | `accountClient.updateWorkspaceRole(targetAccount, targetRole)` | 建议仅 Owner，或 Maintainer 只能改 USER/GUEST。 |
| 邀请（发邮件） | 支持 | `accountClient.sendInvite(email, role)` | 建议 Owner / Maintainer。 |
| 再发邀请 | 支持 | `accountClient.resendInvite(email, role)` | 无邀请列表，只能按邮箱再发。建议同上。 |
| 生成邀请链接 | 支持 | `accountClient.createInviteLink(email, role, autoJoin, firstName, lastName, navigateUrl?, expHours?)` → `string` | 建议 Owner / Maintainer。对话框可「复制链接」。 |
| 查看某条邀请 | 只读 | `accountClient.getInviteInfo(inviteId)` | 必须已有 inviteId；**没有** `listInvites`。待接受邀请不在员工表里展示。 |
| 移除成员 | 支持（需验证） | `accountClient.leaveWorkspace(account: AccountUuid)` | 这是公开接口里唯一带目标账号的「离开工作区」。需在实例上确认 Owner 可对他人调用。建议仅 Owner，并禁止移走最后一个 Owner。界面先做确认框。 |
| 平台级直接分配 | 不支持（本客户端不用） | `assignWorkspace(email, workspaceUuid, role)`、`updateWorkspaceRoleBySocialKey` | 与 worker / 后台管理接口放在一起，不适合普通桌面端邀请流程。 |
| 列出项目 | 支持 | `findAll(tracker.class.Project)` | 进入工作区后一次性拉取。 |
| 项目成员 | 支持 | `Project` 继承 `Space.members: AccountUuid[]`，另有 `owners?`、`defaultAssignee?` | 用现有成员补头像姓名。 |
| 添加 / 移出项目成员 | 支持 | `updateDoc(tracker.class.Project, space, projectId, { members })`（或 `$push` / `$pull`） | 建议 Owner / Maintainer。备选池应为**本工作区成员**，不能邀请工作区外的人进单个项目（那是员工管理的事）。 |
| 编辑项目 | 支持 | `updateDoc`：`name`、`description`、`private`、`defaultAssignee`、`identifier` 等 | 改代号可能影响 `CORE-123` 这类编号，对话框里要警告，或第一期禁止改代号。建议 Owner / Maintainer。 |
| 归档项目 | 支持 | `updateDoc(..., { archived: true })`（`Space.archived`） | 建议放在编辑对话框，默认不直接列在操作列。建议 Owner / Maintainer。归档项目从默认列表隐藏，可加「显示已归档」。 |
| 新建项目 | 支持（建议缓做） | `createDoc(tracker.class.Project, …)`，需 `identifier`、`type`、`defaultIssueStatus`、`sequence` 等；另有权限 `tracker.permission.ForbidCreateProject` | 字段比编辑多，建议下一期。 |
| 统计任务数 | 支持 | `findAll(tracker.class.Issue, { space: projectId })` 或按项目分组统计 | 可在拉完项目后异步补齐，先出「—」。 |
| 当前登录者资料 | 支持 | `getPerson()`、`getUserProfile(personUuid?)`、`getAccountInfo(uuid)`、`client.getAccount()` | 个人中心只读展示足够。 |
| 改姓名 | 支持 | `accountClient.changeUsername(first, last)` | 第一期可先只读，见开放问题。 |
| 改个人简介等 | 支持 | `setMyProfile({ bio, city, country, website, socialLinks, isPublic })` | 非必须，可只读或放后续。 |
| 我的任务 | 支持 | `findAll(tracker.class.Issue, { assignee })` | 沿用现有。 |
| 通知收件箱 | 不支持（本期） | 公开 `PlatformClient` / `AccountClient` 无现成 Inbox API | 标题栏铃铛占位，点击说明后续提供。 |

`AccountRole` 全量：`READONLYGUEST`、`DocGuest`、`GUEST`、`USER`、`MAINTAINER`、`OWNER`、`ADMIN`。辅助判断：`hasAccountRole(account, role)`、`isOwnerOrMaintainer()`（均在 `@hcengineering/core`）。

## 7. 加载、缓存与过期请求

- **进入工作区**：左侧和「项目列表」标题立刻出现，表格走 antd Skeleton；先拉全部项目，再异步补任务数和成员头像。不要等全部补齐才切页。
- **切菜单**（项目列表 / 我的任务 / 员工管理 / 个人中心）：立即换页。有缓存先渲染缓存，同时后台刷新，标题旁可显示「正在更新…」。无缓存则骨架。
- **切工作区 / 切项目**：同样「先切后加载」。用世代号（generation）丢弃上一次尚未返回的请求，避免旧工作区数据写进新页面。
- **缓存粒度**：工作区 → 项目列表、成员列表；项目 → 任务包（状态、里程碑、任务、标签）。「退出登录」或手动刷新清空。切换默认工作区后写入钥匙串（只存账号令牌与默认工作区，不存密码）。

## 8. 个人中心、我的任务、通知、空状态

**个人中心**（账号菜单进入，仍用工作区左侧壳）：展示头像、姓名、邮箱、当前工作区角色。第一期默认只读；资料来自 `getPerson` / `getPersonInfo` / `getUserProfile`。不在这里做改密（账号系统未提供给桌面端的简单改密流程，且密码本就不会入库）。

**我的任务**：左侧第二项，表格列出指派给自己的、跨项目的任务；点开进入对应项目的沉浸式详情。

**通知**：标题栏右侧铃铛，第一期点击后是空状态：「通知将在后续提供」。

**空状态**（文案示例）：

- 项目列表：「这个工作区还没有项目。」Owner / Maintainer 可提示到网页端创建，或等下一期的新建项目。
- 员工管理：「还没有其他成员。」（仍显示自己）并提供邀请。
- 项目内任务：「该项目还没有任务。」配「创建任务」。
- 我的任务：「没有指派给你的任务。」

## 9. 实现分期与耗时（一人、在现有代码上改）

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| A. 壳体 | 左下账号菜单、工作区子菜单、去掉钥匙串提示 / 「断开连接」/ 顶栏工作区下拉；退出登录仍清会话 | 0.5–1 天 |
| B. 项目列表 | 进入工作区先拉全部项目；表格列、任务数异步、骨架与缓存 | 1–1.5 天 |
| C. 项目对话框 | 添加成员、编辑（含归档开关）；`updateDoc` 写回 | 1 天 |
| D. 沉浸式项目 | 现有列表 / 看板 / 详情迁入；返回、可搜索项目切换、右侧详情抽屉 | 1–1.5 天 |
| E. 员工管理 | 成员列表补全、改角色、邀请 / 复制链接、移除（含权限只读态与「暂不支持」） | 1.5–2 天 |
| F. 收尾 | 个人中心、我的任务入口、空状态、真实数据下在 Mac 上自测截图 | 0.5–1 天 |

合计约 **6–8 个工作日**。未含「新建项目」向导，也未含通知收件箱。员工管理里「移除他人」若实例拒绝 `leaveWorkspace`，需要再排时间改文案或拿掉该按钮。

## 10. 想请 Bill 定的四件事

1. 普通成员要不要看到「员工管理」？建议看到、但只读并标「暂不支持」。
2. 这一期要不要做「新建项目」？归档是放在编辑对话框，还是先不做？
3. 个人中心这一期是否允许改姓名（`changeUsername`），还是先只读？
4. 「我的任务」放在左侧菜单是否合适？

确认后按上面分期改正式代码；本目录只是设计与原型。
