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
  try {
    let p = JSON.parse(raw || "[]");
    if (p.length > 0 && Array.isArray(p[0]) && Array.isArray(p[0][0])) p = p[0];
    return p;
  } catch { return []; }
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
  const { data, polygon, signature, photos, mapSnapshot } = req.body;
  let area = 0;
  if (polygon && polygon.length >= 3) {
    try {
      const poly = turf.polygon([[...polygon, polygon[0]]]);
      area = turf.area(poly) / 10000;
    } catch (e) { return res.json({ error: "Erro na área: " + e.message }); }
  }
  if (area === 0 && data && data.areaAtingida) area = parseFloat(data.areaAtingida) || 0;

  db.run(
    "INSERT INTO fires (data, area, team, polygon, signature, photos, mapSnapshot, createdAt) VALUES (?,?,?,?,?,?,?,?)",
    [JSON.stringify(data || {}), area, req.user.team, JSON.stringify(polygon || []), signature || null, JSON.stringify(photos || []), mapSnapshot || null, new Date().toISOString()],
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
      .text("RELATÓRIO DE INCÊNDIO FLORESTAL", ML, 34, { width: PW, align: "center" });
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
      { label: "Localização (Entorno/Interno)", value: val(d.local) },
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

    // ── PÁGINA DO MAPA (snapshot) ──
    if (row.mapSnapshot) {
      try {
        const snapBuf = Buffer.from(row.mapSnapshot.replace(/^data:image\/\w+;base64,/, ""), "base64");
        doc.addPage({ size: "A4", margin: 0 });
        doc.rect(0, 0, 595, 58).fill(RED);
        doc.fontSize(7).fillColor("#ffcccc").font("Helvetica")
          .text("MAPA DA ÁREA QUEIMADA", ML, 14, { width: PW, align: "center" });
        doc.fontSize(14).fillColor("#ffffff").font("Helvetica-Bold")
          .text(`Incêndio #${String(row.id).padStart(4,"0")} – Brigada Ouro`, ML, 28, { width: PW, align: "center" });
        const mW = 500, mH = 375;
        const mX = ML + (PW - mW) / 2;
        doc.image(snapBuf, mX, 75, { width: mW, height: mH, fit: [mW, mH] });
        const areaText = row.area ? `Área: ${row.area.toFixed(4)} ha` : "";
        const munText = d.municipio ? `Município: ${d.municipio}` : "";
        doc.fontSize(10).fillColor(DARK).font("Helvetica-Bold")
          .text([areaText, munText].filter(Boolean).join("   •   "), ML, 75 + mH + 12, { width: PW, align: "center" });
      } catch (_) {}
    }

    // ── PÁGINAS DE FOTOS ──
    const photoList = (() => { try { return JSON.parse(row.photos || "[]"); } catch { return []; } })();
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
    const ws1 = wb.addWorksheet("Registros Completos");

    const titleRow = ws1.addRow(["RELATÓRIO DE INCÊNDIOS FLORESTAIS – Brigada Ouro"]);
    titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: "FFC0392B" } };
    ws1.mergeCells("A1:AD1");

    const subRow = ws1.addRow([`Gerado em: ${gerado}   |   Total de registros: ${rows.length}`]);
    subRow.getCell(1).font = { italic: true, size: 10, color: { argb: "FF555555" } };
    ws1.mergeCells("A2:AD2");

    ws1.addRow([]);

    const MAX_PHOTOS_COLS = 8;
    const headers = [
      "Nº Registro", "Data/Hora Registro", "Equipe",
      "Brigadista Responsável", "Nome da Equipe", "Brigadistas da Equipe",
      "Município", "Coordenadas GPS", "Latitude", "Longitude",
      "Local de Referência", "Localização (Entorno/Interno)", "UC (S/N)",
      "Data Detecção", "Hora Detecção", "Forma de Detecção",
      "Nome do Contato", "Orgão / Função", "Telefone",
      "Início Combate – Data", "Início Combate – Hora",
      "Incêndio Debelado – Data", "Debelado – Hora",
      "Pessoal Mobilizado", "Veículos Mobilizados",
      "Houve Alimentação", "Causa do Incêndio",
      "Descrição da Ocorrência", "Área Atingida (ha)", "Qtd. Fotos",
      ...Array.from({ length: MAX_PHOTOS_COLS }, (_, i) => `Foto ${i + 1}`)
    ];
    const thinBorder = { style: "thin", color: { argb: "FFD0D0D0" } };
    const borderAll = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

    const headerRow = ws1.addRow(headers);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0392B" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = borderAll;
    });
    ws1.views = [{ state: "frozen", ySplit: 4 }];

    const colWidths = [
      12, 22, 20, 28, 25, 50, 20, 30, 12, 12,
      30, 22, 8, 14, 12, 30, 25, 22, 16, 18,
      14, 18, 14, 30, 30, 16, 25, 50, 14, 8,
      ...Array(MAX_PHOTOS_COLS).fill(16)
    ];
    ws1.columns = headers.map((h, i) => ({ width: colWidths[i] || 15 }));

    const IMG_W = 110, IMG_H = 82;
    rows.forEach((r, ri) => {
      const d = parseData(r.data);
      const photos = (() => { try { return JSON.parse(r.photos || "[]"); } catch { return []; } })();
      const photoPlaceholders = Array(MAX_PHOTOS_COLS).fill("");
      const dataRow = ws1.addRow([
        `#${String(r.id).padStart(4, "0")}`,
        new Date(r.createdAt).toLocaleString("pt-BR"),
        r.team || "",
        d.brigadista || "",
        d.nomeEquipe || "",
        d.brigadistas || "",
        d.municipio || "",
        d.coordStr || "",
        d.lat ? parseFloat(d.lat) : "",
        d.lng ? parseFloat(d.lng) : "",
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
        ...photoPlaceholders
      ]);
      const bgColor = ri % 2 === 0 ? "FFFFF5F5" : "FFFFFFFF";
      dataRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        cell.border = borderAll;
      });

      // Imagens nas colunas de foto (30-37, 0-indexed)
      if (photos.length > 0) {
        dataRow.height = IMG_H + 4;
        const rowIdx = dataRow.number - 1; // 0-indexed for addImage
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
    const ws2 = wb.addWorksheet("Resumo Estatístico");
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

    const r2t = ws2.addRow(["RESUMO ESTATÍSTICO"]);
    r2t.getCell(1).font = { bold: true, size: 14, color: { argb: "FFC0392B" } };
    ws2.mergeCells("A1:B1");
    const r2s = ws2.addRow([`Gerado em: ${gerado}`]);
    r2s.getCell(1).font = { italic: true, color: { argb: "FF555555" } };
    ws2.mergeCells("A2:B2");
    ws2.addRow([]);
    const r2h = ws2.addRow(["INDICADOR", "VALOR"]);
    r2h.eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC0392B" } }; });
    ws2.addRow(["Total de registros", rows.length]);
    ws2.addRow(["Área total atingida (ha)", parseFloat(totalArea.toFixed(4))]);
    ws2.addRow(["Área média por ocorrência (ha)", rows.length > 0 ? parseFloat((totalArea / rows.length).toFixed(4)) : 0]);
    ws2.addRow(["Registros neste mês", thisMonth]);
    ws2.addRow([]);
    const r2c = ws2.addRow(["OCORRÊNCIAS POR CAUSA"]);
    r2c.getCell(1).font = { bold: true };
    ws2.mergeCells(`A${r2c.number}:B${r2c.number}`);
    const r2ch = ws2.addRow(["Causa", "Quantidade"]);
    r2ch.eachCell(c => { c.font = { bold: true }; });
    Object.entries(causas).forEach(([k, v]) => ws2.addRow([k, v]));
    ws2.columns = [{ width: 40 }, { width: 20 }];

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
app.listen(PORT, "0.0.0.0", () => console.log(`Brigada Ouro na porta ${PORT}`));
