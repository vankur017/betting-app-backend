"use strict";

const { AppError } = require("../utils/AppError");

// eslint-disable-next-line no-unused-vars -- Express needs four arguments to treat this as an error handler.
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return res.status(err.status).json({ success: false, error });
  }

  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_JSON", message: "The request body is not valid JSON." },
    });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." },
    });
  }

  // Unexpected: log server-side, return a generic message without internals.
  console.error(`[error] ${req.method} ${req.path}:`, err && err.stack ? err.stack : err);
  return res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  });
}

module.exports = { errorHandler };
