export function isAuthHttpStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export function readHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = /^request failed: (\d+)$/.exec(error.message);
  return match ? Number(match[1]) : undefined;
}

export function isAuthHttpError(error: unknown): boolean {
  const status = readHttpStatus(error);
  return status !== undefined && isAuthHttpStatus(status);
}
