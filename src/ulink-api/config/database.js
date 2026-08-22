require('dotenv').config();

const ssl = !['false', '0', 'no', 'n'].includes(String(process.env.SUPABASE_DB_SSL).trim().toLowerCase());

const shared = {
  dialect: 'postgres',
  use_env_variable: 'SUPABASE_DB_CONN_STR',
  dialectOptions: ssl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  pool: {
    max: parseInt(process.env.SUPABASE_DB_POOL_MAX, 10) || 10,
    min: parseInt(process.env.SUPABASE_DB_POOL_MIN, 10) || 0,
    idle: parseInt(process.env.SUPABASE_DB_POOL_IDLE_MS, 10) || 30000,
    acquire: parseInt(process.env.SUPABASE_DB_POOL_ACQUIRE_MS, 10) || 30000,
  },
  logging: false,
};

// sequelize-cli requires this file to export plain env-keyed config (not our
// app's parsed config/index.js). Used by both `sequelize-cli db:migrate` and
// db/models/index.js at runtime.
module.exports = {
  development: shared,
  test: shared,
  production: shared,
};
