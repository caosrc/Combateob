const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const turf = require("@turf/turf");
const XLSX = require("xlsx");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || "incendio_secret_key_v3";
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
      db.run("INSERT INTO users (username, password, team) VALUES (?, ?, ?)",
        ["admin", bcrypt.hashSync("admin123", 10), "Equipe Alpha"]);
      db.run("INSERT INTO users (username, password, team) VALUES (?, ?, ?)",
        ["brigada1", bcrypt.hashSync("brigada123", 10), "Equipe Beta"]);
    }
  });
});

function auth(req, res, next) {
  const token = req.headers["authorization"] || req.body.token || req.query.token;
  if (!token) return res.status(401).json({ error: "Token required" });
  try {
    req.user = jwt.verify(token.replace("Bearer ", ""), SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
}

function parseData(raw) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}
function parsePoly(raw) {
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

// ===== LOGIN =====
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username=?", [username], (err, user) => {
    if (!user) return res.json({ error: "Usuário não encontrado" });
    if (!bcrypt.compareSync(password, user.password)) return res.json({ error: "Senha inválida" });
    const token = jwt.sign({ id: user.id, team: user.team, username: user.username }, SECRET);
    res.json({ token, team: user.team, username: user.username });
  });
});

// ===== REGISTRAR INCÊNDIO =====
app.post("/fire", auth, (req, res) => {
  const { data, polygon, signature } = req.body;
  let area = 0;
  if (polygon && polygon.length >= 3) {
    try {
      const poly = turf.polygon([[...polygon, polygon[0]]]);
      area = turf.area(poly) / 10000;
    } catch (e) { return res.json({ error: "Erro na área: " + e.message }); }
  }
  if (area === 0 && data && data.areaAtingida) area = parseFloat(data.areaAtingida) || 0;

  db.run(
    "INSERT INTO fires (data, area, team, polygon, signature, photos, createdAt) VALUES (?,?,?,?,?,?,?)",
    [JSON.stringify(data || {}), area, req.user.team, JSON.stringify(polygon || []), signature || null, "[]", new Date().toISOString()],
    function(err) {
      if (err) return res.json({ error: err.message });
      res.json({ ok: true, area, id: this.lastID });
    }
  );
});

// ===== DASHBOARD =====
app.get("/dashboard", (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.json({ error: err.message });
    const total = rows.length;
    const areaTotal = rows.reduce((a, b) => a + (b.area || 0), 0);
    res.json({ total, areaTotal, rows });
  });
});

// ===== PDF RELATÓRIO =====
app.get("/report/:id", (req, res) => {
  db.get("SELECT * FROM fires WHERE id=?", [req.params.id], (err, row) => {
    if (!row) return res.status(404).send("Não encontrado");
    const d = parseData(row.data);
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=relatorio-${row.id}.pdf`);
    doc.pipe(res);

    const fld = (label, val) => {
      if (!val) return;
      doc.fontSize(9).fillColor("#888").text(label.toUpperCase(), { continued: false });
      doc.fontSize(11).fillColor("#222").text(String(val)); doc.moveDown(0.3);
    };

    doc.fontSize(18).fillColor("#c0392b").text("RELATÓRIO DE INCÊNDIO FLORESTAL", { align: "center" });
    doc.fontSize(10).fillColor("#666").text(`Equipe: ${row.team}  |  ID: #${row.id}  |  ${new Date(row.createdAt).toLocaleString("pt-BR")}`, { align: "center" });
    doc.moveDown(); doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#c0392b"); doc.moveDown();

    doc.fontSize(13).fillColor("#c0392b").text("📍 Dados do Local"); doc.moveDown(0.3);
    fld("Município", d.municipio); fld("Coordenadas", d.coordStr); fld("Local de Referência", d.localReferencia);
    fld("Local", d.local); fld("UC", d.uc); doc.moveDown(0.5);

    doc.fontSize(13).fillColor("#c0392b").text("🔍 Dados da Detecção"); doc.moveDown(0.3);
    fld("Data de Detecção", d.dataDeteccao); fld("Hora de Detecção", d.horaDeteccao);
    fld("Forma de Detecção", d.formaDeteccao); doc.moveDown(0.5);

    doc.fontSize(13).fillColor("#c0392b").text("👤 Dados do Contato"); doc.moveDown(0.3);
    fld("Nome do Contato", d.nomeContato); fld("Orgão / Função", d.orgaoContato); fld("Telefone", d.telefoneContato); doc.moveDown(0.5);

    doc.fontSize(13).fillColor("#c0392b").text("🚒 Dados do Combate"); doc.moveDown(0.3);
    fld("Início do Combate", (d.inicioData || "") + " " + (d.inicioHora || ""));
    fld("Descrição da Ocorrência", d.descricao); fld("Pessoal Mobilizado", d.pessoal);
    fld("Veículos Mobilizados", d.veiculos);
    fld("Incêndio Debelado", (d.debeladoData || "") + " " + (d.debeladoHora || ""));
    fld("Houve Alimentação", d.alimentacao); doc.moveDown(0.5);

    doc.fontSize(13).fillColor("#c0392b").text("🔥 Área e Causa"); doc.moveDown(0.3);
    fld("Causa do Incêndio", d.causa);
    fld("Área Atingida", row.area ? row.area.toFixed(4) + " ha" : (d.areaAtingida ? d.areaAtingida + " ha" : "–"));
    doc.end();
  });
});

