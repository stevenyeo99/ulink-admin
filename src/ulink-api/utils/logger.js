const winston = require('winston');
const path = require('path');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    config.isProduction
      ? winston.format.json()
      : winston.format.combine(winston.format.colorize(), winston.format.simple())
  ),
  defaultMeta: { service: 'ulink-api' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(__dirname, '..', 'logs', 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(__dirname, '..', 'logs', 'combined.log') }),
  ],
});

module.exports = logger;
