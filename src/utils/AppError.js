"use strict";

/** An expected error that is safe to show the client. */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
