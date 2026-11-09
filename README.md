# Hycl-online

Hyplay Craft Launcher（Hycl）的联机工具仓库：插件分发源 + 陶瓦联机工具托管。

## 这个仓库放什么

| 内容 | 位置 | 谁来更新 |
| --- | --- | --- |
| 插件清单 `online.json` | 仓库根目录 | `sync-terracotta.yml` 自动 / 本地脚本手动 |
| Terracotta 二进制（6 平台 tar.gz） | Releases（`terracotta-v*` 标签） | `sync-terracotta.yml` 每日自动同步 |
| Hycl 联机插件包 `Hycl.Online-v*.zip` | Releases（`plugin-v*` 标签） | 本地打包后手动上传或 `update-manifest.cjs plugin` |

Hycl 启动器在「设置 → 插件工坊」读取本仓库的 `online.json`（支持在插件工坊自定义清单源地址），
据此完成插件的发现、下载（SHA-256 锁定）、安装、更新、卸载与启用/禁用。启用的插件会出现在
「工具」页，点「进入」打开该插件自己的功能设置页。

## 插件在启动器中的呈现

对照 KAMUCL（设置页管理插件、侧栏进入功能页）的三段式结构：

| 位置 | 作用 |
| --- | --- |
| 设置 → 插件工坊 | 清单源地址、插件列表（下载 / 更新 / 卸载 / 启用 / 禁用）、安装进度、重启提示 |
| 工具页 | 只列出**已启用**插件的入口卡（名称、版本、描述 + 「进入」） |
| 工具页 → 进入 | 插件自己的功能设置页。陶瓦联机包含建房 / 加入 / 连接日志，以及「插件设置」折叠区（插件版本、工具版本、平台、工具目录、重新校验、修复安装） |

- 启用状态写在启动器数据目录的 `plugins-state.json`，格式 `{"disabled":["<plugin id>"]}`：
  **未记录即视为启用**（新装插件默认可用），禁用只隐藏工具页入口，卸载才会停止插件进程并删除目录。
- 插件 ABI 仍为 **1**。v1.1.0 起插件实现可选的 `IHyclPluginFeaturePage` 声明功能页；
  旧包（v1.0.0）未实现时宿主回退到 ABI v1 的 `CreateToolCard()`，因此旧包也能「点进去」，
  只是没有新增的「插件设置」区。
- 功能页控件**延迟创建**：启动加载插件时只登记工厂，用户首次点「进入」才构造控件，
  避免启动期构造 Avalonia 控件和触发插件内部的后台校验请求。

## 全平台支持

| 层 | 平台处理 |
| --- | --- |
| 启动器本体 | Hycl 仓库 `.github/workflows/build.yml` 的 6 RID 矩阵（win / linux / mac × x64 / arm64），每个 RID 出自包含单文件与框架依赖单文件，macOS 额外打 `.app` |
| 插件包 | `Hycl.Online.dll` 是 anycpu 托管程序集（Avalonia 12.1.4 + ABI v1 契约），**同一个 zip 供全部平台安装**，不需要分平台构建 |
| Terracotta 工具 | `online.json` 的 `tools.terracotta.assets` 覆盖 6 平台；插件按 `HyclOnlineTools.ToolAssetKey` 选资产，Unix 上自动 `chmod +x`，包与可执行文件双 SHA-256 校验 |
| 游戏启动 | Hycl 侧 `PlatformInfo` / `JavaDetector` 按平台选 Java、游戏目录与 classpath 分隔符，Win32 窗口注入只在 Windows 生效；macOS 的 LWJGL 2 老版本自动补 `-XstartOnFirstThread` |

因此 `build-plugin.yml` 只发布一个与平台无关的插件包；`sync-terracotta.yml` 与 `deploy-edgeone.yml` 负责 6 平台二进制的同步与托管。

