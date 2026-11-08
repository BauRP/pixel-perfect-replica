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
    outDir: "dist-android",
    emptyOutDir: true,
    rollupOptions: { input: "native/index.html" },
  },
});
