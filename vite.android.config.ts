import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

/** Standalone offline SPA for Android; the website retains its existing TanStack Start build. */
export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  base: "/",
  define: { "import.meta.env.VITE_ANDROID_BUILD": JSON.stringify(true) },
  build: {
    // Android WebView can lag behind desktop Chrome, particularly inside
    // emulator system images. Vite 8's default modern output caused a real
    // "Uncaught SyntaxError: Unexpected token '{'" in the bundled app.
    // Keep the Android SPA's JavaScript syntax at ES2018, independent of
    // the separate website production build.
    target: "es2018",
    outDir: "dist-android",
    emptyOutDir: true,
    rollupOptions: { input: "native/index.html" },
  },
});
