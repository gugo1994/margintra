export class ApplicationError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}
export class CodedApplicationError extends ApplicationError {
  constructor(status: number, code: string, message: string) {
    super(status, code.replaceAll('_', ' '), message, code);
  }
}
export class NotFoundError extends ApplicationError {
  constructor(message = 'The requested resource was not found.') {
    super(404, 'Not found', message);
  }
}
export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(409, 'Conflict', message);
  }
}
export class UnauthorizedError extends ApplicationError {
  constructor(message = 'Authentication is required.') {
    super(401, 'Unauthorized', message);
  }
}
export class ForbiddenError extends ApplicationError {
  constructor(message: string) {
    super(403, 'Forbidden', message);
  }
}
export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super(400, 'Validation failed', message);
  }
}
