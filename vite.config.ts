import { defineConfig } from "vite";
import { request as httpRequest } from "node:http";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tanstackRouter from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const apiProxy = {
  name: "ayawin-api-proxy",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/api/")) return next();

      const port = Number(process.env.API_PORT || 4000);
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${port}` },
        },
        (response) => {
          res.writeHead(response.statusCode || 502, response.headers);
          response.pipe(res);
        },
      );

      upstream.on("error", (error) => {
        console.error(`[api proxy] ${error.message}`);
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({ error: "ERP API is unavailable. Start the backend on port 4000." }),
          );
        }
      });
      req.pipe(upstream);
    });
  },
};

export default defineConfig({
  plugins: [
    apiProxy,
    tanstackStart(),
    nitro(),
    tanstackRouter({ target: "react", enableRouteGeneration: false }),
    tailwindcss(),
    react(),
    tsconfigPaths(),
  ],
  server: {
    host: true,
    allowedHosts: true,
    watch: {
      ignored: ["**/node_modules/**", "**/.output/**"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
