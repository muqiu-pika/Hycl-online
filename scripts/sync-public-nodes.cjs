#!/usr/bin/env node
// Encrypt EasyTier peer URIs from a local TOML into public-nodes.enc.
//
// Design notes:
//   - The repository only ever contains the AES-256-GCM ciphertext; the plaintext
//     JSON is never written to disk in the repo (it stays in memory).
//   - The seed is NOT stored in this repo. Pass it via HYCL_NODES_SEED or --seed.
//     Hycl derives the same key from the same seed inside the plugin.
//   - Only peer URIs, inline notes and group headings are exported. Network
//     identity / secret / flags in the TOML are deliberately dropped.
//   - Nodes in groups marked unreachable are kept as-is on purpose (the user
//     wants every entry present; Terracotta skips dead peers itself).
//
// Usage: HYCL_NODES_SEED=... node scripts/sync-public-nodes.cjs --from <win-dhcp.toml>
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "public-nodes.enc");
const KEY_DOMAIN = "|hycl.online|nodes";
const argv = process.argv.slice(2);

function option(name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : "";
}

const source = option("--from");
const seed = String(process.env.HYCL_NODES_SEED || option("--seed") || "").trim();
if (!source) {
  console.error("usage: HYCL_NODES_SEED=<seed> node scripts/sync-public-nodes.cjs --from <win-dhcp.toml>");
  process.exit(1);
}
if (!seed) {
  console.error("HYCL_NODES_SEED (or --seed) is required: the encryption seed must not live in the repo");
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error("source TOML not found: " + source);
  process.exit(1);
}

const lines = fs.readFileSync(source, "utf8").split(/\r?\n/);
const groups = [];
const nodes = [];
let group = "默认";

for (const line of lines) {
  const heading = line.match(/^#\s*=+\s*第.+?组\s*[：:]\s*(.+?)\s*=+\s*$/);
  if (heading) {
    group = heading[1].trim();
    groups.push({ group });
    continue;
  }

  const peer = line.match(/^\s*uri\s*=\s*"([^"]+)"\s*(?:#\s*(.*))?$/);
  if (!peer) {
    continue;
  }

  const uri = peer[1].trim();
  const note = (peer[2] || "").trim();
  if (!/^(tcp|udp|ws|wss|http|https|quic):\/\//i.test(uri)) {
    continue;
  }
  if (nodes.some(item => item.uri === uri)) {
    continue;
  }

  nodes.push({ uri, group, note });
}

if (nodes.length === 0) {
  console.error("no peer URIs found in " + source);
  process.exit(1);
}

const payload = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  source: path.basename(source) + " (peer URIs and notes only; credentials excluded)",
  count: nodes.length,
  groups,
  nodes
};

// Key = SHA-256(seed + domain). Same derivation in Hycl's PublicNodesProvider.
const key = crypto.createHash("sha256").update(seed + KEY_DOMAIN, "utf8").digest();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
const envelope = Buffer.concat([iv, tag, ciphertext]).toString("base64");

// Wrap at 76 columns so the file stays readable in diffs / editors.
const wrapped = envelope.replace(/(.{76})/g, "$1\n").replace(/\n$/, "") + "\n";
fs.writeFileSync(OUTPUT, wrapped, "utf8");

console.log(`[sync-public-nodes] ${nodes.length} nodes encrypted -> ${OUTPUT}`);
console.log(`[sync-public-nodes] groups: ${groups.map(item => item.group).join(" | ")}`);
