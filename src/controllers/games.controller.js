"use strict";

const { games } = require("../config/games");

function listGames(req, res) {
  res.json({ success: true, data: games });
}

module.exports = { listGames };
