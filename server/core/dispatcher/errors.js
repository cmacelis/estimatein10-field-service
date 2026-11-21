export class DispatchError extends Error {
  constructor(code, status = 500, details = {}) {
    super(code);
    this.name = 'DispatchError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function dispatchError(code, status = 500, details = {}) {
  return new DispatchError(code, status, details);
}
