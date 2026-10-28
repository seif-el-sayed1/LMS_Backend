const morgan = require("morgan");
const expressWinston = require("express-winston");
const logger = require("../utils/logger");

module.exports = (app) => {
  // HTTP request logger — reuses the shared logger instance
  app.use(
    expressWinston.logger({
      transports: logger.transports,
      format: logger.format,
      statusLevels: true
    })
  );

  // HTTP error logger — moved here from app.js
  app.use(
    expressWinston.errorLogger({
      transports: logger.transports,
      format: logger.format
    })
  );

  console.log(`Mode: ${process.env.NODE_ENV}`.blue.bold);

  app.use(morgan("dev"));
};