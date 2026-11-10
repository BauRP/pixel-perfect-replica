import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

/** Standalone offline SPA for Android; the website retains its existing TanStack Start build. */
export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  base: "/",
  define: { "import.meta.env.VITE_ANDROID_BUILD": JSON.stringify(true) },
  // Android 12's bundled WebView may be older than Tailwind CSS v4's
  // Chrome 111 minimum. Lower the compiled CSS for Chrome 91 without
  // changing the website theme, source styles, or design token values.
  css: {
    transformer: "lightningcss",
    lightningcss: { targets: { chrome: 91 << 16 } },
  },
  build: {
    // Android WebView can lag behind desktop Chrome, particularly inside
    // emulator system images. Vite 8's default modern output caused a real
    // "Uncaught SyntaxError: Unexpected token '{'" in the bundled app.
    // Keep the Android SPA's JavaScript syntax at ES2018, independent of
    // the separate website production build.
    target: "es2018",
    cssTarget: "chrome91",
    cssMinify: "lightningcss",
    outDir: "dist-android",
    emptyOutDir: true,
    rollupOptions: { input: "native/index.html" },
  },
});
