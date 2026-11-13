#!/usr/bin/env node
// Hycl-online manifest maintenance tool (pure Node, zero dependencies, ASCII only).
//
// Subcommands:
//   plugin --zip PATH [--version V] [--repo OWNER/NAME] [--id ID] [--site-url URL]
//                                          Update one plugins[] entry (url/sha256/size) from a local plugin zip.
//                                          Without --site-url the GitHub Release URL is written as the primary
//                                          source; the EdgeOne build rewrites it to the custom domain later.
//   stage --dist DIR [--site-url URL]     Assemble the EdgeOne Pages dist: rewrite dist/online.json so that
//                                          plugin package URLs point at the EdgeOne site first (GitHub Release
//                                          via the launcher's mirror pool as fallback). Requires --site-url or
//                                          env EDGEONE_SITE_URL, and dist files downloaded by build-dist.cjs.
//
// Environment: GITHUB_REPOSITORY is the fallback for --repo (set in GitHub Actions);
//              EDGEONE_SITE_URL is the fallback for --site-url.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MANIFEST = path.resolve(__dirname, "..", "online.json");
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
    fail("EdgeOne site URL is required: pass --site-url https://hyclonline.mcapp.eu.org or set EDGEONE_SITE_URL");
  }
  const dist = path.resolve(args.dist ?? "dist");
  const sourceManifest = args.manifest
    ? JSON.parse(fs.readFileSync(path.resolve(args.manifest), "utf8"))
    : loadManifest();
  const distManifest = JSON.parse(JSON.stringify(sourceManifest));
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
