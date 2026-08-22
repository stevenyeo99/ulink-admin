const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const config = require('../config');

/**
 * Spec is generated from `@openapi` JSDoc blocks on the route files listed in
 * `apis` below — not hand-maintained here. Documenting a route means adding
 * (or updating) its JSDoc block in the file that defines it; nothing else to
 * keep in sync. If a new route file is added under routes/, add its glob
 * pattern to `apis`.
 */
const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'ULINK STP API',
      version: '1.0.0-day1',
      description:
        'Day 1 scope: email submission recognition (Lego block 1 — email thread & attachment intake). ' +
        'No authentication; assumes a trusted host/network. Add a shared-secret header on /api/jobs/* before external exposure.',
    },
    servers: [{ url: `http://localhost:${config.port}`, description: 'Local' }],
    tags: [
      { name: 'meta', description: 'Service identity / liveness' },
      { name: 'jobs', description: 'Cron-triggered pipeline block runners' },
      { name: 'users', description: 'Scaffold route, not wired to a real module yet' },
      { name: 'dev', description: 'Developer-only tools — dry runs, no persistence, no auth' },
    ],
  },
  apis: [
    path.join(__dirname, '../routes/meta/*.js'),
    path.join(__dirname, '../routes/users/*.js'),
    path.join(__dirname, '../routes/jobs/index.js'),
    path.join(__dirname, '../routes/dev/*.js'),
  ],
});

module.exports = spec;
