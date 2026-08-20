# ulink-api

Express.js API and workflow service for ULINK Admin.

## Getting started

```bash
cp .env.example .env
npm install
npm run dev      # nodemon, auto-reload
npm start        # production entrypoint (bin/www)
```

## Scripts

| Script            | Purpose                              |
| ------------------ | ------------------------------------ |
| `npm run dev`       | Start with nodemon (auto-reload)     |
| `npm start`         | Start via `bin/www`                  |
| `npm test`          | Run Jest + Supertest suite           |
| `npm run lint`      | ESLint                               |
| `npm run lint:fix`  | ESLint with autofix                  |
| `npm run format`    | Prettier write                       |

## Structure

```
bin/www           # HTTP server entrypoint, graceful shutdown
app.js            # Express app: middleware, routes, error handling
config/           # Environment-driven configuration
middlewares/      # Error handling (404 + centralized error handler)
routes/           # Route definitions (index, health, api/*)
utils/logger.js   # Winston structured logger
tests/            # Jest + Supertest
logs/             # Runtime log files (gitignored)
```

## Production-readiness features

- **Security**: `helmet`, `cors`, `express-rate-limit`
- **Performance**: `compression`
- **Logging**: `winston` (structured, file + console) with `morgan` HTTP request logging piped through it
- **Config**: `dotenv`-based environment configuration (see `.env.example`)
- **Error handling**: centralized 404 + error-handling middleware, stack traces hidden in production
- **Graceful shutdown**: `SIGTERM`/`SIGINT` handling with connection draining, plus `uncaughtException`/`unhandledRejection` guards
- **Health check**: `GET /health` for uptime/orchestration probes

## Routes

- `GET /` — welcome payload
- `GET /health` — health check
- `GET /api/users` — example API resource (extend for real workflow endpoints)
