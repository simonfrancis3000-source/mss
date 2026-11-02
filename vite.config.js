import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  base: mode === "mobile" ? "./" : "/",
  build: {
    rollupOptions: {
      input:
        mode === "mobile"
          ? resolve(process.cwd(), "index.html")
          : {
              app: resolve(process.cwd(), "index.html"),
              admin: resolve(process.cwd(), "admin/index.html")
            }
    }
  }
}));
