import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 28571,
    proxy: {
      "/api": "http://127.0.0.1:28570",
    },
  },
});
