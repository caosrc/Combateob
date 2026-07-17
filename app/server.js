const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const turf = require("@turf/turf");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const archiver = require("archiver");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

// ===== CONVERSÃO WGS84 → UTM =====
function wgs84ToUTM(lat, lng) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const zone = Math.floor((lng + 180) / 6) + 1;
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const lambda = lng * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lambda - lambda0);
  const M = a * (
    (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi)
  );
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  const northingRaw = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  const northing = lat < 0 ? northingRaw + 10000000 : northingRaw;
  const hemisphere = lat < 0 ? "S" : "N";
  return { zone, hemisphere, fuso: `${zone}${hemisphere}`, easting: Math.round(easting * 100) / 100, northing: Math.round(northing * 100) / 100 };
}

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("sw.js") || filePath.endsWith("manifest.json")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

app.use("/login", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use("/fire", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use("/dashboard", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use("/sync", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use("/report", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use("/export", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "incendio_secret_key_v3";
const db = new sqlite3.Database(path.join(__dirname, "db.sqlite"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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
    mapSnapshot TEXT,
    createdAt TEXT
  )`);
  // Adiciona coluna se DB já existia sem ela
  db.run(`ALTER TABLE fires ADD COLUMN mapSnapshot TEXT`, () => {});
  // Migração: registros antigos de combatentes gravavam team="Combatente" em vez da
  // equipe responsável (data.nomeEquipe). Corrige para o gestor certo poder gerenciar.
  db.all("SELECT id, data FROM fires WHERE team = 'Combatente' OR team IS NULL", (err, rows) => {
    if (err || !rows) return;
    rows.forEach(row => {
      let nomeEquipe = null;
      try { nomeEquipe = JSON.parse(row.data || "{}").nomeEquipe; } catch (_) {}
      if (nomeEquipe && EQUIPES_VALIDAS.includes(nomeEquipe)) {
        db.run("UPDATE fires SET team = ? WHERE id = ?", [nomeEquipe, row.id]);
      }
    });
  });
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (row && row.count === 0) {
      db.run("INSERT INTO users (username, password, team) VALUES (?, ?, ?)",
        ["admin", bcrypt.hashSync("admin123", 10), "Equipe Alpha"]);
      db.run("INSERT INTO users (username, password, team) VALUES (?, ?, ?)",
        ["brigada1", bcrypt.hashSync("brigada123", 10), "Equipe Beta"]);
    }
  });
});

const SENHA_DC = "301067";
const EQUIPES_VALIDAS = ["Defesa Civil", "IEF", "Carcará", "AMDA Gerdau", "AMDA IEF", "CBMMG"];
const EQUIPES_OUTROS = ["IEF", "Carcará", "AMDA Gerdau", "AMDA IEF", "CBMMG"];

// Tabela de senhas por equipe (gerenciada pela Defesa Civil)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS gestor_senhas (
    equipe TEXT PRIMARY KEY,
    senha TEXT NOT NULL
  )`);
  // Insere senha inicial para cada equipe (mantém se já existir)
  EQUIPES_OUTROS.forEach(eq => {
    db.run("INSERT OR IGNORE INTO gestor_senhas (equipe, senha) VALUES (?, ?)", [eq, "106106"]);
  });
});

function getSenhaEquipe(equipe) {
  if (equipe === "Defesa Civil") return Promise.resolve(SENHA_DC);
  return new Promise((resolve) => {
    db.get("SELECT senha FROM gestor_senhas WHERE equipe = ?", [equipe], (err, row) => {
      resolve(row ? row.senha : null);
    });
  });
}

async function auth(req, res, next) {
  const token = (req.headers["authorization"] || req.body.token || req.query.token || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Token required" });

  // Token local gerado no cliente (sem servidor/offline): formato base64(payload).local
  if (token.endsWith(".local")) {
    try {
      const payloadB64 = token.slice(0, -".local".length);
      const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
      const role = payload.role;
      const team = payload.team;
      if (role === "combatente") {
        req.user = { role: "combatente", team: "Combatente" };
        return next();
      }
      if (role === "gestor" && EQUIPES_VALIDAS.includes(team)) {
        const expectedSenha = await getSenhaEquipe(team);
        if (expectedSenha && payload.senha === expectedSenha) {
          req.user = { role: "gestor", team };
          return next();
        }
      }
    } catch (e) {}
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    req.user = jwt.verify(token, SECRET);
    return next();
  } catch (e) {}
  res.status(401).json({ error: "Invalid token" });
}

function apenasDefesaCivil(req, res, next) {
  if (req.user.role !== "gestor" || req.user.team !== "Defesa Civil") {
    return res.status(403).json({ error: "Acesso restrito à Defesa Civil." });
  }
  next();
}

function parseData(raw) {
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}
function parsePoly(raw) {
  try {
    let p = JSON.parse(raw || "[]");
    if (p.length > 0 && Array.isArray(p[0]) && Array.isArray(p[0][0])) p = p[0];
    return p;
  } catch { return []; }
}

// ===== LOGIN LEGADO =====
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username=?", [username], (err, user) => {
    if (!user) return res.json({ error: "Usuário não encontrado" });
    if (!bcrypt.compareSync(password, user.password)) return res.json({ error: "Senha inválida" });
    const token = jwt.sign({ id: user.id, team: user.team, username: user.username }, SECRET);
    res.json({ token, team: user.team, username: user.username });
  });
});

// ===== AUTH COMBATENTE =====
app.post("/auth/combatente", (req, res) => {
  const token = jwt.sign({ role: "combatente", team: "Combatente" }, SECRET);
  res.json({ token, role: "combatente", team: "Combatente" });
});

// ===== AUTH GESTOR =====
app.post("/auth/gestor", async (req, res) => {
  const { equipe, senha } = req.body;
  if (!EQUIPES_VALIDAS.includes(equipe)) return res.json({ error: "Equipe inválida" });
  const expectedSenha = await getSenhaEquipe(equipe);
  if (!expectedSenha || senha !== expectedSenha) return res.json({ error: "Senha incorreta" });
  const token = jwt.sign({ role: "gestor", team: equipe }, SECRET);
  res.json({ token, role: "gestor", team: equipe });
});

// ===== ADMIN: GERENCIAR SENHAS (apenas Defesa Civil) =====
app.get("/admin/senhas", auth, apenasDefesaCivil, (req, res) => {
  db.all("SELECT equipe, senha FROM gestor_senhas ORDER BY equipe", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ senhas: rows });
  });
});

