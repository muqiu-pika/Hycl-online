#!/usr/bin/env node
// Hycl-online manifest maintenance tool (pure Node, zero dependencies, ASCII only).
//
// Subcommands:
//   probe                                  Compare upstream Terracotta latest release with online.json.
//                                          Prints "UP-TO-DATE" or "UPDATE <version>"; exit 2 when update available.
//   fetch --version V --out DIR            Download the 6 platform packages of upstream release V into DIR
//                                          and write DIR/report.json with per-file sha256/size.
//   apply --version V --report JSON [--repo OWNER/NAME]
//                                          Rewrite tools.terracotta in online.json: new version, this
//                                          repository's release URLs (first) plus the official mirrors.
//   plugin --zip PATH [--version V] [--repo OWNER/NAME] [--id ID]
//                                          Update one plugins[] entry (url/sha256/size) from a local plugin zip.
//   stage --dist DIR [--site-url URL]     Assemble the EdgeOne Pages dist: rewrite dist/online.json so that
//                                          tool/package URLs point at the EdgeOne site first (GitHub via the
//                                          launcher's mirror pool as fallback). Requires --site-url or env
//                                          EDGEONE_SITE_URL, and dist files downloaded by the workflow (gh release download).
//
// Environment: GITHUB_REPOSITORY is the fallback for --repo (set in GitHub Actions);
//              EDGEONE_SITE_URL is the fallback for --site-url.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MANIFEST = path.resolve(__dirname, "..", "online.json");
const UPSTREAM_API = "https://api.github.com/repos/burningtnt/Terracotta/releases/latest";
const OFFICIAL_BASES = [
  "https://github.com/burningtnt/Terracotta/releases/download/v{version}/{file}",
  "https://gitee.com/burningtnt/Terracotta/releases/download/v{version}/{file}",
  "https://cnb.cool/HMCL-Terracotta/Terracotta/-/releases/download/v{version}/{file}",
  "https://mirror.ghproxy.com/https://github.com/burningtnt/Terracotta/releases/download/v{version}/{file}"
];
// manifest asset key -> upstream package slug
const PLATFORMS = {
  "win-x64": "windows-x86_64",
  "win-arm64": "windows-arm64",
  "linux-x64": "linux-x86_64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "macos-x86_64",
  "darwin-arm64": "macos-arm64"
};
const PLUGIN_ID_DEFAULT = "hycl.online";

function fail(message) {
  console.error("ERROR: " + message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = value;
        i++;
      }
    } else {
      args._.push(item);
    }
  }
  return args;
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

function saveManifest(data) {
  data.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  fs.writeFileSync(MANIFEST, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function sha256Of(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function httpJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Hycl-online-manifest-tool", Accept: "application/vnd.github+json" }
  });
  if (!response.ok) {
    fail("HTTP " + response.status + " for " + url);
  }
  return await response.json();
}

function resolveRepo(explicit) {
  const repo = explicit || process.env.GITHUB_REPOSITORY || "";
  if (!repo || !repo.includes("/")) {
    fail("repository is unknown: pass --repo OWNER/NAME or set GITHUB_REPOSITORY");
  }
  return repo;
}

function resolveSiteUrl(explicit) {
  return String(explicit || process.env.EDGEONE_SITE_URL || "").trim().replace(/\/+$/, "");
}

async function cmdProbe() {
  const current = loadManifest().tools?.terracotta?.version ?? "";
  const release = await httpJson(UPSTREAM_API);
  const tag = String(release.tag_name ?? "").replace(/^v/, "");
  if (!tag) {
    fail("upstream latest release has no tag_name");
  }
  if (tag === current) {
    console.log("UP-TO-DATE " + current);
    return 0;
  }
  console.log("UPDATE " + tag);
  return 2;
}

async function cmdFetch(args) {
  const version = String(args.version).replace(/^v/, "");
  const outDir = path.resolve(args.out ?? "_sync");
  fs.mkdirSync(outDir, { recursive: true });
  const release = await httpJson(UPSTREAM_API);
  const tag = String(release.tag_name ?? "").replace(/^v/, "");
  if (tag !== version) {
    fail("upstream latest tag is " + (tag || "?") + ", expected " + version);
  }
  const assets = new Map((release.assets ?? []).map(asset => [String(asset.name ?? ""), asset]));
  const report = { version, files: [] };
  for (const [key, slug] of Object.entries(PLATFORMS)) {
    const name = `terracotta-${version}-${slug}-pkg.tar.gz`;
    const asset = assets.get(name);
    if (!asset || !asset.browser_download_url) {
      fail("upstream release is missing asset " + name);
    }
    console.log("downloading " + name);
    const response = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "Hycl-online-manifest-tool" }
    });
    if (!response.ok) {
      fail("HTTP " + response.status + " for " + asset.browser_download_url);
    }
    const data = Buffer.from(await response.arrayBuffer());
    const target = path.join(outDir, name);
    fs.writeFileSync(target, data);
    report.files.push({
      key,
      name,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
      size: data.length
    });
  }
  const reportPath = path.join(outDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("report written: " + reportPath);
  return 0;
}

