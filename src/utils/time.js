"use strict";

function toIso(ms) {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

module.exports = { toIso };
