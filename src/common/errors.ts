export class BaseError extends Error {
  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConnectionError extends BaseError {
  constructor(message: string, details?: string) {
    super(message, details);
  }
}

export class QueryError extends BaseError {
  constructor(
    message: string,
    public readonly query?: string,
    details?: string
  ) {
    super(message, details);
  }
}

export class AuthenticationError extends BaseError {
  constructor(message: string, details?: string) {
    super(message, details);
  }
}
