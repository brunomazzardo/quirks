import { QuirksError } from "../core/errors.js";
import type { Identity, OperatorEvidenceKind, RepositoryLocatorValidator } from "./types.js";

const HTTPS_URL_PATTERN = /^https:\/\/[^@/?#]+(?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/;

export function assertHttpsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new QuirksError("INVALID_REPOSITORY_PATH", `Invalid URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !HTTPS_URL_PATTERN.test(url)) {
    throw new QuirksError("INVALID_REPOSITORY_PATH", `URL must be https without credentials: ${JSON.stringify(url)}`);
  }
  return url;
}

export function isValidHttpsUrl(url: string): boolean {
  try {
    assertHttpsUrl(url);
    return true;
  } catch {
    return false;
  }
}

export function labelOperatorIdentity(label: string, evidence: OperatorEvidenceKind): Identity {
  const verified = evidence === "authenticated-host" || evidence === "authenticated-provider" || evidence === "configured-profile";
  return { label, evidence, verified };
}

export function validateRepositoryLocator(
  provider: string,
  repository: string,
  validateLocator?: RepositoryLocatorValidator,
): void {
  if (!provider || !repository) {
    throw new QuirksError("INVALID_REPOSITORY_PATH", "Provider repository locator is required");
  }
  if (validateLocator && !validateLocator(provider, repository)) {
    throw new QuirksError("INVALID_REPOSITORY_PATH", `Unsupported repository locator for ${provider}`);
  }
}

export function validatePullRequestUrl(url: string, provider: string, repository: string, validateLocator?: RepositoryLocatorValidator): string {
  const normalized = assertHttpsUrl(url);
  validateRepositoryLocator(provider, repository, validateLocator);
  return normalized;
}
