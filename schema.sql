-- Schema D1 – Brigada Ouro
-- Execute: wrangler d1 execute brigada-ouro --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  team TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL DEFAULT '{}',
  area REAL DEFAULT 0,
  team TEXT,
  polygon TEXT DEFAULT '[]',
  photos TEXT DEFAULT '[]',
  signature TEXT,
  createdAt TEXT NOT NULL
);
