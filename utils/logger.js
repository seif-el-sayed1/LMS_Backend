const winston = require("winston");
const { format } = winston;

const sharedFormat = format.combine(
  format.errors({ stack: true }),
  format.json(),
  format.timestamp(),
  format.metadata()
);

const devTransports = [
  new winston.transports.File({ level: "info",  filename: "1. logs/infoLogs.log" }),
  new winston.transports.File({ level: "warn",  filename: "1. logs/warningLogs.log" }),
  new winston.transports.File({ level: "error", filename: "1. logs/errorLogs.log" }),
  new winston.transports.File({ filename: "1. logs/internalErrorLogs.log" }),
];

const prodTransports = [
  new winston.transports.Console(),
  new winston.transports.File({ filename: "logfile.log" }),
  new winston.transports.File({ filename: "1. logs/app.log" }),
];

const logger = winston.createLogger({
  transports:
    process.env.NODE_ENV === "production" ? prodTransports : devTransports,
  format: sharedFormat,
  statusLevels: true
});

module.exports = logger;