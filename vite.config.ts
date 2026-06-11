import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

function swDevPlugin(): Plugin {
  return {
    name: "sw-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/sw.js", async (_req, res) => {
        const result = await server.transformRequest("/src/lib/sw.ts");
        res.setHeader("Content-Type", "application/javascript");
        res.end(result?.code ?? "");
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [solid(), swDevPlugin()],

  define: {
    __APP_NAME__: JSON.stringify(pkg.name),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: ["esnext", "chrome133"],
    rollupOptions: {
      input: {
        main: "./index.html",
        sw: "./src/lib/sw.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
        manualChunks: (id) => {
          if (id.includes("src/lib/sw.ts")) return undefined;
          if (
            id.includes("node_modules/solid-js") ||
            id.includes("node_modules/@solidjs") ||
            id.includes("node_modules/solid-toast")
          ) {
            return "solid";
          }
          if (
            id.includes("node_modules/marked") ||
            id.includes("node_modules/dompurify")
          ) {
            return "markdown";
          }
          if (
            id.includes("node_modules/localforage") ||
            id.includes("node_modules/@solid-primitives/storage")
          ) {
            return "storage";
          }
        },
      },
    },
  },
});
