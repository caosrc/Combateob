const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const turf = require("@turf/turf");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SECRET = "incendio_secret_key_v3";

const db = new sqlite3.Database(path.join(__dirname, "db.sqlite"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    team TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS fires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT,
    area REAL,
    team TEXT,
    polygon TEXT,
    photos TEXT,
    signature TEXT,
    createdAt TEXT
  )`);

  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (row && row.count === 0) {
      const hash = bcrypt.hashSync("admin123", 10);
      db.run("INSERT INTO users (username, password, team) VALUES (?, ?, ?)",
        ["admin", hash, "Equipe Alpha"]);
      const hash2 = bcrypt.hashSync("brigada123", 10);
      db.run("INSERT INTO users (username, password, team) VALUES (?, ?, ?)",
        ["brigada1", hash2, "Equipe Beta"]);
    }
  });
});

function auth(req, res, next) {
  const token = req.headers["authorization"] || req.body.token;
  if (!token) return res.status(401).json({ error: "Token required" });
  try {
    req.user = jwt.verify(token.replace("Bearer ", ""), SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username=?", [username], (err, user) => {
    if (!user) return res.json({ error: "Usuário não encontrado" });
    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.json({ error: "Senha inválida" });
    const token = jwt.sign({ id: user.id, team: user.team, username: user.username }, SECRET);
    res.json({ token, team: user.team, username: user.username });
  });
});

app.post("/fire", auth, (req, res) => {
  const { data, polygon, signature } = req.body;
  if (!polygon || polygon.length < 3) {
    return res.json({ error: "Polígono inválido" });
  }

  let area = 0;
  try {
    const closed = [...polygon, polygon[0]];
    const poly = turf.polygon([closed]);
    area = turf.area(poly) / 10000;
  } catch (e) {
    return res.json({ error: "Erro ao calcular área: " + e.message });
  }

  const createdAt = new Date().toISOString();
  db.run(
    "INSERT INTO fires (data, area, team, polygon, signature, photos, createdAt) VALUES (?,?,?,?,?,?,?)",
    [JSON.stringify(data), area, req.user.team, JSON.stringify(polygon), signature || null, "[]", createdAt],
    function(err) {
      if (err) return res.json({ error: err.message });
      res.json({ ok: true, area, id: this.lastID });
    }
  );
});

app.post("/fire/:id/photo", auth, upload.single("photo"), (req, res) => {
  const { id } = req.params;
  const { lat, lng } = req.body;

  db.get("SELECT * FROM fires WHERE id=?", [id], (err, fire) => {
    if (!fire) return res.json({ error: "Incêndio não encontrado" });
    const photos = JSON.parse(fire.photos || "[]");
    photos.push({ filename: req.file.filename, lat, lng, time: new Date().toISOString() });
    db.run("UPDATE fires SET photos=? WHERE id=?", [JSON.stringify(photos), id], () => {
      res.json({ ok: true, filename: req.file.filename });
    });
  });
});

app.get("/dashboard", (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.json({ error: err.message });
    const total = rows.length;
    const areaTotal = rows.reduce((a, b) => a + (b.area || 0), 0);
    res.json({ total, areaTotal, rows });
  });
});

app.get("/fires", auth, (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.json({ error: err.message });
    res.json(rows);
  });
});

app.get("/report/:id", (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM fires WHERE id=?", [id], (err, row) => {
    if (!row) return res.status(404).send("Não encontrado");

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=relatorio-incendio-${id}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).fillColor("#b30000").text("RELATÓRIO DE INCÊNDIO FLORESTAL", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).fillColor("#333");
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke("#b30000");
    doc.moveDown();

    const data = JSON.parse(row.data || "{}");
    doc.fontSize(14).fillColor("#000").text("Informações do Incêndio");
    doc.fontSize(11).fillColor("#333");
    doc.text(`ID do Registro: ${row.id}`);
    doc.text(`Área Queimada: ${row.area ? row.area.toFixed(4) : "N/A"} hectares`);
    doc.text(`Data/Hora: ${new Date(row.createdAt).toLocaleString("pt-BR")}`);
    doc.text(`Equipe: ${row.team}`);
    if (data.municipio) doc.text(`Município: ${data.municipio}`);
    if (data.descricao) doc.text(`Descrição: ${data.descricao}`);
    if (data.causa) doc.text(`Causa Provável: ${data.causa}`);

    doc.moveDown();
    doc.end();
  });
});

app.post("/sync", auth, (req, res) => {
  const { fires } = req.body;
  if (!fires || !Array.isArray(fires)) return res.json({ ok: false, error: "Invalid data" });

  let count = 0;
  fires.forEach(fire => {
    let area = 0;
    try {
      if (fire.polygon && fire.polygon.length >= 3) {
        const closed = [...fire.polygon, fire.polygon[0]];
        const poly = turf.polygon([closed]);
        area = turf.area(poly) / 10000;
      }
    } catch (e) {}

    db.run(
      "INSERT INTO fires (data, area, team, polygon, signature, photos, createdAt) VALUES (?,?,?,?,?,?,?)",
      [JSON.stringify(fire.data || {}), area, req.user.team, JSON.stringify(fire.polygon || []),
       fire.signature || null, JSON.stringify(fire.photos || []), fire.createdAt || new Date().toISOString()],
      () => count++
    );
  });

  setTimeout(() => res.json({ ok: true, synced: count }), 500);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => console.log(`V3 rodando na porta ${PORT}`));
