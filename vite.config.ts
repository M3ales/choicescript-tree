import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";

const root = path.dirname(fileURLToPath(import.meta.url));

const bootstrapAlias = {
  find: /^(\.\.?\/)*bootstrap(\.ts)?$/,
  replacement: path.posix.join(
    root.replace(/\\/g, "/"),
    "web/bootstrap-noop.ts",
  ),
};

export default defineConfig({
  root: "web",
  resolve: {
    alias: [bootstrapAlias],
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  worker: {
    format: "es",
  },
  server: {
    proxy: {},
  },
  plugins: [
    {
      name: "cors-proxy",
      configureServer(server) {
        server.middlewares.use("/cors-proxy", async (req: IncomingMessage, res: ServerResponse) => {
          const target = new URL(req.url ?? "", "http://localhost").searchParams.get("url");
          if (!target) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Missing ?url= parameter");
            return;
          }
          try {
            const upstream = await fetch(target);
            res.writeHead(upstream.status, {
              "Content-Type": upstream.headers.get("content-type") ?? "text/plain",
              "Access-Control-Allow-Origin": "*",
            });
            const body = await upstream.arrayBuffer();
            res.end(Buffer.from(body));
          } catch (err) {
            res.writeHead(502, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
            res.end(`Proxy error: ${err}`);
          }
        });
      },
    },
  ],
});
