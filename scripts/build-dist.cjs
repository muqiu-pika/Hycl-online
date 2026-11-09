#!/usr/bin/env node
// EdgeOne Pages Git-integration build entry point (pure Node, zero dependencies, ASCII only).
//
// The Git-connected project publishes a build output directory instead of pushing
// artifacts through the CLI (the project has Provider 'Github', so direct folder/zip
// deployment is not supported). This script assembles dist/:
//   tools/terracotta/<version>/*.tar.gz + plugins/*.zip + online.json (EdgeOne-first).
//
// Build command:   node scripts/build-dist.cjs
// Output directory: dist
// Environment:     EDGEONE_SITE_URL (falls back to the bound custom domain below)
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DEFAULT_SITE = "https://hyclonline.mcapp.eu.org";
// GitHub release/raw links may be slow or blocked on some build nodes; try the
// launcher's mirror pool as extra fallbacks (SHA-256 still gates every download).
const GITHUB_MIRRORS = [
  "https://gh-proxy.com/",
  "https://ghfast.top/",
  "https://ghproxy.link/",
  "https://ghproxy.net/",
  "https://mirror.ghproxy.com/"
];

function log(message) {
  console.log("[build-dist] " + message);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function fetchFile(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "hycl-online-build" },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error("HTTP " + response.status);
  }
  return Buffer.from(await response.arrayBuffer());
}

function expandMirrors(urls) {
  const result = [];
  for (const url of urls) {
    if (!url) {
      continue;
    }
    result.push(url);
    if (/^https:\/\/github\.com\//i.test(url)) {
      for (const prefix of GITHUB_MIRRORS) {
        result.push(prefix + url);
      }
    }
  }
  return result;
}

// Try every source in order; verify SHA-256 so a corrupted mirror cannot poison dist.
async function download(urls, expectedSha256) {
  const errors = [];
  for (const url of urls) {
    if (!url) {
      continue;
    }
    try {
      const data = await fetchFile(url);
      if (expectedSha256 && sha256(data).toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error("SHA-256 mismatch");
      }
      return data;
    } catch (error) {
      errors.push(url + " -> " + error.message);
    }
  }
  throw new Error("all sources failed:\n  " + errors.join("\n  "));
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "online.json"), "utf8"));
  const tool = manifest.tools && manifest.tools.terracotta;
  if (!tool || !tool.version) {
    throw new Error("manifest has no tools.terracotta.version");
  }

  const site = String(process.env.EDGEONE_SITE_URL || DEFAULT_SITE).trim().replace(/\/+$/, "");
  const toolDir = path.join(DIST, "tools", "terracotta", String(tool.version));
  const pluginDir = path.join(DIST, "plugins");
  fs.mkdirSync(toolDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });

  // Community EasyTier nodes: only the AES-256-GCM ciphertext is committed and
  // served by EdgeOne at <site>/public-nodes.enc. The plugin decrypts it locally;
  // the plaintext JSON never enters the repository or dist.
  const publicNodes = path.join(ROOT, "public-nodes.enc");
  if (fs.existsSync(publicNodes)) {
    fs.copyFileSync(publicNodes, path.join(DIST, "public-nodes.enc"));
    log("staged public-nodes.enc");
  } else {
    log("WARN public-nodes.enc missing; community node list will not be served");
  }

  for (const [key, asset] of Object.entries(tool.assets || {})) {
    const name = String(asset.fileName || "");
    if (!name) {
      throw new Error(key + ": no fileName");
    }
    log("downloading " + name);
    const data = await download(expandMirrors(asset.urls || []), asset.sha256);
    fs.writeFileSync(path.join(toolDir, name), data);
  }

  for (const entry of manifest.plugins || []) {
    if (!entry.url) {
      continue;
    }
    const name = path.basename(new URL(entry.url).pathname);
    try {
      const data = await download(expandMirrors([entry.url, ...(entry.mirrors || [])]), entry.sha256);
      fs.writeFileSync(path.join(pluginDir, name), data);
      log("downloaded " + name);
    } catch (error) {
      // A missing plugin zip must not break the tool packages; stage keeps GitHub as fallback.
      log("WARN plugin not available, skipping rewrite: " + error.message);
    }
  }

  execFileSync(
    process.execPath,
    [path.join(__dirname, "update-manifest.cjs"), "stage", "--dist", DIST],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, EDGEONE_SITE_URL: site }
    }
  );
  log("done (site: " + site + ")");
}

main().catch(error => {
  console.error("[build-dist] ERROR: " + (error && error.message ? error.message : error));
  process.exit(1);
});
