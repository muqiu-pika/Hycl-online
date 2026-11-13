# Hycl-online

Hyplay Craft Launcher（Hycl）的联机插件分发仓库：插件清单 + 插件包托管 + 社区节点清单。

## 这个仓库放什么

| 内容 | 位置 | 谁来更新 |
| --- | --- | --- |
| 插件清单 `online.json` | 仓库根目录 | `build-plugin.yml` 自动 / 本地脚本手动 |
| 社区节点清单（密文）`public-nodes.enc` | 仓库根目录 + EdgeOne `dist/` | 本地 `scripts/sync-public-nodes.cjs` |
| Hycl 联机插件包 `Hycl.Online-v*.zip` | Releases（`plugin-v*` 标签） | `build-plugin.yml`（手动触发） |

陶瓦联机工具（Terracotta）本体**不再由本仓库镜像或同步**：插件只从官方镜像
（gitee / cnb）与官方 GitHub 仓库下载，并做包与可执行文件的双 SHA-256 校验。
这样本仓库不再需要探测上游版本，也不承担二进制托管。

### 社区节点清单

节点清单以 **AES-256-GCM 密文**保存，仓库与 EdgeOne 上都只有 `public-nodes.enc`，
明文 JSON 只在内存中转瞬出现、从不落盘。EdgeOne 上的地址：

```
https://hyclonline.mcapp.eu.org/public-nodes.enc
```

`online.json` 顶层 `publicNodesUrl` 指向该地址；插件建房/加入前拉取密文、本地解密，
再把全部节点通过 `public_nodes` 参数附加给陶瓦（与内置节点合并）。
这一步是必要的：陶瓦 v0.4.2 内置的 4 个节点里 `tcp://public.easytier.top:11010` 与
`tcp://public2.easytier.cn:54321` 已 DNS 失效，仅靠内置节点常出现「等待房间号超时」。

**密钥不进入仓库**。加密种子通过环境变量传入，Hycl 插件侧用同一套派生逻辑
（`SHA-256(seed + "|hycl.online|nodes")`）得到 AES-256 密钥：

```bash
HYCL_NODES_SEED=<seed> node scripts/sync-public-nodes.cjs --from /path/to/win-dhcp.toml
```

重新提取时**只导出 peer URI、分组与行尾注释**；`network_identity` / `network_secret`
等凭据不会写入任何产物。失效节点按需求原样保留，不做过滤——Terracotta 自己会跳过不可达 peer。

> **安全边界（务必理解）**：客户端必须能解密，密钥就必然存在于客户端二进制中，
> 而 Hycl 是公开仓库。因此这层加密的目标是「不出现明文、防爬虫与随手复制、防 GitHub 搜索」，
> 不是密码学意义上的保密。任何运行客户端的人逆向后都能取出节点列表。
>
> 轮换方式：换一个 `HYCL_NODES_SEED` 重新生成 `public-nodes.enc`，同时更新 Hycl 插件里的
> `PublicNodesProvider.KeyParts` 分片常量并重新发版；旧客户端会因为 GCM 校验失败而回退到内置节点。

Hycl 启动器在「设置 → 插件工坊」读取本仓库的 `online.json`（支持在插件工坊自定义清单源地址），
据此完成插件的发现、下载（SHA-256 锁定）、安装、更新、卸载与启用/禁用。启用的插件会出现在
「工具」页，点「进入」打开该插件自己的功能设置页。

## 插件在启动器中的呈现

| 位置 | 作用 |
| --- | --- |
| 设置 → 插件工坊 | 清单源地址、插件列表（下载 / 更新 / 卸载 / 启用 / 禁用）、安装进度、重启提示 |
| 工具页 | 只列出**已启用**插件的入口卡（名称、版本、描述 + 「进入」） |
| 工具页 → 进入 | 插件自己的功能设置页。陶瓦联机包含建房 / 加入 / 连接日志，以及「插件设置」折叠区（插件版本、工具版本、平台、工具目录、重新校验、修复安装） |

- 启用状态写在启动器数据目录的 `plugins-state.json`，格式 `{"disabled":["<plugin id>"]}`：
  **未记录即视为启用**（新装插件默认可用），禁用只隐藏工具页入口，卸载才会停止插件进程并删除目录。
- 插件 ABI 仍为 **1**。v1.1.0 起插件实现可选的 `IHyclPluginFeaturePage` 声明功能页；
  旧包（v1.0.0）未实现时宿主回退到 ABI v1 的 `CreateToolCard()`。
- 功能页控件**延迟创建**：启动加载插件时只登记工厂，用户首次点「进入」才构造控件。

## 全平台支持

| 层 | 平台处理 |
| --- | --- |
| 启动器本体 | Hycl 仓库 `.github/workflows/build.yml` 的 6 RID 矩阵（win / linux / mac × x64 / arm64） |
| 插件包 | `Hycl.Online.dll` 是 anycpu 托管程序集（Avalonia 12.1.4 + ABI v1 契约），**同一个 zip 供全部平台安装** |
| Terracotta 工具 | 插件内置 6 平台官方资产（文件名 + 双 SHA-256），按 `HyclOnlineTools.ToolAssetKey` 选择；Unix 上自动 `chmod +x` |
| 游戏启动 | Hycl 侧 `PlatformInfo` / `JavaDetector` 按平台选 Java、游戏目录与 classpath 分隔符 |

