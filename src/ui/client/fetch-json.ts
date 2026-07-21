import type { TokenVault } from "./token-vault.js";

function assertApiPath(path: string): void {
  if (!path.startsWith("/api/v1/")) {
    throw new Error("fetch path must begin with /api/v1/");
  }
  if (path.startsWith("//") || path.includes("://")) {
    throw new Error("fetch path must be relative");
  }
}

const JSON_HEADERS = {
  Accept: "application/json",
} as const;

const FETCH_OPTIONS = {
  credentials: "omit",
  cache: "no-store",
  redirect: "error",
} as const satisfies Omit<RequestInit, "headers" | "method" | "body">;

export function createReadFetcher(vault: TokenVault) {
  return async function fetchJson(path: string): Promise<Response> {
    assertApiPath(path);
    const authorization = vault.withViewerToken((token) => `Bearer ${token}`);
    if (!authorization) throw new Error("viewer token unavailable");
    return fetch(path, {
      ...FETCH_OPTIONS,
      method: "GET",
      headers: {
        ...JSON_HEADERS,
        Authorization: authorization,
      },
    });
  };
}

export function createApprovalFetcher(vault: TokenVault) {
  return async function postApproval(path: string, body: Record<string, unknown>): Promise<Response> {
    assertApiPath(path);
    const viewerAuthorization = vault.withViewerToken((token) => `Bearer ${token}`);
    if (!viewerAuthorization) throw new Error("viewer token unavailable");
    const approvalToken = vault.withApprovalToken((token) => token);
    if (!approvalToken) throw new Error("approval token unavailable");
    return fetch(path, {
      ...FETCH_OPTIONS,
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        Authorization: viewerAuthorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, approvalToken }),
    });
  };
}
