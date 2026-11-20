import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const validator = resolve("scripts/validate-offline-music-assets.mjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function elf(machine=183) {
  const bytes=Buffer.alloc(64);
  Buffer.from([0x7f,0x45,0x4c,0x46,2,1,1,0]).copy(bytes);
  bytes.writeUInt16LE(3,16);
  bytes.writeUInt16LE(machine,18);
  return bytes;
}
function fixture() {
  const folder=mkdtempSync(join(tmpdir(),"sw-model-contract-"));
  const root=join(folder,"offline-music");
  mkdirSync(root,{recursive:true});
  const artifacts=[
    ["weights/model.mnn","model",Buffer.from("fixture model")],
    ["tokens/tokenizer.json","tokenizer",Buffer.from("{}")],
    ["libmnn.so","mnn-arm64",elf()],
    ["libsynth.so","synth-arm64",elf()],
    ["instruments/bank.bin","soundbank",Buffer.from("fixture soundbank")],
    ["licenses/LICENSE","notice",Buffer.from("Apache License\nVersion 2.0, January 2004\n")],
  ];
  const files=artifacts.map(([path,role,bytes])=>{
    const destination=join(root,path);
    mkdirSync(dirname(destination),{recursive:true});
    writeFileSync(destination,bytes);
    return {path,role,license:"Apache-2.0",owner:"Fixture",
      sourceUrl:"https://example.org/fixture-only",
      sha256:hash(bytes),sizeBytes:bytes.length,
      ...(role==="notice"?{}:{noticePath:"licenses/LICENSE"})};
  });
  const manifest={schemaVersion:1,model:"haster/Fermata-0.2B-v1",runtime:"Alibaba/MNN",
    reviewedBy:"Automated contract fixture",reviewedAt:"2026-11-20",files};
  writeFileSync(join(root,"manifest.json"),JSON.stringify(manifest));
  return {folder,root,manifest};
}
const execute=folder=>spawnSync(process.execPath,[validator],{cwd:folder,encoding:"utf8"});
const save=f=>writeFileSync(join(f.root,"manifest.json"),JSON.stringify(f.manifest));
test("accepts complete synthetic metadata as a contract fixture only",()=>{
  const f=fixture();
  try{const p=execute(f.folder);assert.equal(p.status,0,p.stderr);}finally{rmSync(f.folder,{recursive:true,force:true});}
});
test("rejects a renamed x86_64 shared library",()=>{
  const f=fixture();
  try{
    const bytes=elf(62);
    writeFileSync(join(f.root,"libmnn.so"),bytes);
    const entry=f.manifest.files.find(x=>x.role==="mnn-arm64");
    entry.sha256=hash(bytes);entry.sizeBytes=bytes.length;save(f);
    const p=execute(f.folder);
    assert.notEqual(p.status,0);
    assert.match(p.stderr,/not an arm64-v8a ELF/);
  }finally{rmSync(f.folder,{recursive:true,force:true});}
});
test("rejects incorrect license notice even with valid hashes",()=>{
  const f=fixture();
  try{
    const bytes=Buffer.from("A non-Apache license");
    writeFileSync(join(f.root,"licenses/LICENSE"),bytes);
    const entry=f.manifest.files.find(x=>x.role==="notice");
    entry.sha256=hash(bytes);entry.sizeBytes=bytes.length;save(f);
    const p=execute(f.folder);
    assert.notEqual(p.status,0);
    assert.match(p.stderr,/does not identify Apache-2.0/);
  }finally{rmSync(f.folder,{recursive:true,force:true});}
});
test("rejects external symlinks in place of the bundle root",()=>{
  const f=fixture(),dir=mkdtempSync(join(tmpdir(),"sw-link-contract-"));
  try{
    symlinkSync(f.root,join(dir,"offline-music"),"dir");
    const p=execute(dir);
    assert.notEqual(p.status,0);
    assert.match(p.stderr,/root symlink forbidden/);
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(f.folder,{recursive:true,force:true});}
});
