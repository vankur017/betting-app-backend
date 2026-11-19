"use strict";

const { AppError } = require("../utils/AppError");

/** Shared stake check for every game. Limits come from server config, never the client. */
function validateStake(stake, { minStake, maxStake }) {
  if (typeof stake !== "number" || !Number.isSafeInteger(stake)) {
    throw new AppError(400, "INVALID_STAKE", "Stake must be a whole number of minor coin units.", {
      field: "stake",
    });
  }
  if (stake < minStake || stake > maxStake) {
    throw new AppError(
      400,
      "STAKE_OUT_OF_RANGE",
      `Stake must be between ${minStake} and ${maxStake} minor units.`,
      { field: "stake", minStake, maxStake },
    );
  }
}

module.exports = { validateStake };
