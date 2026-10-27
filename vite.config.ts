import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    host: "127.0.0.1"
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true
  }
});