## 清单 schema（v1）

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "…",
  "plugins": [          // Hycl 插件包（zip：plugin.json + 插件 dll）
    { "id": "hycl.online", "name": "陶瓦联机", "version": "1.0.0",
      "abi": 1, "minLauncherVersion": "1.0.0",
      "url": "…zip 直链", "sha256": "…", "size": 12345 }
  ],
  "tools": {            // 插件消费的外部工具（按运行平台挑选资产）
    "terracotta": {
      "version": "0.4.2",
      "assets": {
        "win-x64":  { "urls": ["…"], "fileName": "…", "exeName": "…", "sha256": "…", "exeSha256": "…", "size": 0 },
        "win-arm64": {}, "linux-x64": {}, "linux-arm64": {}, "darwin-x64": {}, "darwin-arm64": {}
      }
    }
  }
}
```

- `sha256`：下载包整体哈希；`exeSha256`：解压出的可执行文件哈希（双重校验）。
- `urls`：按序尝试的源列表（部署 EdgeOne 后为 EdgeOne 直链在前，GitHub Release 与官方镜像兜底；
  其中 GitHub 链接由启动器镜像池自动展开，原站永远最后）。
- `plugins[].mirrors`：插件包备用地址（EdgeOne 为主源时填 GitHub Release）。
- `abi`：插件契约版本，与启动器内建的 ABI 不一致时插件会被拒绝加载。

## 下载链路与加速源

启动器对 GitHub 文件的下载策略（自动换源，GitHub 原站永远托底）：

1. **EdgeOne 托管源**（已部署时自动排第一，走绑定的自定义域名 `hyclonline.mcapp.eu.org`）
2. **官方镜像**（terracotta 专有：gitee / cnb.cool）
3. **GitHub 加速镜像池**（内置 5 个，按实测延迟自动排序，失败沉底）：
   `gh-proxy.com` → `ghfast.top` → `ghproxy.link` → `ghproxy.net` → `mirror.ghproxy.com`
4. **GitHub 原站**（托底）

镜像池在启动器内每 10 分钟后台探测一次（HEAD + 2.5s 超时），按响应时间重排；镜像域名失效
无需更新启动器（自动沉底）。初始顺序为 2026-11-08 实测（阿里 DoH 解析 + 真实文件拉取）。

## EdgeOne Pages 托管（自定义域名主源）

把清单与全部二进制托管到 EdgeOne Pages，作为启动器下载的主源；GitHub Release、官方镜像与
启动器镜像池保留为兜底。当前站点为 **`https://hyclonline.mcapp.eu.org`**。

> **必做：绑定自定义域名。** Pages 默认的项目域名 / 部署域名不是稳定公开入口——加速区域
> 含中国大陆时须使用系统生成的预览链接（有效期 3 小时，超时返回 401）；加速区域为
> 「全球可用区（不含中国大陆）」时，中国大陆网络直接返回 401。因此仓库 Variable
> `EDGEONE_SITE_URL` 与启动器 `HyclOnlineSites.EdgeOneSiteUrl` 都必须填这个自定义域名，
> **不要填 `*.edgeone.app` 等预览域名**（该域名格式属于国际站）。全球可用区（不含中国大陆）
> 绑定自定义域名无需 ICP 备案，但没有中国大陆 CDN 节点，国内下载速度弱于国内站；主源不可用
> 时启动器会自动降级到 GitHub 镜像池与原站，且全程有双 SHA-256 校验。

### 部署方式：EdgeOne 控制台 Git 集成（当前使用）

项目 `hycl-online`（ID `makers-fpskvpkc0rcg`）是 **Provider `Github`** 的 Git 导入型项目，
每次 push 到 `main` 会自动构建并发布。CLI 的 `edgeone pages deploy` 直传**不适用于此项目**：
`getOrCreateProject ... Only projects with Provider 'Upload' are supported`（项目类型不可原地
转换）。因此部署完全交给 Git 集成，GitHub Actions 只做独立校验。

控制台 → 项目 → **Project Settings → Build Deployment Configuration → Edit**：

| 字段 | 值 |
| --- | --- |
| Preset framework | `Other` |
| Root directory | `./` |
| Build output directory | `dist` |
| Compile commands | `node scripts/build-dist.cjs` |
| Install command | 留空（脚本零依赖） |

> 配置改动在**下一次部署**生效。`scripts/build-dist.cjs` 按 `online.json` 的 6 个 `fileName`
> 与 `sha256`，从 `urls`（上游 GitHub / gitee / cnb / ghproxy）多源回退下载 6 个 tar.gz，
> 再下载插件 zip，最后调用 `update-manifest.cjs stage` 把 `dist/online.json` 改写为 EdgeOne
> 地址优先并逐个校验哈希。站点地址取环境变量 `EDGEONE_SITE_URL`，未配置时回退到内置默认值
> `https://hyclonline.mcapp.eu.org`。6 个包最大约 14.74 MB，低于 25 MB 单文件上限。

### GitHub Actions：只校验，不部署

`.github/workflows/deploy-edgeone.yml`（名字沿用 `Deploy EdgeOne`）在 `online.json` / 构建脚本
变更或手动触发时跑同一个 `build-dist.cjs`，产出并校验 `dist/`，提供独立于 EdgeOne 的健康检查，
**不再执行** `npx edgeone pages deploy`。仓库 **Variable** `EDGEONE_SITE_URL` 仍是必需项（stage
改写用）；`EDGEONE_API_TOKEN` Secret 不再是部署链路的必需项（保留不影响）。

### 排障：手动 Run workflow 显示 Skipped

`deploy` 作业的 `if` 要求 `vars.EDGEONE_SITE_URL != ''`。自动触发（push）在未配置时整作业跳过；
手动触发会进入作业，由 `Verify EdgeOne configuration` 报出缺失的 Variable。看到 Skipped 时检查：

