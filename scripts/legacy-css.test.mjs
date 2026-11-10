import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenAndroidCascadeLayers } from "./legacy-css.mjs";

test("Tailwind theme/base/utilities become flat CSS in the same order", () => {
  const input = "@layer theme,base,utilities;@layer theme{:root{--primary:blue}}@layer base{body{color:var(--primary)}}@layer utilities{.flex{display:flex}.bg-primary{background:var(--primary)}}";
  const { css, removedLayers } = flattenAndroidCascadeLayers(input);
  assert.equal(removedLayers, 4);
  assert.equal(css.includes("@layer"), false);
  assert.match(css, /\.flex\s*\{\s*display:\s*flex/);
  assert.ok(css.indexOf(":root") < css.indexOf("body"));
  assert.ok(css.indexOf("body") < css.indexOf(".flex"));
});

test("nested media rules remain active on older WebViews", () => {
  const { css } = flattenAndroidCascadeLayers("@media(max-width:360px){@layer utilities{.compact{height:44px}}}");
  assert.match(css, /@media/);
  assert.match(css, /\.compact/);
  assert.equal(css.includes("@layer"), false);
});

test("CSS without cascade layers remains unchanged", () => {
  const s = ":root{--primary:#2da6fa}.sw-shell{height:100%}";
  assert.equal(flattenAndroidCascadeLayers(s).css, s);
});
