import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    bot: "src/bot.ts",
    mcp: "src/mcp.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  bundle: true,
  clean: true,
  outDir: "dist",
});
