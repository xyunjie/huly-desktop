# Huly Desk

<img src="public/favicon.svg" width="64" height="64" alt="Huly 标志" />

Huly Desk 是一个面向跨平台的 [Huly](https://github.com/hcengineering/platform) 桌面客户端，专注于项目和任务管理。用任务列表快速找到工作，用看板跟踪进度，在独立的详情页里处理描述、附件、评论和活动记录。

你可以连接自己的 Huly 实例，也可以先用示例数据体验界面。示例模式不需要账号，不连接 Huly 服务器。

## 主要功能

- **项目与任务**：切换工作区，浏览项目，创建任务和子任务，使用列表或看板跟踪进度。
- **搜索与筛选**：按标题或编号搜索，按状态、指派人、优先级、标签、里程碑和截止日期筛选。
- **任务详情**：编辑富文本描述，上传图片、视频和其他附件，发表评论，查看任务活动和描述变更。
- **协作与管理**：查看通知并跳转到对应任务；有权限的成员可以管理项目成员、里程碑、组件和任务模板。

连接真实实例时，可用功能取决于服务器版本、配置和账号权限。

## 平台状态

桌面端基于 [Tauri 2](https://tauri.app/)，界面使用 React 和 TypeScript。发布标签会构建下列桌面安装包，生成后可在 [GitHub Releases](https://github.com/xyunjie/huly-desktop/releases) 下载：

| 平台 | 安装包 |
| --- | --- |
| macOS 13 及以上（Apple Silicon 和 Intel） | 通用 `.dmg` |
| Windows x64 | `.exe` 安装程序 |
| Linux x64 | `.deb` 和 `.AppImage` |

也可以在支持 Node.js 的平台上用浏览器运行示例模式。

## 快速体验

安装 [Node.js](https://nodejs.org/)（22.12 或更新的 LTS 版本）和 [pnpm](https://pnpm.io/)，然后在项目根目录运行：

```bash
pnpm install --frozen-lockfile --node-linker=hoisted
pnpm dev:mock
```

在浏览器打开 [http://127.0.0.1:41773](http://127.0.0.1:41773)。Windows PowerShell 中可用以下命令启动示例模式：

```powershell
$env:VITE_DATA_MODE = "mock"
pnpm dev
```

## 开发桌面端

安装 Rust stable（至少 1.90）及 [Tauri 的平台开发依赖](https://v2.tauri.app/start/prerequisites/)。macOS 需要 Xcode Command Line Tools。启动桌面开发窗口：

```bash
pnpm tauri dev
```

在 Mac 上生成同时兼容 Apple Silicon 和 Intel 的安装包：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin --bundles dmg
```

`.dmg` 位于 `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`。

## 连接 Huly

1. 在登录页的「高级设置」中填写 Huly 的入口地址，例如 `https://huly.example.com`。如果服务使用非默认端口，请保留端口号。无需填写具体的任务或工作区页面路径。
2. 使用邮箱和密码，或使用实例签发的 API 令牌登录。
3. 从列表中选择你有权访问的工作区。桌面端使用系统凭据存储保存登录会话，不保存密码；退出登录会清除该会话。Linux 如需跨重启保留登录，需要系统提供 Secret Service。

如果无法连接，先检查实例是否可访问，以及入口地址的 `/config.json` 是否能正常读取。自建实例的账户服务和协作服务也必须能从客户端访问。若使用私有 CA，请确保系统信任该证书；若看不到某个工作区，请在 Huly 网页端确认账号权限。

## 开发检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 发布版本

正式版本从 `1.0.0` 开始。在需要发布的提交上创建并推送 `vX.Y.Z` 标签，例如：

```bash
git tag -a v1.0.0 -m "Huly Desk v1.0.0"
git push origin v1.0.0
```

GitHub Actions 会使用标签中的版本号并行构建 macOS、Windows 和 Linux。三端全部成功后，工作流会创建 GitHub Release 并附上安装包和 `SHA256SUMS.txt`；在 Actions 页面手动运行工作流只生成构建产物，不发布版本。当前安装包未使用开发者证书签名，macOS 版本也未公证。

欢迎提交 Issue 或 Pull Request。报告连接或界面问题时，请注明平台、Huly 版本和复现步骤，并隐去令牌、密码及私有服务器地址。

图标来自 [Huly 上游项目](https://github.com/hcengineering/platform/blob/main/dev/prod/public/huly/favicon.svg)。Huly Desk 是独立客户端，并非 Huly 官方应用。
