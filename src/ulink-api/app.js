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
const devDocumentCheckingRouter = require('./routes/dev/documentChecking');
const devCasesRouter = require('./routes/dev/cases');
const devEmailSenderRouter = require('./routes/dev/emailSender');
const devMemberVerificationRouter = require('./routes/dev/memberVerification');
const devIcd10Router = require('./routes/dev/icd10');
const devIasClaimPreparationRouter = require('./routes/dev/iasClaimPreparation');
const devIasClaimCreationRouter = require('./routes/dev/iasClaimCreation');

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
app.use('/api/dev/document-checking', devDocumentCheckingRouter);
app.use('/api/dev/cases', devCasesRouter);
app.use('/api/dev/email-sender', devEmailSenderRouter);
app.use('/api/dev/member-verification', devMemberVerificationRouter);
app.use('/api/dev/icd10', devIcd10Router);
app.use('/api/dev/ias-claim-preparation', devIasClaimPreparationRouter);
app.use('/api/dev/ias-claim-creation', devIasClaimCreationRouter);

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
