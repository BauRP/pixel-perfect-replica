#!/usr/bin/env node
/**
 * Fail-closed local music bundle gate: Fermata/MNN and a licensed renderer are
 * never accepted just because files happen to exist. Nothing is downloaded.
 * A missing bundle is allowed because the current APK is shell-only.
 *
 * This verifies declared hashes, file inventory and license evidence
 * completeness. It does NOT independently prove copyright ownership,
 * model compatibility or actual audio generation.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync, copyFileSync, createReadStream, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const root = resolve("offline-music");
const manifestFile = join(root, "manifest.json");
const requiredRoles = new Set(["model", "tokenizer", "mnn-arm64", "synth-arm64", "soundbank", "notice"]);
const binaryRoles = new Set(["mnn-arm64", "synth-arm64"]);
const shaPattern = /^[a-f0-9]{64}$/;
const safePath = value => typeof value === "string" &&
  value.length > 0 && value.length <= 240 &&
  !value.includes("\\") && !value.includes(":") &&
  value.split("/").every(part => part !== "" && part !== "." && part !== "..") &&
  !value.startsWith("/");

function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw Error("Music bundle contains symlink: " + path);
    if (entry.isDirectory()) return walk(path);
    if (!entry.isFile()) throw Error("Unsupported music bundle entry: " + path);
    return [relative(root, path).split(sep).join("/")];
  });
}

function fail(reason) { throw new Error("Offline music package: " + reason); }
const requireComplete = process.argv.includes("--require-complete");
const args = process.argv.slice(2).filter(a=>a!=="--require-complete");
if (args.length!==0 && (args.length!==2 || args[0]!=="--stage" || !args[1]))
  fail("use [--stage ANDROID_APP_MAIN_DIRECTORY] [--require-complete]");
const targetIndex = args.length===2 ? 0 : -1;

if (!existsSync(root)) {
  if (requireComplete) fail("Complete reviewed offline music bundle is required; cannot publish a shell as a music-ready APK");
  if (targetIndex !== -1) console.log("SHELL_ONLY: No optional Fermata bundle to stage");
  else console.log("SHELL_ONLY: Music weights, tokenizer and synthesizer are not installed");
  process.exit(0);
}
if (lstatSync(root).isSymbolicLink()) fail("music bundle root symlink forbidden");
if (!existsSync(manifestFile)) fail("files exist but manifest.json is missing");
if (lstatSync(manifestFile).isSymbolicLink()) fail("manifest symlink forbidden");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
if (manifest.schemaVersion !== 1 ||
    manifest.model !== "haster/Fermata-0.2B-v1" ||
    manifest.runtime !== "Alibaba/MNN" ||
    typeof manifest.reviewedBy !== "string" || !manifest.reviewedBy.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manifest.reviewedAt) ||
    !Array.isArray(manifest.files) || manifest.files.length < 6)
  fail("missing pinned model/runtime, manifest review or complete asset inventory");

const roleSet = new Set(), listed = new Set(), noticePaths = new Set();
let totalBytes = 0;
for (const item of manifest.files) {
  if (!item || !safePath(item.path) || listed.has(item.path)) fail("unsafe or duplicate bundle path");
  listed.add(item.path);
  if (!requiredRoles.has(item.role)) fail("unknown artifact role " + item.role);
  roleSet.add(item.role);
  if (item.role === "notice") noticePaths.add(item.path);
  if (item.license !== "Apache-2.0" ||
      typeof item.owner !== "string" || !item.owner.trim() ||
      typeof item.sourceUrl !== "string" || !item.sourceUrl.startsWith("https://") ||
      !shaPattern.test(item.sha256) ||
      !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1)
    fail("incomplete strict-Apache-2.0 provenance for " + item.path);
  if (binaryRoles.has(item.role)) {
    if (!/^lib[A-Za-z0-9_]+\.so$/.test(item.path)) fail("JNI lib filename must be libNAME.so");
  } else if (item.path.endsWith(".so")) fail("shared libraries must use native-arm64 role");
  if (item.role !== "notice" && !safePath(item.noticePath))
    fail("every binary/data artifact needs a local license evidence file");
  const file = resolve(root, item.path);
  if (!file.startsWith(root + sep) || !existsSync(file) || !lstatSync(file).isFile())
    fail("missing local artifact " + item.path);
  const size = lstatSync(file).size;
  if (size !== item.sizeBytes) fail("wrong file size for " + item.path);
  if (binaryRoles.has(item.role)) {
    // Verify the actual Android ABI. A renamed x86 ELF is not arm64-v8a.
    const header = Buffer.alloc(20);
    const fd = openSync(file, "r");
    let count;
    try { count = readSync(fd, header, 0, header.length, 0); }
    finally { closeSync(fd); }
    if (count !== 20 || header[0] !== 0x7f ||
        header.toString("ascii", 1, 4) !== "ELF" ||
        header[4] !== 2 || header[5] !== 1 ||
        header.readUInt16LE(16) !== 3 || header.readUInt16LE(18) !== 183)
      fail("JNI shared library is not an arm64-v8a ELF: " + item.path);
  }
  if (item.role === "notice") {
    if (size > 500_000) fail("unreasonably large license evidence file");
    const licenseText = readFileSync(file, "utf8");
    if (!/Apache License\s*Version 2\.0/i.test(licenseText) &&
        !/SPDX-License-Identifier:\s*Apache-2\.0/i.test(licenseText))
      fail("license evidence does not identify Apache-2.0: " + item.path);
  }
  totalBytes += size;
  if (totalBytes > 900_000_000) fail("music bundle exceeds 900 MB budget");
  // Fermata weights can be hundreds of MB. Hash incrementally instead of
  // loading each entire model/soundbank into the Node.js heap during CI.
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest("hex") !== item.sha256)
    fail("wrong SHA256 for " + item.path);
}
for (const role of requiredRoles) if (!roleSet.has(role)) fail("missing required role: " + role);
if (requireComplete) {
  const expected = [
    ["model/config.json","model"],["model/llm_config.json","model"],
    ["model/llm.mnn","model"],["model/llm.mnn.weight","model"],
    ["model/tokenizer.txt","model"],
    ["tokenizer/vocab.json","tokenizer"],
    ["libsoundworld_fermata_mnn.so","mnn-arm64"],
    ["libsoundworld_sonivox.so","synth-arm64"],
  ];
  for (const [path,role] of expected)
    if(!manifest.files.some(item=>item.path===path && item.role===role))
      fail("missing runtime-required artifact "+path);
}
for (const item of manifest.files) if (item.role !== "notice" && !noticePaths.has(item.noticePath))
  fail("license evidence is not inventoried for " + item.path);
const inventory = walk(root);
if (inventory.length !== listed.size + 1 ||
    inventory.some(path => path !== "manifest.json" && !listed.has(path)))
  fail("bundle includes unknown/unreviewed files");

if (targetIndex !== -1) {
  const androidMain = resolve(args[1]);
  const assets = join(androidMain, "assets", "offline-music");
  const libs = join(androidMain, "jniLibs", "arm64-v8a");
  mkdirSync(assets, { recursive: true });
  mkdirSync(libs, { recursive: true });
  for (const item of manifest.files) {
    const dest = binaryRoles.has(item.role) ? join(libs, item.path) : join(assets, item.path);
    mkdirSync(resolve(dest, ".."), { recursive: true });
    copyFileSync(join(root, item.path), dest);
  }
  copyFileSync(manifestFile, join(assets, "manifest.json"));
  console.log("STAGED: verified offline music bundle", manifest.files.length, "artifacts");
} else {
  console.log("VERIFIED: pinned offline music bundle", manifest.files.length, "files", totalBytes, "bytes");
}
