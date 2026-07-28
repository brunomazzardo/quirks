import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

// The root config excludes `src/**` and `test/**` so the bun-era tree at the
// repo root stays out of the runner. Relative to this package those same
// patterns would exclude the entire suite, so the exclude list is replaced here
// rather than merged.
export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
    // The shape companion polls the filesystem and streams SSE; give it room on
    // a loaded machine without hiding a genuine hang.
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
