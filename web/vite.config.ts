import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const GO_SERVER = process.env.CENTRAL_SERVER ?? "http://127.0.0.1:8821";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../go/web/dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/dictdata", "/bookfile", "/favicon.ico"].map((path) => [
        path,
        { target: GO_SERVER, changeOrigin: false },
      ]),
    ),
  },
});
