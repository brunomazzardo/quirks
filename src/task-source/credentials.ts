export interface CredentialResolver {
  /**
   * Resolve credential environment variables for an adapter alias.
   * When `requestedEnvironmentNames` is empty, return every variable
   * allow-listed for that alias rather than an empty map.
   */
  resolve(
    alias: string,
    requestedEnvironmentNames: readonly string[],
  ): Promise<Readonly<Record<string, string>>>;
}
