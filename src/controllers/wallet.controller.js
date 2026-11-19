"use strict";

const RECENT_TRANSACTIONS = 10;

function createWalletController(walletService) {
  return {
    getWallet(req, res) {
      res.json({
        success: true,
        data: {
          ...walletService.getWallet(),
          recentTransactions: walletService.recentTransactions(RECENT_TRANSACTIONS),
        },
      });
    },
  };
}

module.exports = { createWalletController };