## 清单 schema（v1）

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "…",
  "publicNodesUrl": "https://hyclonline.mcapp.eu.org/public-nodes.enc",
  "plugins": [          // Hycl 插件包（zip：plugin.json + 插件 dll）
    { "id": "hycl.online", "name": "陶瓦联机", "version": "1.3.1",
      "abi": 1, "minLauncherVersion": "1.0.0",
      "url": "…zip 直链", "sha256": "…", "size": 12345,
      "mirrors": [], "description": "…" }
  ]
}
```

- `sha256` / `size`：插件包整体哈希与字节数（安装前校验）。
- `url`：主下载地址。EdgeOne 构建后的 `dist/online.json` 为自定义域名直链；
  仓库内的 `online.json` 保持 GitHub Release 直链。
- `mirrors`：备用地址。EdgeOne 为主源时填 GitHub Release 直链；
  启动器会把 GitHub 链接按加速池自动展开（5 个加速镜像 + 原站托底）。

## 下载链路

插件包（`url` → `mirrors`，逐级回退）：

1. **EdgeOne 托管源**（自定义域名 `hyclonline.mcapp.eu.org`）
2. **GitHub 加速镜像池**（内置 5 个，按实测延迟自动排序，失败沉底）：
   `gh-proxy.com` → `ghfast.top` → `ghproxy.link` → `ghproxy.net` → `mirror.ghproxy.com`
3. **GitHub 原站**（托底）

镜像池在启动器内每 10 分钟后台探测一次（HEAD + 2.5s 超时），按响应时间重排。
清单本身同样按「EdgeOne → GitHub 加速池 → GitHub 原站」回退。

陶瓦工具本体与插件包无关，固定从官方源下载：**gitee → cnb.cool → GitHub 官方仓库**
（GitHub 链接同样经加速池展开、原站托底）。

## EdgeOne Pages 托管（自定义域名主源）

把清单、插件包与节点清单托管到 EdgeOne Pages，作为启动器下载的主源；GitHub Release
与启动器镜像池保留为兜底。当前站点为 **`https://hyclonline.mcapp.eu.org`**。

> **必做：绑定自定义域名。** Pages 默认的项目域名 / 部署域名不是稳定公开入口——加速区域
> 含中国大陆时须使用系统生成的预览链接（有效期 3 小时，超时返回 401）；加速区域为
> 「全球可用区（不含中国大陆）」时，中国大陆网络直接返回 401。因此仓库 Variable
> `EDGEONE_SITE_URL` 与启动器 `HyclOnlineSites.EdgeOneSiteUrl` 都必须填这个自定义域名。

### 部署方式：EdgeOne 控制台 Git 集成（当前使用）

项目 `hycl-online`（ID `makers-fpskvpkc0rcg`）是 **Provider `Github`** 的 Git 导入型项目，
每次 push 到 `main` 会自动构建并发布。控制台 → 项目 → **Project Settings → Build Deployment
Configuration → Edit**：

| 字段 | 值 |
| --- | --- |
| Preset framework | `Other` |
| Root directory | `./` |
| Build output directory | `dist` |
| Compile commands | `node scripts/build-dist.cjs` |
| Install command | 留空（脚本零依赖） |

> 配置改动在**下一次部署**生效。`scripts/build-dist.cjs` 复制 `public-nodes.enc`，
> 按 `online.json` 的插件 `url` / `mirrors` 多源回退下载插件 zip，最后调用
> `update-manifest.cjs stage` 把 `dist/online.json` 改写为 EdgeOne 地址优先并校验哈希。
> 站点地址取环境变量 `EDGEONE_SITE_URL`，未配置时回退到内置默认值。

### GitHub Actions：只校验，不部署

`.github/workflows/deploy-edgeone.yml` 在 `online.json` / 节点清单 / 构建脚本变更或手动触发时
跑同一个 `build-dist.cjs`，产出并校验 `dist/`，提供独立于 EdgeOne 的健康检查，
**不执行** `npx edgeone pages deploy`。仓库 **Variable** `EDGEONE_SITE_URL` 仍是必需项。

### 排障：手动 Run workflow 显示 Skipped

`deploy` 作业的 `if` 要求 `vars.EDGEONE_SITE_URL != ''`。自动触发（push）在未配置时整作业跳过；
手动触发会进入作业，由 `Verify EdgeOne configuration` 报出缺失的 Variable。看到 Skipped 时检查：

1. **层级**：Settings → Secrets and variables → Actions → **Repository variables → New
   repository variable**（不是 Environment variables，也不是 Secrets 标签页）；
2. **Name** 精确为 `EDGEONE_SITE_URL`，**Value** = `https://hyclonline.mcapp.eu.org`（结尾不带 `/`）；
3. 配好后重跑，`Verify EdgeOne configuration` 应打印 `EdgeOne config OK: ...`。

### 本地构建 dist（排障用）

```bash
EDGEONE_SITE_URL=https://hyclonline.mcapp.eu.org node scripts/build-dist.cjs
ls -R dist
```

`dist/` 被 `.gitignore` 忽略，只作为本地/构建环境产物，不进 git。

## 插件包发布

`.github/workflows/build-plugin.yml`（手动 `workflow_dispatch`）：

1. 从 Hycl 仓库拉插件源码 → `dotnet publish` → 打包 `Hycl.Online-<版本>.zip`
   （`plugin.json` + `Hycl.Online.dll`，版本号单一事实源为插件 csproj 的 `<Version>`）；
2. `plugin-v<版本>` Release 已存在则跳过；不存在则创建 Release 并上传；
3. `update-manifest.cjs plugin` 刷新 `online.json` 并提交，随后 Deploy EdgeOne 自动跟进；
4. verify 作业校验插件条目（版本 / 双字段哈希与大小 / URL）与源可达性。

日常发版流程：改插件 `<Version>` 并 push Hycl → 在 Hycl-online 手动运行 **Build Plugin**。

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
  采用 **AGPL-3.0** 授权；本仓库不再分发该二进制，插件直接从上游官方渠道下载。
