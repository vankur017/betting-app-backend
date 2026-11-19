"use strict";

function health(req, res) {
  res.json({ success: true, message: "Betting Game API is running" });
}

module.exports = { health };
