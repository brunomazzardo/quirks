import os from "node:os";
import path from "node:path";

export interface AppPaths {
  root: string;
  repository: string;
  campaigns: string;
  campaign?: string;
}

export function resolveAppPaths(repositoryId: string, campaignId?: string): AppPaths {
  const base = process.env.QUIRKS_STATE_DIR ?? (
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Quirks")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Quirks")
        : path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "quirks")
  );
  const repository = path.join(base, "repositories", repositoryId.replace(":", "-"));
  const campaigns = path.join(repository, "campaigns");
  return { root: base, repository, campaigns, ...(campaignId ? { campaign: path.join(campaigns, campaignId) } : {}) };
}
