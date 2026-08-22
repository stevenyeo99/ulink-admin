const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const env = process.env.NODE_ENV || 'development';
const dbConfig = require('../../config/database')[env];

const sequelize = dbConfig.use_env_variable
  ? new Sequelize(process.env[dbConfig.use_env_variable], { ...dbConfig, define: { underscored: true, timestamps: true } })
  : new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
      ...dbConfig,
      define: { underscored: true, timestamps: true },
    });

const db = {};

fs.readdirSync(__dirname)
  .filter((file) => file !== 'index.js' && file.endsWith('.js'))
  .forEach((file) => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.values(db).forEach((model) => {
  if (typeof model.associate === 'function') {
    model.associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
