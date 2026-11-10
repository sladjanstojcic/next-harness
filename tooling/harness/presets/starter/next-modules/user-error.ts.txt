export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function toUserMessage(error: unknown): string {
  return error instanceof UserError ? error.message : "Something went wrong.";
}
