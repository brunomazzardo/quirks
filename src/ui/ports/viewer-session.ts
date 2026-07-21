export interface ViewerSessionPort {
  issue(input: { repositoryId: string; now?: string }): Promise<{
    viewerToken: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  }>;
  authorize(input: { viewerToken: string; repositoryId: string; now?: string }): Promise<
    | { result: "authorized"; repositoryId: string; idleExpiresAt: string; absoluteExpiresAt: string }
    | { result: "expired" | "invalid" }
  >;
}
