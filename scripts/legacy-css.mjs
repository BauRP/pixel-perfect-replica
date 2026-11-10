import postcss from "postcss";

/**
 * Flatten Tailwind v4 cascade layer wrappers for Android WebView < Chrome 99.
 * Android CSS is a separate bundle; desktop website styles stay unchanged.
 * Tailwind generates layer blocks in theme/base/components/utilities order.
 */
export function flattenAndroidCascadeLayers(css) {
  const root = postcss.parse(css, { from: "soundworld-android.css" });
  let removedLayers = 0;
  root.walkAtRules("layer", (rule) => {
    removedLayers++;
    if (rule.nodes) rule.replaceWith(...rule.nodes);
    else rule.remove();
  });
  let remaining = false;
  root.walkAtRules("layer", () => { remaining = true; });
  if (remaining) throw new Error("Android CSS still contains unsupported @layer rules");
  return { css: root.toResult({ map: false }).css, removedLayers };
}
