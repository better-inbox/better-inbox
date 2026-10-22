// No imports on purpose: the ./wraps entry loads this, and must not pull in
// the event code (and with it @better-auth/core/context) at runtime.

/**
 * Throw from a channel's `deliver` for a send that will never succeed (an
 * invalid address, a hard bounce, a revoked token): the delivery is marked
 * `failed` without retrying.
 */
export class PermanentDeliveryError extends Error {
  readonly permanent = true;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PermanentDeliveryError";
  }
}

// duck-typed too, so a channel needn't import this package's class
export const isPermanent = (error: unknown) =>
  error instanceof PermanentDeliveryError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { permanent?: unknown }).permanent === true);
