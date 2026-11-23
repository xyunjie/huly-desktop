import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const tiptapEntry = require.resolve("@tiptap/core");
const tiptapRequire = createRequire(tiptapEntry);
const pmRequire = createRequire(tiptapRequire.resolve("@tiptap/pm/state"));
const editorAliases = Object.fromEntries(["model", "state", "transform", "view"].map((part) => {
  const name = `prosemirror-${part}`;
  return [name, pmRequire.resolve(name)];
}));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Both require() and import can reach ProseMirror through Huly's editor
      // extensions. Resolve the core packages to one copy in dev and builds.
      "@tiptap/core": tiptapEntry,
      ...editorAliases,
      // api-client's Node socket and storage helpers are pulled in by the
      // package barrel. The desktop app uses the browser WebSocket factory.
      ws: fileURLToPath(new URL("./src/shims/ws.ts", import.meta.url)),
      stream: fileURLToPath(new URL("./src/shims/stream.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ["@tiptap/core", "@hcengineering/text"],
  },
  clearScreen: false,
  server: {
    port: 41773,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    port: 41773,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: "jsdom",
    testTimeout: 15_000,
    setupFiles: ["./src/test/setup.ts"],
    root,
    css: false,
  },
});
