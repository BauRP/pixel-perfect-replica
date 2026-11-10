import { existsSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { flattenAndroidCascadeLayers } from "./legacy-css.mjs";
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

// Tailwind v4 generates CSS cascade layers, unsupported by old Android 12
// WebViews (Chrome 91). Vite's syntax targets alone cannot remove @layer.
// Flatten only the offline Android output; original design tokens stay intact.
const cssFiles = [];
const scan = (folder) => {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (entry.isFile() && entry.name.endsWith(".css")) cssFiles.push(file);
  }
};
scan(dir);
if (!cssFiles.length) throw new Error("Android stylesheets missing after Vite build");
let removedLayers = 0;
let flatCss = "";
for (const cssPath of cssFiles) {
  const result = flattenAndroidCascadeLayers(readFileSync(cssPath, "utf8"));
  writeFileSync(cssPath, result.css, "utf8");
  removedLayers += result.removedLayers;
  flatCss += result.css;
}
// Fail closed if a future bundler changes its output and strips core styles.
for (const required of [".sw-shell", ".sw-bottom-nav", ".sw-player-cover", ".flex", ".grid"]) {
  if (!flatCss.includes(required)) {
    throw new Error("Android CSS missing required UI selector: " + required);
  }
}
if (flatCss.includes("@layer ")) throw new Error("Legacy WebView-incompatible CSS remained in Android bundle");
console.log("Android Chrome 91 CSS prepared:", cssFiles.length, "stylesheets;", removedLayers, "cascade layers flattened");

console.log("Offline Android web bundle prepared:", output);
