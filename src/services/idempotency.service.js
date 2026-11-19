"use strict";

const { AppError } = require("../utils/AppError");

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_ENTRIES = 1000;

/**
 * Runs `operation` at most once per key. A repeat with the same key and payload returns the
 * first result instead of running again; a repeat with a different payload is rejected.
 * Failed operations are not stored, so they can be retried with the same key.
 */
function createIdempotencyService({ store }) {
  return {
    run(scope, key, fingerprint, operation) {
      if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
        throw new AppError(
          400,
          "INVALID_IDEMPOTENCY_KEY",
          "Send an Idempotency-Key header of 8-100 letters, digits, '-' or '_'.",
        );
      }
      const id = `${scope}:${key}`;
      const existing = store.idempotency.get(id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used for a different request.",
          );
        }
        return { value: existing.value, replayed: true };
      }

      const value = operation();
      store.idempotency.set(id, { fingerprint, value });
      if (store.idempotency.size > MAX_ENTRIES) {
        store.idempotency.delete(store.idempotency.keys().next().value);
      }
      return { value, replayed: false };
    },
  };
}

module.exports = { createIdempotencyService };
