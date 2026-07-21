export interface TokenVault {
  withViewerToken<T>(callback: (token: string) => T): T | undefined;
  withApprovalToken<T>(callback: (token: string) => T): T | undefined;
  clearApproval(): void;
  clearAll(): void;
}

type ReplaceState = (data: unknown, unused: string, url: string) => void;

export function consumeFragmentTokens(options: { href: string; replaceState: ReplaceState }): TokenVault {
  const url = new URL(options.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  for (const key of params.keys()) {
    if (key !== "viewToken" && key !== "approvalToken") {
      throw new Error(`unknown fragment key: ${key}`);
    }
  }
  const viewTokens = params.getAll("viewToken");
  const approvalTokens = params.getAll("approvalToken");
  if (viewTokens.length !== 1) {
    throw new Error("viewToken must appear exactly once");
  }
  if (approvalTokens.length > 1) {
    throw new Error("approvalToken must appear at most once");
  }

  options.replaceState(null, "", url.pathname + url.search);

  let viewerToken: string | undefined = viewTokens[0];
  let approvalToken: string | undefined = approvalTokens[0] ?? undefined;

  return {
    withViewerToken(callback) {
      if (viewerToken === undefined) return undefined;
      return callback(viewerToken);
    },
    withApprovalToken(callback) {
      if (approvalToken === undefined) return undefined;
      return callback(approvalToken);
    },
    clearApproval() {
      approvalToken = undefined;
    },
    clearAll() {
      viewerToken = undefined;
      approvalToken = undefined;
    },
  };
}
