export function logError(error: unknown, context: Record<string, unknown> = {}): void {
  console.error(error, context);
}
