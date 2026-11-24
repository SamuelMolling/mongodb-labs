/**
 * An error that knows its HTTP status. Thrown from registry logic and turned
 * into a response by the central error handler in app.js.
 *
 * Throwing one inside session.withTransaction() aborts the transaction: the
 * driver only retries on TransientTransactionError / UnknownTransactionCommitResult
 * labels, and an HttpError carries neither.
 */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (msg) => new HttpError(404, msg);

/**
 * 409 is the answer to "someone else changed this deployment since you
 * looked". It carries the current state so the caller can decide what to do
 * with it, instead of retrying blindly and becoming the last writer who wins.
 */
export const conflict = (msg, details) => new HttpError(409, msg, details);
