#!/usr/bin/env bun
// Retired by QK-COMP-003. The quirks daemon serves /shape/ — use start-server.sh.
console.error(
  JSON.stringify({
    error:
      "the standalone shape server is retired — use .claude/skills/shape/scripts/start-server.sh (quirks daemon /shape/)",
  }),
);
process.exit(1);
