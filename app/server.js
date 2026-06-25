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
    doc.fontSize(11).fillColor(DARK).font("Helvetica-Bold").text(row.team || "–", ML + 90, idY + 10);

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
    const footerY = pageH - 55;
    doc.rect(0, footerY - 5, 595, 1).fill(LINEC);
    doc.rect(0, footerY - 5, 595, 60).fill("#f9f9f9");

    doc.fontSize(7.5).fillColor(LIGHT).font("Helvetica")
      .text(
        `Documento gerado automaticamente pelo Sistema Brigada Ouro  ·  Registro #${String(row.id).padStart(4,"0")}  ·  ${new Date().toLocaleString("pt-BR")}`,
        ML, footerY + 4, { width: PW, align: "center" }
      );

    // Linha de assinatura
    doc.moveTo(ML + 40, footerY + 28).lineTo(ML + 200, footerY + 28).stroke("#aaaaaa");
    doc.moveTo(ML + 260, footerY + 28).lineTo(ML + 460, footerY + 28).stroke("#aaaaaa");
    doc.fontSize(7).fillColor(LIGHT).font("Helvetica")
      .text("Responsável pela Brigada", ML + 40, footerY + 31, { width: 160, align: "center" });
    doc.fontSize(7).fillColor(LIGHT).font("Helvetica")
      .text("Fiscal / Supervisor", ML + 260, footerY + 31, { width: 200, align: "center" });

    doc.end();
  });
});

// ===== EXPORT EXCEL =====
app.get("/export/excel", auth, (req, res) => {
  db.all("SELECT * FROM fires ORDER BY createdAt DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const fmtDate = (d) => { if (!d) return ""; const [y,m,dd] = d.split("-"); return dd ? `${dd}/${m}/${y}` : d; };
    const uc2text = (v) => v === "sim" ? "Sim" : v === "nao" ? "Não" : v || "";
    const gerado = new Date().toLocaleString("pt-BR");

    // ── PLANILHA 1: DADOS COMPLETOS ──
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
      "Descrição da Ocorrência", "Área Atingida (ha)"
    ];

    const dataRows = rows.map(r => {
      const d = parseData(r.data);
      return [
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
        r.area ? parseFloat(r.area.toFixed(4)) : ""
      ];
    });

    // Monta sheet com linha de título + cabeçalho + dados
    const sheetData = [
      [`RELATÓRIO DE INCÊNDIOS FLORESTAIS – Brigada Ouro`],
      [`Gerado em: ${gerado}   |   Total de registros: ${rows.length}`],
      [],
      headers,
      ...dataRows
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Larguras das colunas
    const colWidths = [
      12, 22, 20,
      28, 25, 50,
      20, 30, 12, 12,
      30, 22, 8,
      14, 12, 30,
      25, 22, 16,
      18, 14,
      18, 14,
      30, 30,
      16, 25,
      50, 14
    ];
    ws["!cols"] = colWidths.map(w => ({ wch: w }));

    // Mescla célula do título (linha 0, colunas 0 até 25)
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } }
    ];

    // Congela a linha de cabeçalho (linha 4 = índice 3 após as 3 linhas de título)
    ws["!freeze"] = { xSplit: 0, ySplit: 4 };

    // ── PLANILHA 2: RESUMO ──
    const totalArea = rows.reduce((a, b) => a + (b.area || 0), 0);
    const now = new Date();
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

    const resumoData = [
      ["RESUMO ESTATÍSTICO"],
      [`Gerado em: ${gerado}`],
      [],
      ["INDICADOR", "VALOR"],
      ["Total de registros", rows.length],
      ["Área total atingida (ha)", parseFloat(totalArea.toFixed(4))],
      ["Área média por ocorrência (ha)", rows.length > 0 ? parseFloat((totalArea / rows.length).toFixed(4)) : 0],
      ["Registros neste mês", thisMonth],
      [],
      ["OCORRÊNCIAS POR CAUSA"],
      ["Causa", "Quantidade"],
      ...Object.entries(causas).map(([k, v]) => [k, v])
    ];

    const ws2 = XLSX.utils.aoa_to_sheet(resumoData);
    ws2["!cols"] = [{ wch: 40 }, { wch: 20 }];
    ws2["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
      { s: { r: 9, c: 0 }, e: { r: 9, c: 1 } }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registros Completos");
    XLSX.utils.book_append_sheet(wb, ws2, "Resumo Estatístico");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=incendios-brigada-${now.toISOString().slice(0,10)}.xlsx`);
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
