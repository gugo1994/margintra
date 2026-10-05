export class MargintraError extends Error {
  constructor(public readonly status: number | null, public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message); this.name = 'MargintraError';
  }
}
