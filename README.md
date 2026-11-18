# Huly Desk

面向自建 Huly（[hcengineering/platform](https://github.com/hcengineering/platform)）的 macOS 任务客户端，第一期只做任务跟踪。界面用 Ant Design 5，简体中文，列表、看板和详情并排。快捷键在窗口里的「快捷键」和命令面板里，不在顶部横幅。

生产环境默认使用官方 [`@hcengineering/api-client`](https://github.com/hcengineering/huly.core)（本仓库锁定 0.7.x）连接工作区。示例数据走同一套 `DeskClient` 接口，不访问网络，方便在连不上实例的机器上开发和看界面。

默认服务器是 `https://lm.all666.cn:666`，默认工作区 slug 是 `ws-6aa0e320-776b6c69e0-2f809f`（网页里显示为「公司」）。登录页可以改这两项。

## 在 Mac 上构建

只支持 Apple Silicon（`aarch64-apple-darwin`），最低 macOS 13 Ventura。Intel Mac 会在编译时直接失败。

需要：

- Xcode Command Line Tools（`xcode-select --install`）
- Node.js 22（或当前的 Node 20+）
- Rust 1.90 或更新的 stable（`curl https://sh.rustup.rs -sSf | sh`，然后新开一个终端）。锁定的桌面壳是 Tauri `2.12.6`，命令行是 `@tauri-apps/cli` `2.12.5`。界面使用 Ant Design 5，中文语言包。

```bash
rustup update stable
rustup target add aarch64-apple-darwin
npm i
npm run tauri dev
```

打安装包（未签名的 `.app` / `.dmg`，需要在这台 Mac 上执行，Linux 虚拟机做不到）：

```bash
npm run tauri build -- --target aarch64-apple-darwin
```

产物在 `src-tauri/target/aarch64-apple-darwin/release/bundle/`。第一次打开未签名应用时，如果系统拦截，在「系统设置 → 隐私与安全性」里允许，或对 `.app` 执行 `xattr -dr com.apple.quarantine`。

只检查前端、不启动窗口：

```bash
npm run typecheck
npm test
npm run build
npm run dev:mock
```

`npm run dev:mock` 在浏览器里打开示例数据，地址是 `http://127.0.0.1:41773`。`npm run dev` 和 `npm run tauri dev` 默认走真实连接。

## 登录

1. 服务器地址填完整 URL，可以带非标准端口。末尾的 `/` 会被去掉，然后请求 `{地址}/config.json`，从中读取 `ACCOUNTS_URL`、`COLLABORATOR_URL`，以及可选的 `FILES_URL`、`UPLOAD_URL`。这和网页端一致。
2. 工作区填 `/workbench/` 后面的 slug，不是显示名「公司」。
3. 邮箱密码或访问令牌都可以。密码只用于这一次登录，不会写入磁盘或钥匙串。
4. 登录成功后，账号令牌、服务器地址、slug 和邮箱写入 macOS 钥匙串，服务名是 `Huly Desk`。下次可以留空令牌，直接用钥匙串里的那一个。
5. 勾选「使用示例数据」会进入虚构的 CORE / APP / CS 项目，不发包。

断开连接会删掉钥匙串里的会话。自定义 CA 的 PEM 存在另一条钥匙串记录里，断开连接不会清掉它。

## 连接失败时

- **读不到 config.json**：地址或端口不对，或者这台 Mac 访问不到实例。先在浏览器打开 `https://lm.all666.cn:666/config.json`。
- **证书不受信任**：默认只信任系统里的公开 CA。自签或内网 CA 时，把 PEM 贴进登录页的「证书选项」。探测 `config.json` 会使用这张证书；如果勾了「探测时信任此地址的证书」，只对这一次探测请求放宽校验，不会关闭整个系统的校验。窗口里的 WebSocket 仍走系统信任库，所以同一张 CA 还要导入「钥匙串访问」并设为始终信任，否则登录会在探测成功后的连接阶段失败。
- **找不到工作区**：slug 写错了。不要填显示名。
- **登录没有通过**：邮箱、密码或令牌不对。令牌过期后需要重新颁发。应用不会把口令或令牌打进日志。
- **config.json 里的账户或协作地址是内网主机名**：客户端所在的网络也必须能解析并访问这些地址，不能只通前端这一个端口。
- **钥匙串写入失败**：令牌只留在本次进程内存里，退出即丢。macOS 上如果弹出钥匙串授权，需要允许。

## 第一期范围

可以做：连接、项目列表、任务列表（状态 / 指派人 / 优先级 / 标签 / 标题和编号搜索 / 分组）、看板拖拽改状态、任务详情编辑（标题、描述、状态、指派人、优先级、标签、里程碑、组件、截止日期）、子任务列表、新建任务、命令面板和快捷键（⌘K 或 Ctrl+K，C 新建，/ 搜索，Esc 关闭）。

示例数据里可以发评论，只留在内存。真实连接可以尝试读取 `chunter:class:ChatMessage`，但**不能写评论**。官方示例没有评论脚本，消息正文是协同文档，字段还没在这台实例上确认。

不做：文档、通知收件箱、附件、模板、工时上报、关联任务、实时推送。侧栏里的「通知」「文档」会说明这一点。

## 数据从哪来

| | 示例模式 | 真实连接 |
| --- | --- | --- |
| 项目、任务、人员 | `src/data/mock` 里的虚构数据 | `@hcengineering/api-client` 的 `connect` + `findAll` / `updateDoc` / `addCollection`。顶层任务的 `attachedTo` 是 `tracker:ids:NoParent`，父任务只看 `parents` |
| 描述 | 普通字符串 | `fetchMarkup` / `MarkupContent`，和官方 `issue-create.ts` 一样 |
| 状态列 | 固定的待办池 / 待办 / 进行中 / 完成 | 项目 `ProjectType.statuses`，类别来自状态文档 |
| 评论 | 可写 | 只读尝试，写入明确拒绝 |
| 令牌 | 不保存 | macOS 钥匙串 |

`npm run dev:mock` 或登录页勾选示例数据时走 mock。其余情况，包括 `npm run tauri dev` 和打包后的应用，默认走真实客户端。
