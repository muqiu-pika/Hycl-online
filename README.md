# Hycl-online

Hyplay Craft Launcher（Hycl）的联机工具仓库：插件分发源 + 陶瓦联机工具托管。

## 这个仓库放什么

| 内容 | 位置 | 谁来更新 |
| --- | --- | --- |
| 插件清单 `online.json` | 仓库根目录 | `sync-terracotta.yml` 自动 / 本地脚本手动 |
| Terracotta 二进制（6 平台 tar.gz） | Releases（`terracotta-v*` 标签） | `sync-terracotta.yml` 每日自动同步 |
| Hycl 联机插件包 `Hycl.Online-v*.zip` | Releases（`plugin-v*` 标签） | 本地打包后手动上传或 `update-manifest.py plugin` |

Hycl 启动器在「工具页 → 插件中心」读取本仓库的 `online.json`（支持在设置页 → 联机与局域网
自定义清单源地址），据此完成插件的发现、下载（SHA-256 锁定）、安装与更新。

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

### 方式 A：GitHub Actions 自动部署（推荐）

1. EdgeOne Pages 控制台创建 API Token，配置仓库 **Secret**：`EDGEONE_API_TOKEN`；
2. 配置仓库 **Variable**：`EDGEONE_SITE_URL` = `https://hyclonline.mcapp.eu.org`
   （结尾不带 `/`；项目名默认 `hycl-online`，由部署命令的 `-n` 决定）；
3. `.github/workflows/deploy-edgeone.yml` 会在清单更新 / Sync Terracotta 完成后自动：
   - `gh release download` 陶瓦 6 包与插件 zip 到 `dist/`（本仓库尚无 `terracotta-v*`
     Release 时——首次部署常见，因 Sync Terracotta 只在探测到上游新版本时才建 Release——
     自动从上游 `burningtnt/Terracotta` 同版本 Release 按清单里的 6 个 `fileName` 精确拉取）；
   - `node scripts/update-manifest.cjs stage --dist dist` 把清单改写为 EdgeOne 优先
     （校验文件 SHA-256，GitHub 链接保留为备用）；
   - `npx edgeone pages deploy ./dist -n hycl-online -t ${{ secrets.EDGEONE_API_TOKEN }}`。

CLI 在未指定 `--site` 时按出口 IP 自动判定 API 站点；GitHub Actions runner 位于海外，会判定
为 `global`（国际站）。若 Token 属于国内站（`china`），需在部署命令上显式加 `--site china`。
`edgeone pages` 目前处于过渡期（官方推荐 `edgeone makers`，两者子命令等价、现有脚本不受影响），
工作流暂沿用 `pages`；CLI 升级大版本后需回归验证。

### 排障：手动 Run workflow 显示 Skipped

`deploy` 作业的 `if` 要求 `vars.EDGEONE_SITE_URL != ''`。自动触发（push / workflow_run）在
未配置时整作业跳过；手动触发会进入作业，由 `Verify EdgeOne configuration` 步骤逐项报出缺失的
Variable / Secret，不再只显示一个 Skipped。看到 Skipped 时按顺序检查：

1. **层级**：Settings → Secrets and variables → Actions → **Repository variables → New
   repository variable**（不是 Environment variables，也不是 Secrets 标签页）。GitHub 官方说明
   Environment 级变量「only available on the runner after the job starts executing」，
   **不会进入 `vars` / `env` 上下文**；本工作流的 `if` 与 step `env` 读的是 `vars` / `secrets`，
   且未声明 `environment:`，因此 Environment 里的同名配置完全读不到。给 job 加
   `environment:` 也不够——step 里 `env: EDGEONE_SITE_URL: ${{ vars.EDGEONE_SITE_URL }}`
   仍会用空的仓库级值覆盖同名 shell 变量，且环境可能带审批规则。两个配置都必须建在
   **Repository 级**（Secret 和 Variable 都是，只挪一个不够）；
2. **Name** 精确为 `EDGEONE_SITE_URL`，**Value** = `https://hyclonline.mcapp.eu.org`（结尾不带 `/`）；
3. **Secret**：同一页面 **Repository secrets → New repository secret** → `EDGEONE_API_TOKEN`
   （EdgeOne Pages 控制台创建）；
4. 两者齐备后重跑，`Verify EdgeOne configuration` 应打印 `EdgeOne config OK: ...`。

### 方式 B：控制台 Git 连接

EdgeOne Pages 控制台直接连接本仓库亦可：构建命令留空、输出目录填 `dist`
（需先在本地/CI 跑过 stage 组装出 `dist/`）——推荐方式 A，全自动。

### 本地手动部署

```bash
EDGEONE_SITE_URL=https://hyclonline.mcapp.eu.org \
  node scripts/update-manifest.cjs stage --dist dist
npx edgeone pages deploy ./dist -n hycl-online -t <你的Token>
```

绑定自定义域名后把该地址回填到仓库 Variable `EDGEONE_SITE_URL` 和启动器常量
`HyclOnlineSites.EdgeOneSiteUrl`，之后的 Sync Terracotta → Deploy EdgeOne → 启动器即全部自动化。

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
