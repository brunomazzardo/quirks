export interface CredentialResolver {
  resolve(
    alias: string,
    requestedEnvironmentNames: readonly string[],
  ): Promise<Readonly<Record<string, string>>>;
}