function cmdApply(args) {
  const repo = resolveRepo(args.repo);
  const version = String(args.version).replace(/^v/, "");
  const report = JSON.parse(fs.readFileSync(args.report, "utf8"));
  if (String(report.version ?? "") !== version) {
    fail("report version mismatch: " + String(report.version));
  }
  const manifest = loadManifest();
  const tool = (manifest.tools ??= {}).terracotta ??= {};
  const assets = (tool.assets ??= {});
  const releaseBase = `https://github.com/${repo}/releases/download/terracotta-v${version}/`;
  const officialBases = OFFICIAL_BASES.map(base => base.replace("{version}", version));
  for (const entry of report.files ?? []) {
    const key = String(entry.key ?? "");
    const slug = PLATFORMS[key];
    if (!slug) {
      continue;
    }
    const name = String(entry.name ?? "");
    const asset = (assets[key] ??= {});
    asset.urls = [releaseBase + name, ...officialBases.map(base => base.replace("{file}", name))];
    asset.fileName = name;
    asset.sha256 = String(entry.sha256 ?? "");
    asset.size = Number(entry.size ?? 0);
    asset.exeName = `terracotta-${version}-${slug}${key.startsWith("win") ? ".exe" : ""}`;
    tool.version = version;
  }
  saveManifest(manifest);
  console.log("manifest updated: terracotta " + version);
  return 0;
}

function cmdPlugin(args) {
  const repo = resolveRepo(args.repo);
  const site = resolveSiteUrl(args["site-url"]);
  const zipPath = path.resolve(args.zip);
  if (!fs.existsSync(zipPath) || !fs.statSync(zipPath).isFile()) {
    fail("plugin zip not found: " + zipPath);
  }
  let version = String(args.version ?? path.basename(zipPath).replace(/\.zip$/i, "")).replace(/^v/, "");
  if (version.startsWith("Hycl.Online-")) {
    version = version.slice("Hycl.Online-".length);
  }
  const manifest = loadManifest();
  const plugins = (manifest.plugins ??= []);
  let entry = plugins.find(item => item.id === (args.id ?? PLUGIN_ID_DEFAULT));
  if (!entry) {
    entry = { id: args.id ?? PLUGIN_ID_DEFAULT };
    plugins.push(entry);
  }
  const zipName = path.basename(zipPath);
  const githubUrl = `https://github.com/${repo}/releases/download/plugin-v${version}/${zipName}`;
  entry.version = version;
  if (site) {
    // EdgeOne 托管为主源，GitHub Release 作为备用（启动器侧还会自动套镜像池，原站托底）
    entry.url = `${site}/plugins/${zipName}`;
    entry.mirrors = [githubUrl];
  } else {
    entry.url = githubUrl;
    entry.mirrors = [];
  }
  entry.sha256 = sha256Of(zipPath);
  entry.size = fs.statSync(zipPath).size;
  saveManifest(manifest);
  console.log(`plugin entry updated: ${entry.id} ${version}`);
  return 0;
}

function cmdStage(args) {
  const site = resolveSiteUrl(args["site-url"]);
  if (!site) {
    fail("EdgeOne site URL is required: pass --site-url https://<project>.edgeone.app or set EDGEONE_SITE_URL");
  }
  const dist = path.resolve(args.dist ?? "dist");
  const sourceManifest = args.manifest
    ? JSON.parse(fs.readFileSync(path.resolve(args.manifest), "utf8"))
    : loadManifest();
  const distManifest = JSON.parse(JSON.stringify(sourceManifest));
  const tool = distManifest.tools?.terracotta;
  if (!tool || !tool.version) {
    fail("manifest has no tools.terracotta entry");
  }
  const toolDir = path.join(dist, "tools", "terracotta", String(tool.version));
  for (const [key, asset] of Object.entries(tool.assets ?? {})) {
    const name = String(asset.fileName ?? "");
    if (!name) {
      fail(`asset ${key} has no fileName`);
    }
    const file = path.join(toolDir, name);
    if (!fs.existsSync(file)) {
      fail(`dist file missing (gh release download first): ${file}`);
    }
    const hash = sha256Of(file);
    if (asset.sha256 && hash !== asset.sha256) {
      fail(`dist file hash mismatch for ${name}: expected ${asset.sha256}, got ${hash}`);
    }
    // EdgeOne 优先，其余（GitHub Release + 官方镜像）保持原序兜底；
    // 其中 GitHub 链接由启动器侧镜像池自动展开（GitHub 原站永远最后）
    asset.urls = [`${site}/tools/terracotta/${tool.version}/${name}`, ...(asset.urls ?? [])];
  }
  for (const entry of distManifest.plugins ?? []) {
    if (!entry.url || !entry.url.startsWith("https://github.com/")) {
      continue;
    }
    const zipName = path.basename(new URL(entry.url).pathname);
    const local = path.join(dist, "plugins", zipName);
    if (!fs.existsSync(local)) {
      console.log("plugin zip not staged (skipping rewrite): " + zipName);
      continue;
    }
    if (assetHashMatches(local, entry.sha256)) {
      entry.mirrors = [entry.url];
      entry.url = `${site}/plugins/${zipName}`;
    } else {
      console.log("plugin zip hash mismatch (skipping rewrite): " + zipName);
    }
  }
  distManifest.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const output = path.join(dist, "online.json");
  fs.writeFileSync(output, JSON.stringify(distManifest, null, 2) + "\n", "utf8");
  console.log(`staged ${output} (EdgeOne: ${site})`);
  return 0;
}

function assetHashMatches(file, expectedSha256) {
  return !expectedSha256 || sha256Of(file) === expectedSha256;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === "probe") {
    return await cmdProbe();
  }
  if (command === "fetch") {
    return await cmdFetch(args);
  }
  if (command === "apply") {
    return cmdApply(args);
  }
  if (command === "plugin") {
    return cmdPlugin(args);
  }
  if (command === "stage") {
    return cmdStage(args);
  }
  fail("unknown command: " + command);
}

main().then(
  code => process.exit(code),
  error => {
    console.error("ERROR: " + (error && error.message ? error.message : error));
    process.exit(1);
  }
);
