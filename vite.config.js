import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: resolve(process.cwd(), "index.html"),
        admin: resolve(process.cwd(), "admin/index.html")
      }
    }
  }
});
