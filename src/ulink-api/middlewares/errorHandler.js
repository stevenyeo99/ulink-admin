const createError = require('http-errors');
const logger = require('../utils/logger');
const config = require('../config');

function notFoundHandler(req, res, next) {
  next(createError(404, `Not Found - ${req.originalUrl}`));
}

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  logger.error(err.message, { status, stack: err.stack, path: req.originalUrl, method: req.method });

  res.status(status).json({
    error: {
      message: status === 500 && config.isProduction ? 'Internal Server Error' : err.message,
      status,
      ...(config.isProduction ? {} : { stack: err.stack }),
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
