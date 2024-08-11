// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
import dotenv from 'dotenv';
dotenv.config({ silent: true, path: './../../../.env' })
import config from './../../../config/database.js';

let setConfig = {
  // ...config, 
  client: process.env.DB_CLIENT || 'mysql',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  },
  migrations: {
    directory: './../../../database/migrations'
  },
  seeds: {
    directory: './../../../database/seeds'
  },
  ...config(process),
}
export default {

  development: setConfig,
  staging: setConfig,
  production: setConfig

};
