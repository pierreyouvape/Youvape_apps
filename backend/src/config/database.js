const { Pool } = require('pg');
require('dotenv').config({ path: '../../.env' });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  // JIT coupé (17/11/2026). Le planificateur surestime le coût des requêtes
  // à sous-requêtes corrélées et les compile à la volée : la liste des
  // factures fournisseurs (142 lignes) passait 14,3 s à compiler pour 0,13 s
  // d'exécution réelle. Sur des requêtes de quelques ms à quelques s, la
  // compilation coûte toujours plus qu'elle ne rapporte.
  options: '-c jit=off',
});

pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('✗ PostgreSQL connection error:', err);
  process.exit(-1);
});

module.exports = pool;