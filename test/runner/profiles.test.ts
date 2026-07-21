import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRunnerProfiles } from "../../src/runner/profiles.js";

test("loads sanitized runner profiles without credential material", async () => {
  const profiles = await loadRunnerProfiles({
    configDir: path.resolve("test/fixtures/runner-profiles"),
  });
  assert.equal(profiles.length, 3);
  for (const profile of profiles) {
    assert.equal("credential" in profile, false);
    assert.match(profile.profileId, /^[a-z0-9-]+$/);
  }
});

test("rejects profiles whose tier alias weakens declared capability", async () => {
  await assert.rejects(
    () => loadRunnerProfiles({
      configDir: path.resolve("test/fixtures/runner-profiles-invalid"),
    }),
    /TIER_DOWNGRADE/,
  );
});
