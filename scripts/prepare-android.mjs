import { existsSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";

const dir = "dist-android";
const input = join(dir, "native", "index.html");
const output = join(dir, "index.html");
if (!existsSync(input)) throw new Error("Android HTML output missing; Vite build failed");
const html = readFileSync(input, "utf8");
if (!/id="root"/.test(html)) throw new Error("Android shell root is missing");
if (/https?:\/\//i.test(html)) throw new Error("Android HTML must not load remote resources");
if (!/<script\b/.test(html)) throw new Error("Android JavaScript bundle is missing");
renameSync(input, output);
rmdirSync(join(dir, "native"));
console.log("Offline Android web bundle prepared:", output);
