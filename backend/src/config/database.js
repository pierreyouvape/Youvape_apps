const { Pool, types } = require('pg');
require('dotenv').config({ path: '../../.env' });

// Les TIMESTAMP sans timezone (OID 1114) sont stockés en UTC dans notre BDD.
// Par défaut le driver pg les retourne comme string sans 'Z', ce qui fait que
// le navigateur les interprète en heure locale. On force l'ajout du 'Z'.
types.setTypeParser(1114, (val) => val ? val.replace(' ', 'T') + 'Z' : null);

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('✗ PostgreSQL connection error:', err);
  process.exit(-1);
});

module.exports = pool;