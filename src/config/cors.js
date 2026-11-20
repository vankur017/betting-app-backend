"use strict";

/**
 * Turns CORS_ORIGIN ("http://localhost:5173,https://my-app.vercel.app") into the list the cors
 * package accepts. Trailing slashes are removed, because browsers send origins without one.
 * An entry with "*" matches one DNS label, so "https://my-app-*.vercel.app" also allows that
 * project's preview deployments. Avoid "https://*.vercel.app": it would let every Vercel site
 * call your local backend.
 */
function parseCorsOrigins(raw) {
  return (raw || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map((origin) => {
      if (!origin.includes("*")) return origin;
      const pattern = origin
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[a-z0-9-]+");
      return new RegExp(`^${pattern}$`, "i");
    });
}

module.exports = { parseCorsOrigins };
