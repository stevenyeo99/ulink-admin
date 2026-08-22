const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const logger = require('./utils/logger');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const openapiSpec = require('./openapi/spec');

const rootRouter = require('./routes/meta/root');
const healthRouter = require('./routes/meta/health');
const usersRouter = require('./routes/users');
const jobsRouter = require('./routes/jobs');
const devClaimRecognitionRouter = require('./routes/dev/claimRecognition');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(compression());
app.use(
  morgan(config.isProduction ? 'combined' : 'dev', {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use('/', rootRouter);
app.use('/health', healthRouter);
app.use('/api/users', usersRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/dev/claim-recognition', devClaimRecognitionRouter);

// Swagger UI needs inline script/style, which the global helmet CSP blocks —
// relax it for this path only, everything else keeps the strict default.
app.use(
  '/api/docs',
  (req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec)
);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