1. **层级**：Settings → Secrets and variables → Actions → **Repository variables → New
   repository variable**（不是 Environment variables，也不是 Secrets 标签页）。GitHub 官方说明
   Environment 级变量「only available on the runner after the job starts executing」，
   **不会进入 `vars` / `env` 上下文**；本工作流的 `if` 与 step `env` 读的是 `vars`，
   且未声明 `environment:`，因此 Environment 里的同名配置完全读不到；
2. **Name** 精确为 `EDGEONE_SITE_URL`，**Value** = `https://hyclonline.mcapp.eu.org`（结尾不带 `/`）；
3. 配好后重跑，`Verify EdgeOne configuration` 应打印 `EdgeOne config OK: ...`。

### 本地构建 dist（排障用）

```bash
EDGEONE_SITE_URL=https://hyclonline.mcapp.eu.org node scripts/build-dist.cjs
ls -R dist
```

`dist/` 被 `.gitignore` 忽略，只作为本地/构建环境产物，不进 git。触发线上部署：push 到
`main`，或在控制台 **Build & Deploy → New Deployment** 重新构建最新提交。

链路：Sync Terracotta 更新 `online.json` → push → EdgeOne Git 集成构建 `dist/` 并发布 →
启动器从自定义域名读取清单与二进制。

## 自动同步（GitHub Actions）

`.github/workflows/sync-terracotta.yml`：

1. 每日 03:00 UTC / 手动触发，向上游 `burningtnt/Terracotta` 的 latest release 探测版本；
2. 有新版本 → 下载 6 平台 `-pkg.tar.gz`、计算 SHA-256；
3. `gh release create terracotta-v<版本>` 上传二进制（**二进制只进 Release，不进 git**）；
4. 重写 `online.json`（版本、本仓库 Release 直链 + 官方镜像、哈希、updatedAt）并提交
   `chore(terracotta): sync v<版本>`。

本地操作（需要 Node 18+，仓库脚本零依赖）：

```bash
node scripts/update-manifest.cjs probe                     # 探测上游是否更新
node scripts/update-manifest.cjs fetch --version 0.4.2     # 下载并生成报告
node scripts/update-manifest.cjs apply --version 0.4.2 --report _sync/report.json --repo OWNER/Hycl-online
node scripts/update-manifest.cjs plugin --zip Hycl.Online-1.0.0.zip --repo OWNER/Hycl-online
```

## 插件包发布（全自动）

> **v1.1.0 发版注意**：本轮改动同时涉及 Hycl（插件工坊、工具页入口、可选功能页接口）与插件本体。
> 必须先 push Hycl 源码，再在 Hycl-online 手动运行 **Build Plugin** workflow（或等待 Sync Terracotta
> 串联触发），让 CI 用最新源码 `dotnet publish` 并创建 `plugin-v1.1.0` Release。CI 的
> `update-manifest.cjs plugin` 会用**CI 生成的 zip** 重刷 `online.json` 的 `sha256` / `size`，
> 覆盖本地打包的哈希；不要直接用本地 zip 的哈希冒充线上产物。之后 Deploy EdgeOne 自动跟进。

`.github/workflows/build-plugin.yml`：

1. 触发：手动（可指定 Hycl 源仓库/ref/版本）**或** Sync Terracotta 完成后自动串联；
2. 从 Hycl 仓库拉插件源码 → `dotnet publish` → 打包 `Hycl.Online-<版本>.zip`
   （`plugin.json` + `Hycl.Online.dll`，版本号单一事实源为插件 csproj 的 `<Version>`）；
3. `plugin-v<版本>` Release 已存在则跳过（串联安全）；不存在则创建 Release 并上传；
4. `update-manifest.cjs plugin` 刷新 `online.json` 并提交，随后 Deploy EdgeOne 自动跟进；
5. verify 作业校验：清单覆盖 **win/linux/mac × x64/arm64 六平台**、双 SHA-256 齐全、
   每个平台主源 URL 可达（HEAD 200/302）。

手动触发只用于插件代码更新后提前发版；日常完全自动。

### 手动兜底（可选）

```bash
dotnet publish src/Hycl.Launcher.Plugin.Online -c Release
# 打包 Hycl.Online-<版本>.zip（plugin.json + Hycl.Online.dll）
gh release create plugin-v<版本> Hycl.Online-<版本>.zip
node scripts/update-manifest.cjs plugin --zip Hycl.Online-<版本>.zip --repo muqiu-pika/Hycl-online
```

## 许可

- 本仓库的清单与脚本为 Hycl 项目的一部分（Apache-2.0）。
- Terracotta 二进制来自 [burningtnt/Terracotta](https://github.com/burningtnt/Terracotta)，
  采用 **AGPL-3.0** 授权；本仓库按其许可原样分发，未做任何修改。
  源码与许可全文见上游仓库与 `terracotta-v*` Release 说明。