// ===== EXPORT EXCEL =====
app.get("/export/excel", auth, (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const data = rows.map(r => {
      const d = parseData(r.data);
      return {
        "ID": r.id,
        "Data/Hora Registro": new Date(r.createdAt).toLocaleString("pt-BR"),
        "Equipe": r.team,
        "Município": d.municipio || "",
        "Coordenadas": d.coordStr || "",
        "Latitude": d.lat || "",
        "Longitude": d.lng || "",
        "Local de Referência": d.localReferencia || "",
        "Local (Entorno/Interno)": d.local || "",
        "UC": d.uc || "",
        "Data Detecção": d.dataDeteccao || "",
        "Hora Detecção": d.horaDeteccao || "",
        "Forma de Detecção": d.formaDeteccao || "",
        "Nome do Contato": d.nomeContato || "",
        "Orgão / Função": d.orgaoContato || "",
        "Telefone": d.telefoneContato || "",
        "Início Combate – Data": d.inicioData || "",
        "Início Combate – Hora": d.inicioHora || "",
        "Descrição da Ocorrência": d.descricao || "",
        "Pessoal Mobilizado": d.pessoal || "",
        "Veículos Mobilizados": d.veiculos || "",
        "Debelado – Data": d.debeladoData || "",
        "Debelado – Hora": d.debeladoHora || "",
        "Houve Alimentação": d.alimentacao || "",
        "Causa do Incêndio": d.causa || "",
        "Área Atingida (ha)": r.area ? parseFloat(r.area.toFixed(4)) : (parseFloat(d.areaAtingida) || "")
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Incêndios");
    ws["!cols"] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 16) }));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=incendios-brigada.xlsx");
    res.send(buf);
  });
});

// ===== EXPORT KMZ =====
app.get("/export/kmz", auth, (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Brigada Incêndio – Registros</name>
  <Style id="poly"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle><PolyStyle><color>440000ff</color></PolyStyle></Style>
  <Style id="pt"><IconStyle><color>ff0000ff</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/ms/icons/red-dot.png</href></Icon></IconStyle></Style>`;

    rows.forEach(r => {
      const d = parseData(r.data);
      const poly = parsePoly(r.polygon);
      kml += `\n  <Placemark>\n    <name>Incêndio #${r.id} – ${d.municipio || "Sem município"}</name>
    <description><![CDATA[<b>Equipe:</b> ${r.team}<br><b>Data:</b> ${new Date(r.createdAt).toLocaleString("pt-BR")}<br><b>Área:</b> ${r.area ? r.area.toFixed(4) + " ha" : d.areaAtingida || "–"}<br><b>Município:</b> ${d.municipio || "–"}<br><b>Coordenadas:</b> ${d.coordStr || "–"}<br><b>Local:</b> ${d.local || "–"}<br><b>UC:</b> ${d.uc || "–"}<br><b>Data Detecção:</b> ${d.dataDeteccao || "–"} ${d.horaDeteccao || ""}<br><b>Forma Detecção:</b> ${d.formaDeteccao || "–"}<br><b>Contato:</b> ${d.nomeContato || "–"}<br><b>Causa:</b> ${d.causa || "–"}<br><b>Descrição:</b> ${d.descricao || "–"}]]></description>`;
      if (poly.length >= 3) {
        const coords = [...poly, poly[0]].map(([lng, lat]) => `${lng},${lat},0`).join(" ");
        kml += `\n    <styleUrl>#poly</styleUrl>\n    <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      } else if (d.lat && d.lng) {
        kml += `\n    <styleUrl>#pt</styleUrl>\n    <Point><coordinates>${d.lng},${d.lat},0</coordinates></Point>`;
      }
      kml += `\n  </Placemark>`;
    });

    kml += `\n</Document>\n</kml>`;
    res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
    res.setHeader("Content-Disposition", "attachment; filename=incendios-brigada.kmz");
    const arch = archiver("zip", { zlib: { level: 9 } });
    arch.on("error", e => res.status(500).send(e.message));
    arch.pipe(res);
    arch.append(kml, { name: "doc.kml" });
    arch.finalize();
  });
});

// ===== SYNC OFFLINE =====
app.post("/sync", auth, (req, res) => {
  const { fires } = req.body;
  if (!fires || !Array.isArray(fires)) return res.json({ ok: false });
  let count = 0;
  fires.forEach(fire => {
    let area = 0;
    try {
      if (fire.polygon && fire.polygon.length >= 3) {
        area = turf.area(turf.polygon([[...fire.polygon, fire.polygon[0]]])) / 10000;
      } else if (fire.data && fire.data.areaAtingida) area = parseFloat(fire.data.areaAtingida) || 0;
    } catch (e) {}
    db.run("INSERT INTO fires (data, area, team, polygon, signature, photos, createdAt) VALUES (?,?,?,?,?,?,?)",
      [JSON.stringify(fire.data || {}), area, req.user.team, JSON.stringify(fire.polygon || []),
       fire.signature || null, "[]", fire.createdAt || new Date().toISOString()],
      () => count++);
  });
  setTimeout(() => res.json({ ok: true, synced: count }), 500);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => console.log(`Brigada Incêndio na porta ${PORT}`));
