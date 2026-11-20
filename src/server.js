"use strict";

const config = require("./config");
const { createApp } = require("./app");

const app = createApp({ dataFile: config.dataFile });

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(config.dataFile ? `Data file: ${config.dataFile}` : "Data: in memory (resets on restart)");
});