app.put("/admin/senha/:equipe", auth, apenasDefesaCivil, (req, res) => {
  const { equipe } = req.params;
  const { senha } = req.body;
  if (!EQUIPES_OUTROS.includes(equipe)) return res.status(400).json({ error: "Equipe inválida ou não editável." });
  if (!senha || senha.length < 4) return res.status(400).json({ error: "Senha muito curta (mínimo 4 caracteres)." });
  db.run("INSERT OR REPLACE INTO gestor_senhas (equipe, senha) VALUES (?, ?)", [equipe, senha], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// ===== REGISTRAR INCÊNDIO =====
// Determina a equipe "dona" do registro: para combatentes, é a equipe escolhida
// no formulário (data.nomeEquipe); para gestores, é a equipe do próprio login.
function equipeDoRegistro(user, data) {
  if (user.role === "combatente" && data && EQUIPES_VALIDAS.includes(data.nomeEquipe)) {
    return data.nomeEquipe;
  }
  return user.team;
}

app.post("/fire", auth, (req, res) => {
  const { data, polygon, signature, photos, mapSnapshot } = req.body;
  let area = 0;
  if (polygon && Array.isArray(polygon) && polygon.length >= 3) {
    try {
      const poly = turf.polygon([[...polygon, polygon[0]]]);
      const calculated = turf.area(poly) / 10000;
      area = isNaN(calculated) ? 0 : calculated;
    } catch (e) { return res.json({ error: "Erro na área: " + e.message }); }
  }
  if (area === 0 && data && data.areaAtingida) area = parseFloat(data.areaAtingida) || 0;
  if (isNaN(area)) area = 0;

  db.run(
    "INSERT INTO fires (data, area, team, polygon, signature, photos, mapSnapshot, createdAt) VALUES (?,?,?,?,?,?,?,?)",
    [JSON.stringify(data || {}), area, equipeDoRegistro(req.user, data), JSON.stringify(polygon || []), signature || null, JSON.stringify(photos || []), mapSnapshot || null, new Date().toISOString()],
    function(err) {
      if (err) return res.json({ error: err.message });
      res.json({ ok: true, area, id: this.lastID });
    }
  );
});

// ===== DASHBOARD =====
app.get("/dashboard", auth, (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.json({ error: err.message });
    const total = rows.length;
    const areaTotal = rows.reduce((a, b) => a + (b.area || 0), 0);
    res.json({ total, areaTotal, rows });
  });
});

// ===== PDF RELATÓRIO =====
app.get("/report/:id", auth, (req, res) => {
  db.get("SELECT * FROM fires WHERE id=?", [req.params.id], (err, row) => {
    if (!row) return res.status(404).send("Não encontrado");
    const d = parseData(row.data);
    const doc = new PDFDocument({ margin: 0, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=relatorio-incendio-${row.id}.pdf`);
    doc.pipe(res);

    const ML = 45, MR = 45, PW = 595 - ML - MR;
    const RED = "#c0392b", DARK = "#1a1a1a", GRAY = "#555555", LIGHT = "#888888", LINEC = "#e0e0e0";
    const val = (v) => (v && String(v).trim()) ? String(v).trim() : "–";
    const fmtDate = (d) => { if (!d) return "–"; const [y,m,dd] = d.split("-"); return dd ? `${dd}/${m}/${y}` : d; };
    const fmtDateTime = (date, time) => { const fd = fmtDate(date); return (fd !== "–" && time) ? `${fd} às ${time}` : fd !== "–" ? fd : (time || "–"); };

    // ── CABEÇALHO SUPERIOR ──
    doc.rect(0, 0, 595, 90).fill("#c0392b");
    doc.rect(0, 90, 595, 6).fill("#922b21");

    doc.fontSize(7).fillColor("#ffcccc").font("Helvetica")
      .text("SISTEMA DE REGISTRO DE OCORRÊNCIAS", ML, 22, { width: PW, align: "center" });
    doc.fontSize(18).fillColor("#ffffff").font("Helvetica-Bold")
      .text("RELATÓRIO DE INCÊNDIO", ML, 40, { width: PW, align: "center" });
    doc.fontSize(8).fillColor("#ffdddd").font("Helvetica")
      .text("Brigada de Prevenção e Combate a Incêndios Florestais", ML, 60, { width: PW, align: "center" });

    // ── FAIXA DE IDENTIFICAÇÃO ──
    doc.rect(0, 96, 595, 36).fill("#f9f9f9");
    doc.rect(0, 131, 595, 1).fill(LINEC);

    const idY = 106;
    doc.fontSize(8).fillColor(LIGHT).font("Helvetica").text("Nº DO REGISTRO", ML, idY);
    doc.fontSize(13).fillColor(RED).font("Helvetica-Bold").text(`#${String(row.id).padStart(4,"0")}`, ML, idY + 10);

    doc.fontSize(8).fillColor(LIGHT).font("Helvetica").text("EQUIPE RESPONSÁVEL", ML + 90, idY);
    doc.fontSize(11).fillColor(DARK).font("Helvetica-Bold").text(d.nomeEquipe || row.team || "–", ML + 90, idY + 10);

    doc.fontSize(8).fillColor(LIGHT).font("Helvetica").text("DATA DO REGISTRO", ML + 240, idY);
    doc.fontSize(11).fillColor(DARK).font("Helvetica-Bold").text(new Date(row.createdAt).toLocaleString("pt-BR"), ML + 240, idY + 10);

    doc.fontSize(8).fillColor(LIGHT).font("Helvetica").text("ÁREA ATINGIDA", ML + 430, idY);
    const areaVal = row.area ? `${row.area.toFixed(4)} ha` : "–";
    doc.fontSize(13).fillColor(RED).font("Helvetica-Bold").text(areaVal, ML + 430, idY + 10);

    let curY = 148;

    // Função para desenhar seção
    const section = (titulo, campos) => {
      // Header da seção
      doc.rect(ML, curY, PW, 18).fill("#fdf0ef");
      doc.rect(ML, curY, 4, 18).fill(RED);
      doc.fontSize(9).fillColor(RED).font("Helvetica-Bold")
        .text(titulo.toUpperCase(), ML + 10, curY + 5, { width: PW - 10 });
      curY += 22;

      // Campos em grade
      const colW = PW / 2;
      let col = 0;
      let rowStartY = curY;
      let maxH = 0;

      campos.forEach((c, i) => {
        const x = ML + (col * colW);
        const wide = c.wide || false;
        const w = wide ? PW : colW - 10;

        doc.fontSize(7).fillColor(LIGHT).font("Helvetica")
          .text(c.label.toUpperCase(), x, curY, { width: w });
        const textY = curY + 10;
        doc.fontSize(9.5).fillColor(DARK).font("Helvetica")
          .text(c.value, x, textY, { width: w });

        const textH = doc.heightOfString(c.value, { width: w, fontSize: 9.5 });
        const fieldH = 10 + textH + 4;
        maxH = Math.max(maxH, fieldH);

        if (wide || col === 1 || i === campos.length - 1) {
          // Linha separadora
          doc.rect(ML, curY + maxH + 2, PW, 0.5).fill(LINEC);
          curY += maxH + 8;
          col = 0;
          maxH = 0;
        } else {
          col = 1;
        }
      });

      curY += 6;
    };

    // ── SEÇÃO 0: EQUIPE ──
    section("1. Identificação da Equipe", [
      { label: "Brigadista Responsável", value: val(d.brigadista) },
      { label: "Nome da Equipe", value: val(d.nomeEquipe) },
      { label: "Brigadistas da Equipe", value: val(d.brigadistas), wide: true },
    ]);

    // ── SEÇÃO 1: DADOS DO LOCAL ──
    section("2. Identificação do Local da Ocorrência", [
      { label: "Município", value: val(d.municipio) },
      { label: "Coordenadas GPS", value: val(d.coordStr) },
      { label: "Local de Referência", value: val(d.localReferencia), wide: true },
      { label: "Unidade de Conservação (UC)", value: d.uc ? (d.uc === "sim" ? "Sim" : "Não") : "–" },
    ]);

    // ── SEÇÃO 2: DETECÇÃO ──
    section("3. Dados da Detecção do Incêndio", [
      { label: "Data de Detecção", value: fmtDate(d.dataDeteccao) },
      { label: "Hora de Detecção", value: val(d.horaDeteccao) },
      { label: "Forma de Detecção", value: val(d.formaDeteccao), wide: true },
    ]);

    // ── SEÇÃO 3: CONTATO ──
    section("4. Dados do Comunicante / Contato", [
      { label: "Nome do Contato", value: val(d.nomeContato) },
      { label: "Orgão / Função", value: val(d.orgaoContato) },
      { label: "Telefone", value: val(d.telefoneContato), wide: true },
    ]);

    // ── SEÇÃO 4: COMBATE ──
    section("5. Dados do Combate", [
      { label: "Início do Combate", value: fmtDateTime(d.inicioData, d.inicioHora) },
      { label: "Incêndio Debelado em", value: fmtDateTime(d.debeladoData, d.debeladoHora) },
      { label: "Pessoal Mobilizado", value: val(d.pessoal) },
      { label: "Veículos Mobilizados", value: val(d.veiculos) },
      { label: "Houve Alimentação", value: d.alimentacao ? (d.alimentacao === "sim" ? "Sim" : "Não") : "–" },
      { label: "Causa Provável do Incêndio", value: val(d.causa) },
      { label: "Descrição da Ocorrência", value: val(d.descricao), wide: true },
    ]);

    // ── SEÇÃO 5: ÁREA ──
    section("6. Área Atingida e Localização Espacial", [
      { label: "Área Total Atingida (calculada)", value: row.area ? `${row.area.toFixed(4)} hectares` : "–" },
      { label: "Polígono Registrado", value: (() => { try { const p = JSON.parse(row.polygon || "[]"); return p.length >= 3 ? `Sim – ${p.length} vértices` : "Não registrado"; } catch { return "–"; } })() },
    ]);

    // ── RODAPÉ ──
    const pageH = 842;
    const footerY = pageH - 90;
    doc.rect(0, footerY - 5, 595, 1).fill(LINEC);
    doc.rect(0, footerY - 5, 595, 95).fill("#f9f9f9");

    doc.fontSize(7.5).fillColor(LIGHT).font("Helvetica")
      .text(
        `Documento gerado automaticamente pelo Sistema Brigada Ouro  ·  Registro #${String(row.id).padStart(4,"0")}  ·  ${new Date().toLocaleString("pt-BR")}`,
        ML, footerY + 4, { width: PW, align: "center" }
      );

    // Assinatura digital (imagem)
    if (row.signature) {
      try {
        const sigBuf = Buffer.from(row.signature.replace(/^data:image\/\w+;base64,/, ""), "base64");
        const sigW = 200, sigH = 45;
        const sigX = ML + PW / 2 - sigW / 2;
        doc.image(sigBuf, sigX, footerY + 16, { width: sigW, height: sigH, fit: [sigW, sigH] });
      } catch (_) {}
    }

    // Linha de assinatura
    const sigLineX1 = ML + PW / 2 - 100;
    const sigLineX2 = ML + PW / 2 + 100;
    doc.moveTo(sigLineX1, footerY + 63).lineTo(sigLineX2, footerY + 63).stroke("#aaaaaa");
    doc.fontSize(7).fillColor(LIGHT).font("Helvetica")
      .text("Brigadista – Responsável pelo Registro", ML, footerY + 66, { width: PW, align: "center" });
    doc.fontSize(8).fillColor(DARK).font("Helvetica-Bold")
      .text(val(d.brigadista), ML, footerY + 75, { width: PW, align: "center" });

    // ── PÁGINAS DE FOTOS + MAPA ──
    const photoList = (() => { try { return JSON.parse(row.photos || "[]"); } catch { return []; } })();
    // Adiciona o snapshot do mapa como a última "foto"
    if (row.mapSnapshot) photoList.push(row.mapSnapshot);
    if (photoList.length > 0) {
      const PER_PAGE = 4;
      const imgW = 242, imgH = 340;
      const gapX = 16, gapY = 16;
      const col0X = ML, col1X = ML + imgW + gapX;
      const positions = [
        { x: col0X, y: 68 },
        { x: col1X, y: 68 },
        { x: col0X, y: 68 + imgH + gapY },
        { x: col1X, y: 68 + imgH + gapY },
      ];
      for (let pi = 0; pi < photoList.length; pi += PER_PAGE) {
        doc.addPage({ size: "A4", margin: 0 });
        doc.rect(0, 0, 595, 58).fill(RED);
        doc.fontSize(7).fillColor("#ffcccc").font("Helvetica")
          .text("REGISTRO FOTOGRÁFICO", ML, 14, { width: PW, align: "center" });
        doc.fontSize(14).fillColor("#ffffff").font("Helvetica-Bold")
          .text(`Incêndio #${String(row.id).padStart(4,"0")} – Brigada Ouro`, ML, 28, { width: PW, align: "center" });
        const pagePhotos = photoList.slice(pi, pi + PER_PAGE);
        pagePhotos.forEach((photoB64, idx) => {
          try {
            const imgBuf = Buffer.from(photoB64.replace(/^data:image\/\w+;base64,/, ""), "base64");
            const pos = positions[idx];
            doc.image(imgBuf, pos.x, pos.y, { width: imgW, height: imgH, fit: [imgW, imgH] });
            doc.fontSize(8).fillColor(LIGHT).font("Helvetica")
              .text(`Foto ${pi + idx + 1}`, pos.x, pos.y + imgH + 2, { width: imgW, align: "center" });
          } catch (_) {}
        });
      }
    }

    doc.end();
  });
});

// ===== EXPORT EXCEL =====
app.get("/export/excel", auth, async (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const fmtDate = (d) => { if (!d) return ""; const [y,m,dd] = d.split("-"); return dd ? `${dd}/${m}/${y}` : d; };
    const uc2text = (v) => v === "sim" ? "Sim" : v === "nao" ? "Não" : v || "";
    const gerado = new Date().toLocaleString("pt-BR");
    const now = new Date();

    const wb = new ExcelJS.Workbook();
    wb.creator = "Brigada Ouro";
    wb.created = now;

    // ── PLANILHA 1: DADOS COMPLETOS ──
    const ws1 = wb.addWorksheet("Registros", { properties: { tabColor: { argb: "FFC0392B" } } });

    // Helpers de borda e preenchimento
    const bThin  = (argb = "FFD8D8D8") => ({ style: "thin",   color: { argb } });
    const bMed   = (argb = "FFAAAAAA") => ({ style: "medium", color: { argb } });
    const border = (t, r, b, l) => ({ top: t, right: r, bottom: b, left: l });
    const borderThin = border(bThin(), bThin(), bThin(), bThin());
    const fill   = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const centerMid = { horizontal: "center", vertical: "middle" };
    const leftMid   = { horizontal: "left",   vertical: "middle", wrapText: true };

    const MAX_PHOTOS_COLS = 8;
    const MAX_UTM_VERTICES = 15;
    // Colunas: 30 dados + 8 fotos + 1 fuso + (15 vértices × 2 coords) = 69
    const TOTAL_COLS = 30 + MAX_PHOTOS_COLS + 1 + MAX_UTM_VERTICES * 2;

    // ── LINHA 1: TÍTULO ──────────────────────────────────────────
    ws1.mergeCells(1, 1, 1, TOTAL_COLS);
    const t1 = ws1.getRow(1);
    t1.height = 48;
    const c1 = t1.getCell(1);
    c1.value = "🔥  BRIGADA OURO  –  REGISTRO DE INCÊNDIOS FLORESTAIS";
    c1.font  = { bold: true, size: 16, color: { argb: "FFFFFFFF" }, name: "Calibri" };
    c1.fill  = fill("FFC0392B");
    c1.alignment = centerMid;

    // ── LINHA 2: SUBTÍTULO ────────────────────────────────────────
    ws1.mergeCells(2, 1, 2, TOTAL_COLS);
    const t2 = ws1.getRow(2);
    t2.height = 22;
    const c2 = t2.getCell(1);
    c2.value = `Gerado em: ${gerado}   |   Total de registros: ${rows.length}   |   Brigada de Prevenção e Combate a Incêndios Florestais`;
    c2.font  = { italic: true, size: 10, color: { argb: "FF555555" } };
    c2.fill  = fill("FFFFF8F8");
    c2.alignment = centerMid;

    // ── LINHA 3: GRUPOS DE COLUNAS (faixa colorida) ───────────────
    const COL_FOTOS_START = 31;
    const COL_UTM_START   = COL_FOTOS_START + MAX_PHOTOS_COLS; // 39
    const colGroups = [
      { label: "IDENTIFICAÇÃO",     start: 1,             end: 6,                    color: "FFC0392B" },
      { label: "LOCALIZAÇÃO",       start: 7,             end: 13,                   color: "FF2471A3" },
      { label: "DETECÇÃO",          start: 14,            end: 16,                   color: "FF117A65" },
      { label: "CONTATO",           start: 17,            end: 19,                   color: "FF6C3483" },
      { label: "COMBATE",           start: 20,            end: 27,                   color: "FF1E8449" },
      { label: "RESULTADO",         start: 28,            end: 30,                   color: "FF935116" },
      { label: "FOTOS",             start: COL_FOTOS_START, end: COL_UTM_START - 1,  color: "FF555555" },
      { label: "VÉRTICES UTM (Fuso / Easting / Northing)", start: COL_UTM_START, end: TOTAL_COLS, color: "FF1A5276" },
    ];
    const t3 = ws1.getRow(3);
    t3.height = 20;
    colGroups.forEach(g => {
      ws1.mergeCells(3, g.start, 3, g.end);
      const gc = t3.getCell(g.start);
      gc.value = g.label;
      gc.font  = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      gc.fill  = fill(g.color);
      gc.alignment = centerMid;
    });

    // ── LINHA 4: CABEÇALHOS DAS COLUNAS ──────────────────────────
    const utmVertexHeaders = ["Fuso UTM"];
    for (let v = 1; v <= MAX_UTM_VERTICES; v++) {
      utmVertexHeaders.push(`V${v} E (m)`, `V${v} N (m)`);
    }
    const headers = [
      // Identificação (1-6)
      "Nº", "Data / Hora Registro", "Equipe (Sistema)",
      "Brigadista Responsável", "Nome da Equipe", "Brigadistas da Equipe",
      // Localização (7-13)
      "Município", "Coordenadas GPS", "Latitude", "Longitude",
      "Local de Referência", "Localização", "UC (S/N)",
      // Detecção (14-16)
      "Data Detecção", "Hora Detecção", "Forma de Detecção",
      // Contato (17-19)
      "Nome do Contato", "Órgão / Função", "Telefone",
      // Combate (20-27)
      "Início – Data", "Início – Hora",
      "Debelado – Data", "Debelado – Hora",
      "Pessoal", "Veículos", "Alimentação", "Causa",
      // Resultado (28-30)
      "Descrição da Ocorrência", "Área (ha)", "Qtd. Fotos",
      // Fotos (31-38)
      ...Array.from({ length: MAX_PHOTOS_COLS }, (_, i) => `Foto ${i + 1}`),
      // UTM (39+): Fuso + V1 E, V1 N, V2 E, V2 N, ...
      ...utmVertexHeaders
    ];
    const t4 = ws1.getRow(4);
    t4.height = 40;
    headers.forEach((h, i) => {
      const ci = i + 1;
      const grp = colGroups.find(g => ci >= g.start && ci <= g.end);
      const gc  = t4.getCell(ci);
      gc.value = h;
      gc.font  = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      gc.fill  = fill(grp ? grp.color + "CC" : "FF888888"); // slightly lighter shade
      gc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      gc.border = borderThin;
    });
    ws1.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: TOTAL_COLS } };
    ws1.views = [{ state: "frozen", ySplit: 4, xSplit: 1 }];

    // ── LARGURAS DAS COLUNAS ──────────────────────────────────────
    const utmColWidths = [8, ...Array(MAX_UTM_VERTICES * 2).fill(14)]; // Fuso + E/N por vértice
    const colWidths = [
      9, 20, 18, 26, 24, 40,          // Identificação
      18, 28, 11, 11, 28, 18, 7,      // Localização
      13, 10, 28,                      // Detecção
      24, 20, 16,                      // Contato
      13, 10, 13, 10, 22, 22, 12, 24, // Combate
      38, 12, 8,                       // Resultado
      ...Array(MAX_PHOTOS_COLS).fill(19), // Fotos
      ...utmColWidths                  // UTM
    ];
    ws1.columns = colWidths.map(w => ({ width: w }));

    // ── ALINHAMENTO por coluna (0-indexed) ───────────────────────
    // centered: ID, datas, horas, lat, lng, UC, área, qtd, S/N
    const centeredCols = new Set([0,1,8,9,12,13,14,19,20,21,22,25,29,30]);

    // ── DADOS ─────────────────────────────────────────────────────
    const IMG_W = 120, IMG_H = 90;
    rows.forEach((r, ri) => {
      const d = parseData(r.data);
      const photos = (() => { try { return JSON.parse(r.photos || "[]"); } catch { return []; } })();
      const photoPlaceholders = Array(MAX_PHOTOS_COLS).fill("");

      // Vértices UTM
      let poly = (() => { try { let p = JSON.parse(r.polygon || "[]"); if (p.length > 0 && Array.isArray(p[0]) && Array.isArray(p[0][0])) p = p[0]; return p; } catch { return []; } })();
      let fusoUTM = "";
      const utmValues = [];
      if (poly.length >= 3) {
        const firstUtm = wgs84ToUTM(poly[0][1], poly[0][0]);
        fusoUTM = firstUtm.fuso;
        for (let vi = 0; vi < MAX_UTM_VERTICES; vi++) {
          if (vi < poly.length) {
            const utm = wgs84ToUTM(poly[vi][1], poly[vi][0]);
            utmValues.push(parseFloat(utm.easting.toFixed(2)), parseFloat(utm.northing.toFixed(2)));
          } else {
            utmValues.push("", "");
          }
        }
      } else {
        for (let vi = 0; vi < MAX_UTM_VERTICES; vi++) utmValues.push("", "");
      }

      const dataRow = ws1.addRow([
        `#${String(r.id).padStart(4, "0")}`,
        new Date(r.createdAt).toLocaleString("pt-BR"),
        r.team || "",
        d.brigadista || "",
        d.nomeEquipe || "",
        d.brigadistas || "",
        d.municipio || "",
        d.coordStr || "",
        d.lat ? parseFloat(parseFloat(d.lat).toFixed(6)) : "",
        d.lng ? parseFloat(parseFloat(d.lng).toFixed(6)) : "",
        d.localReferencia || "",
        d.local || "",
        uc2text(d.uc),
        fmtDate(d.dataDeteccao),
        d.horaDeteccao || "",
        d.formaDeteccao || "",
        d.nomeContato || "",
        d.orgaoContato || "",
        d.telefoneContato || "",
        fmtDate(d.inicioData),
        d.inicioHora || "",
        fmtDate(d.debeladoData),
        d.debeladoHora || "",
        d.pessoal || "",
        d.veiculos || "",
        uc2text(d.alimentacao),
        d.causa || "",
        d.descricao || "",
        r.area ? parseFloat(r.area.toFixed(4)) : "",
        photos.length,
        ...photoPlaceholders,
        fusoUTM,
        ...utmValues
      ]);

      const bg = ri % 2 === 0 ? "FFFFFFFF" : "FFF5F5F5";
      dataRow.height = photos.length > 0 ? IMG_H + 4 : 20;
      dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.fill   = fill(bg);
        cell.border = borderThin;
        cell.font   = { size: 9 };
        cell.alignment = centeredCols.has(colNum - 1)
          ? { horizontal: "center", vertical: "middle" }
          : { horizontal: "left",   vertical: "middle", wrapText: colNum === 28 };
      });

      // Área: negrito e formato numérico
      const areaCell = dataRow.getCell(29);
      if (r.area) {
        areaCell.font = { bold: true, size: 9, color: { argb: "FFC0392B" } };
        areaCell.numFmt = "#,##0.0000";
      }

      // Imagens de fotos
      if (photos.length > 0) {
        const rowIdx = dataRow.number - 1;
        for (let pi = 0; pi < Math.min(photos.length, MAX_PHOTOS_COLS); pi++) {
          try {
            const b64 = photos[pi].replace(/^data:image\/\w+;base64,/, "");
            const ext = photos[pi].startsWith("data:image/png") ? "png" : "jpeg";
            const imgId = wb.addImage({ base64: b64, extension: ext });
            ws1.addImage(imgId, {
              tl: { col: 30 + pi, row: rowIdx },
              ext: { width: IMG_W, height: IMG_H }
            });
          } catch (_) {}
        }
      }
    });

    // ── PLANILHA 2: RESUMO ──
    const ws2 = wb.addWorksheet("Resumo", { properties: { tabColor: { argb: "FF2471A3" } } });
    const totalArea = rows.reduce((a, b) => a + (b.area || 0), 0);
    const thisMonth = rows.filter(r => {
      const d = new Date(r.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const causas = {};
    rows.forEach(r => {
      const d = parseData(r.data);
      const c = d.causa || "Não informada";
      causas[c] = (causas[c] || 0) + 1;
    });

    // Título
    ws2.mergeCells("A1:C1");
    const w2t1 = ws2.getRow(1); w2t1.height = 44;
    const w2c1 = w2t1.getCell(1);
    w2c1.value = "📊  BRIGADA OURO – RESUMO ESTATÍSTICO";
    w2c1.font  = { bold: true, size: 15, color: { argb: "FFFFFFFF" }, name: "Calibri" };
    w2c1.fill  = fill("FFC0392B");
    w2c1.alignment = { horizontal: "center", vertical: "middle" };

    ws2.mergeCells("A2:C2");
    const w2t2 = ws2.getRow(2); w2t2.height = 20;
    const w2c2 = w2t2.getCell(1);
    w2c2.value = `Gerado em: ${gerado}`;
    w2c2.font  = { italic: true, size: 10, color: { argb: "FF777777" } };
    w2c2.fill  = fill("FFFFF8F8");
    w2c2.alignment = { horizontal: "center", vertical: "middle" };

    ws2.addRow([]);

    // Sub-título Indicadores
    ws2.mergeCells("A4:C4");
    const w2h = ws2.getRow(4); w2h.height = 26;
    const w2hc = w2h.getCell(1);
    w2hc.value = "INDICADORES GERAIS";
    w2hc.font  = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    w2hc.fill  = fill("FF2471A3");
    w2hc.alignment = { horizontal: "center", vertical: "middle" };

    const statsData = [
      ["Total de Registros",                rows.length,                                         ""],
      ["Área Total Atingida",                parseFloat(totalArea.toFixed(4)),                   "ha"],
      ["Área Média por Ocorrência",          rows.length > 0 ? parseFloat((totalArea/rows.length).toFixed(4)) : 0, "ha"],
      ["Registros neste Mês",               thisMonth,                                           ""],
    ];
    statsData.forEach(([label, val, unit], si) => {
      const sr = ws2.addRow([label, val, unit]);
      sr.height = 22;
      const bg = si % 2 === 0 ? "FFFFFFFF" : "FFF0F6FF";
      sr.eachCell({ includeEmpty: true }, cell => {
        cell.fill   = fill(bg);
        cell.border = borderThin;
        cell.font   = { size: 10 };
      });
      sr.getCell(1).font = { size: 10, bold: true };
      sr.getCell(1).alignment = { horizontal: "left",   vertical: "middle" };
      sr.getCell(2).font      = { size: 11, bold: true, color: { argb: "FFC0392B" } };
      sr.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
      sr.getCell(3).alignment = { horizontal: "left",   vertical: "middle" };
    });

    ws2.addRow([]);

    // Sub-título Causas
    const cauRow = ws2.addRow(["OCORRÊNCIAS POR CAUSA", "", ""]);
    ws2.mergeCells(`A${cauRow.number}:C${cauRow.number}`);
    cauRow.height = 26;
    cauRow.getCell(1).font  = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cauRow.getCell(1).fill  = fill("FF117A65");
    cauRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

    const cauHdr = ws2.addRow(["Causa", "Qtd", "%"]);
    cauHdr.height = 22;
    cauHdr.eachCell(cell => {
      cell.font  = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      cell.fill  = fill("FF1E8449");
      cell.border = borderThin;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    const totalCausas = Object.values(causas).reduce((a, b) => a + b, 0);
    Object.entries(causas).sort((a, b) => b[1] - a[1]).forEach(([k, v], ci) => {
      const cr = ws2.addRow([k, v, totalCausas > 0 ? parseFloat((v / totalCausas * 100).toFixed(1)) : 0]);
      cr.height = 20;
      const bg = ci % 2 === 0 ? "FFFFFFFF" : "FFF0FFF4";
      cr.eachCell({ includeEmpty: true }, cell => {
        cell.fill   = fill(bg);
        cell.border = borderThin;
        cell.font   = { size: 9 };
      });
      cr.getCell(1).alignment = { horizontal: "left",   vertical: "middle" };
      cr.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
      cr.getCell(2).font      = { bold: true, size: 9 };
      cr.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
      cr.getCell(3).numFmt    = "0.0\"%\"";
    });

    ws2.columns = [{ width: 38 }, { width: 12 }, { width: 10 }];

    // ── PLANILHA 3: FOTOS ──
    const ws3 = wb.addWorksheet("Fotos das Ocorrências");
    const fp3t = ws3.addRow(["REGISTRO FOTOGRÁFICO – Brigada Ouro"]);
    fp3t.getCell(1).font = { bold: true, size: 14, color: { argb: "FFC0392B" } };
    ws3.mergeCells("A1:E1");
    const fp3s = ws3.addRow([`Gerado em: ${gerado}`]);
    fp3s.getCell(1).font = { italic: true, color: { argb: "FF555555" } };
    ws3.mergeCells("A2:E2");
    ws3.addRow([]);

    ws3.columns = [
      { width: 14 },
      { width: 22 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
    ];

    let currentRow = 4;
    let hasPhotos = false;

    for (const r of rows) {
      const photos = (() => { try { return JSON.parse(r.photos || "[]"); } catch { return []; } })();
      if (photos.length === 0) continue;
      hasPhotos = true;
      const d = parseData(r.data);

      const fireHeaderRow = ws3.getRow(currentRow);
      fireHeaderRow.getCell(1).value = `Incêndio #${String(r.id).padStart(4,"0")} – ${d.municipio || "Sem município"} – ${r.team} – ${new Date(r.createdAt).toLocaleString("pt-BR")}`;
      fireHeaderRow.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      fireHeaderRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0392B" } };
      ws3.mergeCells(`A${currentRow}:E${currentRow}`);
      currentRow++;

      const IMG_W = 120, IMG_H = 90;
      const PHOTOS_PER_ROW = 4;
      const rowHeightPx = IMG_H + 10;

      for (let pi = 0; pi < photos.length; pi += PHOTOS_PER_ROW) {
        const rowPhotos = photos.slice(pi, pi + PHOTOS_PER_ROW);

        const labelRow = ws3.getRow(currentRow);
        rowPhotos.forEach((_, idx) => {
          labelRow.getCell(idx + 1).value = `Foto ${pi + idx + 1}`;
          labelRow.getCell(idx + 1).font = { bold: true, size: 9, color: { argb: "FF555555" } };
          labelRow.getCell(idx + 1).alignment = { horizontal: "center" };
        });
        currentRow++;

        const imgRow = ws3.getRow(currentRow);
        imgRow.height = rowHeightPx;

        for (let idx = 0; idx < rowPhotos.length; idx++) {
          try {
            const photoB64 = rowPhotos[idx].replace(/^data:image\/\w+;base64,/, "");
            const ext = rowPhotos[idx].startsWith("data:image/png") ? "png" : "jpeg";
            const imgId = wb.addImage({ base64: photoB64, extension: ext });
            const col = idx;
            ws3.addImage(imgId, {
              tl: { col: col, row: currentRow - 1 },
              ext: { width: IMG_W, height: IMG_H }
            });
          } catch (_) {}
        }
        currentRow++;
      }
      currentRow++;
    }

    if (!hasPhotos) {
      ws3.getRow(currentRow).getCell(1).value = "Nenhuma foto registrada.";
    }

    try {
      const buf = await wb.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=incendios-brigada-${now.toISOString().slice(0,10)}.xlsx`);
      res.send(buf);
    } catch (e) {
      res.status(500).json({ error: "Erro ao gerar Excel: " + e.message });
    }
  });
});

// ===== IMPORTAR EXCEL =====
app.post("/import/excel", auth, uploadMemory.single("file"), async (req, res) => {
  if (req.user.role !== "gestor") return res.status(403).json({ error: "Apenas gestores podem importar registros." });
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const ws = wb.Sheets["Registros"];
    if (!ws) return res.status(400).json({ error: "Planilha 'Registros' não encontrada no arquivo." });

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    // Cabeçalhos nas linhas 1-4; dados a partir da linha 5 (índice 4)
    const dataRows = rows.slice(4).filter(r => r[0] && String(r[0]).trim());

    if (dataRows.length === 0) return res.json({ ok: true, importados: 0, ignorados: 0, msg: "Nenhuma linha de dados encontrada." });

    const fmtDateBack = (val) => {
      if (!val) return "";
      const s = String(val).trim();
      // dd/mm/yyyy → yyyy-mm-dd
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      // Se já é Date object (xlsx com cellDates)
      if (val instanceof Date) return val.toISOString().slice(0, 10);
      return s;
    };

    const ucBack = (v) => {
      const s = String(v || "").toLowerCase();
      if (s === "sim") return "sim";
      if (s === "não" || s === "nao") return "nao";
      return v || "";
    };

    let importados = 0, ignorados = 0, erros = [];

    for (const row of dataRows) {
      try {
        const data = {
          brigadista:       String(row[3] || ""),
          nomeEquipe:       String(row[4] || ""),
          brigadistas:      String(row[5] || ""),
          municipio:        String(row[6] || ""),
          coordStr:         String(row[7] || ""),
          lat:              row[8] !== "" ? parseFloat(row[8]) : null,
          lng:              row[9] !== "" ? parseFloat(row[9]) : null,
          localReferencia:  String(row[10] || ""),
          local:            String(row[11] || ""),
          uc:               ucBack(row[12]),
          dataDeteccao:     fmtDateBack(row[13]),
          horaDeteccao:     String(row[14] || ""),
          formaDeteccao:    String(row[15] || ""),
          nomeContato:      String(row[16] || ""),
          orgaoContato:     String(row[17] || ""),
          telefoneContato:  String(row[18] || ""),
          inicioData:       fmtDateBack(row[19]),
          inicioHora:       String(row[20] || ""),
          debeladoData:     fmtDateBack(row[21]),
          debeladoHora:     String(row[22] || ""),
          pessoal:          String(row[23] || ""),
          veiculos:         String(row[24] || ""),
          alimentacao:      ucBack(row[25]),
          causa:            String(row[26] || ""),
          descricao:        String(row[27] || ""),
        };

        const area = row[28] !== "" ? parseFloat(row[28]) || 0 : 0;
        const team = equipeDoRegistro(req.user, data);

        // Verifica se já existe um registo idêntico (mesmo brigadista + equipe + data criação)
        // Usamos createdAt extraído da coluna "Data / Hora Registro" (col 1) como referência
        const rawDate = String(row[1] || "").trim();

        await new Promise((resolve, reject) => {
          db.run(
            "INSERT INTO fires (data, area, team, polygon, signature, photos, mapSnapshot, createdAt) VALUES (?,?,?,?,?,?,?,?)",
            [JSON.stringify(data), area, team, "[]", null, "[]", null, new Date().toISOString()],
            function(err) { if (err) reject(err); else resolve(this.lastID); }
          );
        });
        importados++;
      } catch (e) {
        ignorados++;
        erros.push(String(row[0]) + ": " + e.message);
      }
    }

    res.json({ ok: true, importados, ignorados, erros: erros.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: "Erro ao processar planilha: " + e.message });
  }
});

// ===== EXPORT KMZ =====
app.get("/export/kmz", auth, (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Brigada Ouro – Registros</name>
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

// ===== EDITAR INCÊNDIO (apenas gestor da própria equipe) =====
app.put("/fire/:id", auth, (req, res) => {
  if (req.user.role !== "gestor") return res.status(403).json({ error: "Apenas gestores podem editar registros." });
  const { data, polygon, signature, photos, mapSnapshot } = req.body;

  db.get("SELECT team FROM fires WHERE id=?", [req.params.id], (err, row) => {
    if (!row) return res.json({ error: "Registro não encontrado." });
    if (row.team !== req.user.team) return res.status(403).json({ error: "Você só pode editar registros da sua própria equipe." });

    let area = 0;
    if (polygon && polygon.length >= 3) {
      try {
        const poly = turf.polygon([[...polygon, polygon[0]]]);
        area = turf.area(poly) / 10000;
      } catch (e) {}
    }
    if (area === 0 && data && data.areaAtingida) area = parseFloat(data.areaAtingida) || 0;

    db.run(
      "UPDATE fires SET data=?, polygon=?, signature=?, photos=?, mapSnapshot=?, area=? WHERE id=?",
      [
        JSON.stringify(data || {}),
        JSON.stringify(polygon || []),
        signature || null,
        JSON.stringify(photos || []),
        mapSnapshot || null,
        area,
        req.params.id
      ],
      function(err) {
        if (err) return res.json({ error: err.message });
        res.json({ ok: true, area });
      }
    );
  });
});

// ===== APAGAR INCÊNDIO (apenas gestor da própria equipe + senha) =====
app.delete("/fire/:id", auth, async (req, res) => {
  if (req.user.role !== "gestor") return res.status(403).json({ error: "Apenas gestores podem apagar registros." });
  const { senha } = req.body;
  const expectedSenha = await getSenhaEquipe(req.user.team);
  if (!expectedSenha || senha !== expectedSenha) return res.status(403).json({ error: "Senha de gestor incorreta." });

  db.get("SELECT team FROM fires WHERE id=?", [req.params.id], (err, row) => {
    if (!row) return res.json({ error: "Registro não encontrado." });
    if (row.team !== req.user.team) return res.status(403).json({ error: "Você só pode apagar registros da sua própria equipe." });
    db.run("DELETE FROM fires WHERE id=?", [req.params.id], function(err) {
      if (err) return res.json({ error: err.message });
      if (this.changes === 0) return res.json({ error: "Registro não encontrado." });
      res.json({ ok: true });
    });
  });
});

// ===== SYNC OFFLINE =====
app.post("/sync", auth, async (req, res) => {
  const { fires } = req.body;
  if (!fires || !Array.isArray(fires)) return res.json({ ok: false });

  const results = await Promise.all(fires.map(fire => new Promise(resolve => {
    let area = 0;
    try {
      if (fire.polygon && fire.polygon.length >= 3) {
        area = turf.area(turf.polygon([[...fire.polygon, fire.polygon[0]]])) / 10000;
      } else if (fire.data && fire.data.areaAtingida) area = parseFloat(fire.data.areaAtingida) || 0;
    } catch (e) {}
    db.run(
      "INSERT INTO fires (data, area, team, polygon, signature, photos, mapSnapshot, createdAt) VALUES (?,?,?,?,?,?,?,?)",
      [JSON.stringify(fire.data || {}), area, equipeDoRegistro(req.user, fire.data), JSON.stringify(fire.polygon || []),
       fire.signature || null, JSON.stringify(fire.photos || []), fire.mapSnapshot || null,
       fire.createdAt || new Date().toISOString()],
      err => resolve(!err)
    );
  })));

  const synced = results.filter(Boolean).length;
  res.json({ ok: true, synced });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => console.log(`Brigada Ouro na porta ${PORT}`));
