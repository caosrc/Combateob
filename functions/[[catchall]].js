// Cloudflare Pages Function – Brigada Ouro
// Substitui o Express + SQLite pelo Cloudflare D1 + Pages Functions

import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
import { strToU8, zipSync } from "fflate";
import * as turf from "@turf/turf";

// ─── Helpers ───────────────────────────────────────────────────────────────────
const parseData = (raw) => { try { return JSON.parse(raw || "{}"); } catch { return {}; } };
const parsePoly = (raw) => {
  try {
    let p = JSON.parse(raw || "[]");
    if (p.length > 0 && Array.isArray(p[0]) && Array.isArray(p[0][0])) p = p[0];
    return p;
  } catch { return []; }
};
const val = (v) => (v && String(v).trim()) ? String(v).trim() : "–";
const fmtDate = (d) => { if (!d) return "–"; const [y, m, dd] = d.split("-"); return dd ? `${dd}/${m}/${y}` : d; };
const fmtDateTime = (date, time) => { const fd = fmtDate(date); return (fd !== "–" && time) ? `${fd} às ${time}` : fd !== "–" ? fd : (time || "–"); };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

// ─── JWT ───────────────────────────────────────────────────────────────────────
async function signJWT(payload, secret) {
  const key = new TextEncoder().encode(secret);
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(key);
}
async function verifyJWT(token, secret) {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return payload;
}
async function getAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const url = new URL(request.url);
  const token = header.replace("Bearer ", "") || url.searchParams.get("token") || "";
  if (!token) return null;
  try { return await verifyJWT(token, env.JWT_SECRET || "incendio_secret_key_v3"); }
  catch { return null; }
}

// ─── Init DB ──────────────────────────────────────────────────────────────────
async function initDB(DB) {
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, team TEXT NOT NULL)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS fires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL DEFAULT '{}', area REAL DEFAULT 0, team TEXT,
      polygon TEXT DEFAULT '[]', photos TEXT DEFAULT '[]',
      signature TEXT, createdAt TEXT NOT NULL)`)
  ]);
  const row = await DB.prepare("SELECT COUNT(*) as c FROM users").first();
  if (!row || row.c === 0) {
    const ah = bcrypt.hashSync("admin123", 10);
    const bh = bcrypt.hashSync("brigada123", 10);
    await DB.batch([
      DB.prepare("INSERT OR IGNORE INTO users (username,password,team) VALUES (?,?,?)").bind("admin", ah, "Equipe Alpha"),
      DB.prepare("INSERT OR IGNORE INTO users (username,password,team) VALUES (?,?,?)").bind("brigada1", bh, "Equipe Beta")
    ]);
  }
}

// ─── PDF com pdf-lib ──────────────────────────────────────────────────────────
async function gerarPDF(row) {
  const pdfDoc = await PDFDocument.create();
  const hel = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const A4W = 595.28, A4H = 841.89;
  const ML = 45, MR = 45, PW = A4W - ML - MR;

  const RED   = rgb(0.753, 0.227, 0.169);
  const DRED  = rgb(0.573, 0.169, 0.129);
  const DARK  = rgb(0.102, 0.102, 0.102);
  const LIGHT = rgb(0.533, 0.533, 0.533);
  const LINE  = rgb(0.878, 0.878, 0.878);
  const WHITE = rgb(1, 1, 1);
  const BGLT  = rgb(0.976, 0.976, 0.976);
  const SECBG = rgb(0.992, 0.941, 0.937);
  const PINK  = rgb(1, 0.8, 0.8);
  const LPINK = rgb(1, 0.867, 0.867);

  const d = parseData(row.data);

  // ── Página 1 ──
  let page = pdfDoc.addPage([A4W, A4H]);

  // Cabeçalho vermelho
  page.drawRectangle({ x: 0, y: A4H - 90, width: A4W, height: 90, color: RED });
  page.drawRectangle({ x: 0, y: A4H - 96, width: A4W, height: 6, color: DRED });

  const t1 = "SISTEMA DE REGISTRO DE OCORRÊNCIAS";
  page.drawText(t1, { x: A4W / 2 - hel.widthOfTextAtSize(t1, 7) / 2, y: A4H - 22, size: 7, font: hel, color: PINK });
  const t2 = "RELATÓRIO DE INCÊNDIO FLORESTAL";
  page.drawText(t2, { x: A4W / 2 - helB.widthOfTextAtSize(t2, 16) / 2, y: A4H - 50, size: 16, font: helB, color: WHITE });
  const t3 = "Brigada de Prevenção e Combate a Incêndios Florestais";
  page.drawText(t3, { x: A4W / 2 - hel.widthOfTextAtSize(t3, 8) / 2, y: A4H - 68, size: 8, font: hel, color: LPINK });

  // Faixa de identificação
  page.drawRectangle({ x: 0, y: A4H - 132, width: A4W, height: 36, color: BGLT });
  page.drawRectangle({ x: 0, y: A4H - 132, width: A4W, height: 0.5, color: LINE });
  page.drawRectangle({ x: 0, y: A4H - 132 - 0.5, width: A4W, height: 0.5, color: LINE });

  const areaVal = row.area ? `${row.area.toFixed(4)} ha` : "–";
  const idY = A4H - 106;

  page.drawText("Nº DO REGISTRO",       { x: ML,       y: idY + 8, size: 7, font: hel,  color: LIGHT });
  page.drawText(`#${String(row.id).padStart(4,"0")}`, { x: ML, y: idY - 5, size: 13, font: helB, color: RED });

  page.drawText("EQUIPE RESPONSÁVEL",   { x: ML + 90,  y: idY + 8, size: 7, font: hel,  color: LIGHT });
  page.drawText(d.nomeEquipe || row.team || "–", { x: ML + 90, y: idY - 4, size: 9, font: helB, color: DARK });

  page.drawText("DATA DO REGISTRO",     { x: ML + 240, y: idY + 8, size: 7, font: hel,  color: LIGHT });
  page.drawText(new Date(row.createdAt).toLocaleString("pt-BR"), { x: ML + 240, y: idY - 4, size: 8, font: helB, color: DARK });

  page.drawText("ÁREA ATINGIDA",        { x: ML + 430, y: idY + 8, size: 7, font: hel,  color: LIGHT });
  page.drawText(areaVal,                { x: ML + 430, y: idY - 4, size: 11, font: helB, color: RED });

  // ── Seções ──
  let curY = 148; // top-based

  const drawLine = (topY) => {
    page.drawRectangle({ x: ML, y: A4H - topY, width: PW, height: 0.5, color: LINE });
  };

  const wrapText = (text, maxW, font, size) => {
    const words = String(text).split(" ");
    const lines = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW) { if (cur) lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : ["–"];
  };

  const section = (titulo, campos) => {
    // Cabeçalho da seção
    page.drawRectangle({ x: ML, y: A4H - curY - 18, width: PW, height: 18, color: SECBG });
    page.drawRectangle({ x: ML, y: A4H - curY - 18, width: 4,  height: 18, color: RED });
    page.drawText(titulo.toUpperCase(), { x: ML + 10, y: A4H - curY - 13, size: 9, font: helB, color: RED });
    curY += 22;

    const colW = PW / 2;
    let col = 0;
    let rowStartH = 0;

    campos.forEach((c, i) => {
      const wide = c.wide || false;
      const x = ML + (col * colW);
      const w = wide ? PW : colW - 10;

      page.drawText(c.label.toUpperCase(), { x, y: A4H - curY - 10, size: 7, font: hel, color: LIGHT });

      const lines = wrapText(c.value, w, hel, 9.5);
      lines.forEach((line, li) => {
        page.drawText(line, { x, y: A4H - curY - 22 - li * 13, size: 9.5, font: hel, color: DARK });
      });

      const fieldH = 14 + lines.length * 13 + 2;
      rowStartH = Math.max(rowStartH, fieldH);

      if (wide || col === 1 || i === campos.length - 1) {
        drawLine(curY + rowStartH + 4);
        curY += rowStartH + 8;
        col = 0;
        rowStartH = 0;
      } else {
        col = 1;
      }
    });
    curY += 6;
  };

  section("1. Identificação da Equipe", [
    { label: "Brigadista Responsável", value: val(d.brigadista) },
    { label: "Nome da Equipe",         value: val(d.nomeEquipe) },
    { label: "Brigadistas da Equipe",  value: val(d.brigadistas), wide: true },
  ]);

  section("2. Identificação do Local da Ocorrência", [
    { label: "Município",                         value: val(d.municipio) },
    { label: "Coordenadas GPS",                   value: val(d.coordStr) },
    { label: "Local de Referência",               value: val(d.localReferencia), wide: true },
    { label: "Localização (Entorno/Interno)",      value: val(d.local) },
    { label: "Unidade de Conservação (UC)",        value: d.uc ? (d.uc === "sim" ? "Sim" : "Não") : "–" },
  ]);

  section("3. Dados da Detecção do Incêndio", [
    { label: "Data de Detecção",    value: fmtDate(d.dataDeteccao) },
    { label: "Hora de Detecção",    value: val(d.horaDeteccao) },
    { label: "Forma de Detecção",   value: val(d.formaDeteccao), wide: true },
  ]);

  section("4. Dados do Comunicante / Contato", [
    { label: "Nome do Contato",   value: val(d.nomeContato) },
    { label: "Orgão / Função",    value: val(d.orgaoContato) },
    { label: "Telefone",          value: val(d.telefoneContato), wide: true },
  ]);

  section("5. Dados do Combate", [
    { label: "Início do Combate",           value: fmtDateTime(d.inicioData,   d.inicioHora) },
    { label: "Incêndio Debelado em",        value: fmtDateTime(d.debeladoData, d.debeladoHora) },
    { label: "Pessoal Mobilizado",          value: val(d.pessoal) },
    { label: "Veículos Mobilizados",        value: val(d.veiculos) },
    { label: "Houve Alimentação",           value: d.alimentacao ? (d.alimentacao === "sim" ? "Sim" : "Não") : "–" },
    { label: "Causa Provável do Incêndio",  value: val(d.causa) },
    { label: "Descrição da Ocorrência",     value: val(d.descricao), wide: true },
  ]);

  section("6. Área Atingida e Localização Espacial", [
    { label: "Área Total Atingida (calculada)", value: row.area ? `${row.area.toFixed(4)} hectares` : "–" },
    { label: "Polígono Registrado", value: (() => { try { const p = parsePoly(row.polygon); return p.length >= 3 ? `Sim – ${p.length} vértices` : "Não registrado"; } catch { return "–"; } })() },
  ]);

  // ── Rodapé ──
  const footTop = A4H - 90;
  page.drawRectangle({ x: 0, y: footTop - 90, width: A4W, height: 90, color: BGLT });
  page.drawRectangle({ x: 0, y: footTop,       width: A4W, height: 0.5, color: LINE });

  const footLabel = `Documento gerado automaticamente pelo Sistema Brigada Ouro  ·  Registro #${String(row.id).padStart(4,"0")}  ·  ${new Date().toLocaleString("pt-BR")}`;
  page.drawText(footLabel, {
    x: A4W / 2 - hel.widthOfTextAtSize(footLabel, 7) / 2, y: footTop - 12, size: 7, font: hel, color: LIGHT
  });

  // Assinatura digital
  if (row.signature) {
    try {
      const raw = row.signature.replace(/^data:image\/\w+;base64,/, "");
      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      let img;
      try { img = await pdfDoc.embedPng(bytes); } catch { img = await pdfDoc.embedJpg(bytes); }
      const dim = img.scale(1);
      const sigW = Math.min(200, dim.width);
      const sigH = Math.min(45, sigW * dim.height / dim.width);
      page.drawImage(img, { x: A4W / 2 - sigW / 2, y: footTop - 58, width: sigW, height: sigH });
    } catch (_) {}
  }

  // Linha de assinatura
  page.drawLine({ start: { x: A4W / 2 - 100, y: footTop - 63 }, end: { x: A4W / 2 + 100, y: footTop - 63 }, thickness: 0.5, color: LINE });

  const rl = "Brigadista – Responsável pelo Registro";
  page.drawText(rl, { x: A4W / 2 - hel.widthOfTextAtSize(rl, 7) / 2, y: footTop - 73, size: 7, font: hel, color: LIGHT });

  const bn = val(d.brigadista);
  page.drawText(bn, { x: A4W / 2 - helB.widthOfTextAtSize(bn, 8) / 2, y: footTop - 83, size: 8, font: helB, color: DARK });

  // ── Páginas de Fotos ──
  const photos = (() => { try { return JSON.parse(row.photos || "[]"); } catch { return []; } })();
  if (photos.length > 0) {
    const imgW = 242, imgH = 340;
    const positions = [
      { x: ML,       topY: 68 },
      { x: ML + 258, topY: 68 },
      { x: ML,       topY: 68 + 356 },
      { x: ML + 258, topY: 68 + 356 },
    ];
    for (let pi = 0; pi < photos.length; pi += 4) {
      const pg = pdfDoc.addPage([A4W, A4H]);
      pg.drawRectangle({ x: 0, y: A4H - 58, width: A4W, height: 58, color: RED });
      const rl2 = "REGISTRO FOTOGRÁFICO";
      pg.drawText(rl2, { x: A4W / 2 - hel.widthOfTextAtSize(rl2, 7) / 2, y: A4H - 20, size: 7, font: hel, color: PINK });
      const tl2 = `Incêndio #${String(row.id).padStart(4,"0")} – Brigada Ouro`;
      pg.drawText(tl2, { x: A4W / 2 - helB.widthOfTextAtSize(tl2, 14) / 2, y: A4H - 40, size: 14, font: helB, color: WHITE });

      const slice = photos.slice(pi, pi + 4);
      for (let idx = 0; idx < slice.length; idx++) {
        try {
          const raw = slice[idx].replace(/^data:image\/\w+;base64,/, "");
          const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
          let img;
          try { img = await pdfDoc.embedJpg(bytes); } catch { img = await pdfDoc.embedPng(bytes); }
          const pos = positions[idx];
          pg.drawImage(img, { x: pos.x, y: A4H - pos.topY - imgH, width: imgW, height: imgH });
          const fl = `Foto ${pi + idx + 1}`;
          pg.drawText(fl, { x: pos.x + imgW / 2 - hel.widthOfTextAtSize(fl, 8) / 2, y: A4H - pos.topY - imgH - 12, size: 8, font: hel, color: LIGHT });
        } catch (_) {}
      }
    }
  }

  return await pdfDoc.save();
}

// ─── Excel ────────────────────────────────────────────────────────────────────
function gerarExcel(rows, now) {
  const gerado = now.toLocaleString("pt-BR");
  const fmtD = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return dd ? `${dd}/${m}/${y}` : d; };
  const uc2 = (v) => v === "sim" ? "Sim" : v === "nao" ? "Não" : v || "";

  const headers = [
    "Nº Registro","Data/Hora Registro","Equipe",
    "Brigadista Responsável","Nome da Equipe","Brigadistas da Equipe",
    "Município","Coordenadas GPS","Latitude","Longitude",
    "Local de Referência","Localização (Entorno/Interno)","UC (S/N)",
    "Data Detecção","Hora Detecção","Forma de Detecção",
    "Nome do Contato","Orgão / Função","Telefone",
    "Início Combate – Data","Início Combate – Hora",
    "Incêndio Debelado – Data","Debelado – Hora",
    "Pessoal Mobilizado","Veículos Mobilizados",
    "Houve Alimentação","Causa do Incêndio",
    "Descrição da Ocorrência","Área Atingida (ha)","Qtd. Fotos"
  ];

  const dataRows = rows.map(r => {
    const d = parseData(r.data);
    const photos = (() => { try { return JSON.parse(r.photos || "[]"); } catch { return []; } })();
    return [
      `#${String(r.id).padStart(4,"0")}`, new Date(r.createdAt).toLocaleString("pt-BR"), r.team || "",
      d.brigadista||"", d.nomeEquipe||"", d.brigadistas||"",
      d.municipio||"", d.coordStr||"",
      d.lat ? parseFloat(d.lat) : "", d.lng ? parseFloat(d.lng) : "",
      d.localReferencia||"", d.local||"", uc2(d.uc),
      fmtD(d.dataDeteccao), d.horaDeteccao||"", d.formaDeteccao||"",
      d.nomeContato||"", d.orgaoContato||"", d.telefoneContato||"",
      fmtD(d.inicioData), d.inicioHora||"",
      fmtD(d.debeladoData), d.debeladoHora||"",
      d.pessoal||"", d.veiculos||"", uc2(d.alimentacao),
      d.causa||"", d.descricao||"",
      r.area ? parseFloat(r.area.toFixed(4)) : "", photos.length
    ];
  });

  const ws1 = XLSX.utils.aoa_to_sheet([
    [`RELATÓRIO DE INCÊNDIOS FLORESTAIS – Brigada Ouro`],
    [`Gerado em: ${gerado}   |   Total de registros: ${rows.length}`],
    [],
    headers,
    ...dataRows
  ]);
  ws1["!cols"] = [12,22,20,28,25,50,20,30,12,12,30,22,8,14,12,30,25,22,16,18,14,18,14,30,30,16,25,50,14,10].map(w => ({ wch: w }));

  const totalArea = rows.reduce((a, b) => a + (b.area || 0), 0);
  const thisMonth = rows.filter(r => { const d = new Date(r.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
  const causas = {};
  rows.forEach(r => { const d = parseData(r.data); const c = d.causa || "Não informada"; causas[c] = (causas[c] || 0) + 1; });

  const ws2 = XLSX.utils.aoa_to_sheet([
    ["RESUMO ESTATÍSTICO"], [`Gerado em: ${gerado}`], [],
    ["INDICADOR","VALOR"],
    ["Total de registros", rows.length],
    ["Área total atingida (ha)", parseFloat(totalArea.toFixed(4))],
    ["Área média por ocorrência (ha)", rows.length > 0 ? parseFloat((totalArea / rows.length).toFixed(4)) : 0],
    ["Registros neste mês", thisMonth], [],
    ["OCORRÊNCIAS POR CAUSA"], ["Causa","Quantidade"],
    ...Object.entries(causas).map(([k, v]) => [k, v])
  ]);
  ws2["!cols"] = [{ wch: 40 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Registros Completos");
  XLSX.utils.book_append_sheet(wb, ws2, "Resumo Estatístico");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

// ─── KMZ ─────────────────────────────────────────────────────────────────────
function gerarKMZ(rows) {
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
    <description><![CDATA[<b>Equipe:</b> ${r.team}<br><b>Data:</b> ${new Date(r.createdAt).toLocaleString("pt-BR")}<br><b>Área:</b> ${r.area ? r.area.toFixed(4) + " ha" : "–"}<br><b>Município:</b> ${d.municipio || "–"}<br><b>Causa:</b> ${d.causa || "–"}]]></description>`;
    if (poly.length >= 3) {
      const coords = [...poly, poly[0]].map(([lng, lat]) => `${lng},${lat},0`).join(" ");
      kml += `\n    <styleUrl>#poly</styleUrl>\n    <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    } else if (d.lat && d.lng) {
      kml += `\n    <styleUrl>#pt</styleUrl>\n    <Point><coordinates>${d.lng},${d.lat},0</coordinates></Point>`;
    }
    kml += `\n  </Placemark>`;
  });

  kml += `\n</Document>\n</kml>`;
  const kmzBytes = zipSync({ "doc.kml": strToU8(kml) });
  return kmzBytes;
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Só intercepta rotas de API
  const apiPrefixes = ["/login", "/fire", "/dashboard", "/sync", "/report", "/export"];
  if (!apiPrefixes.some(p => path === p || path.startsWith(p + "/"))) {
    return context.next();
  }

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    }});
  }

  // Init DB (idempotente)
  try { await initDB(env.DB); } catch (e) { console.error("initDB:", e); }

  // ── POST /login ──
  if (path === "/login" && method === "POST") {
    try {
      const { username, password } = await request.json();
      const user = await env.DB.prepare("SELECT * FROM users WHERE username=?").bind(username).first();
      if (!user) return json({ error: "Usuário não encontrado" });
      if (!bcrypt.compareSync(password, user.password)) return json({ error: "Senha inválida" });
      const token = await signJWT({ id: user.id, team: user.team, username: user.username }, env.JWT_SECRET || "incendio_secret_key_v3");
      return json({ token, team: user.team, username: user.username });
    } catch (e) { return json({ error: e.message }, 500); }
  }

  // ── POST /fire ──
  if (path === "/fire" && method === "POST") {
    const user = await getAuth(request, env);
    if (!user) return json({ error: "Token required" }, 401);
    try {
      const body = await request.json();
      const { data, polygon, signature, photos } = body;
      let area = 0;
      if (polygon && polygon.length >= 3) {
        try { area = turf.area(turf.polygon([[...polygon, polygon[0]]])) / 10000; }
        catch (e) { return json({ error: "Erro na área: " + e.message }); }
      }
      if (area === 0 && data && data.areaAtingida) area = parseFloat(data.areaAtingida) || 0;

      const result = await env.DB.prepare(
        "INSERT INTO fires (data,area,team,polygon,photos,signature,createdAt) VALUES (?,?,?,?,?,?,?)"
      ).bind(
        JSON.stringify(data || {}), area, user.team,
        JSON.stringify(polygon || []), JSON.stringify(photos || []),
        signature || null, new Date().toISOString()
      ).run();

      return json({ ok: true, area, id: result.meta.last_row_id });
    } catch (e) { return json({ error: e.message }, 500); }
  }

  // ── GET /dashboard ──
  if (path === "/dashboard" && method === "GET") {
    try {
      const { results } = await env.DB.prepare("SELECT * FROM fires ORDER BY createdAt DESC").all();
      const total = results.length;
      const areaTotal = results.reduce((a, b) => a + (b.area || 0), 0);
      return json({ total, areaTotal, rows: results });
    } catch (e) { return json({ error: e.message }, 500); }
  }

  // ── GET /report/:id ──
  const rptMatch = path.match(/^\/report\/(\d+)$/);
  if (rptMatch && method === "GET") {
    try {
      const row = await env.DB.prepare("SELECT * FROM fires WHERE id=?").bind(parseInt(rptMatch[1])).first();
      if (!row) return new Response("Não encontrado", { status: 404 });
      const pdfBytes = await gerarPDF(row);
      return new Response(pdfBytes, { headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=relatorio-incendio-${row.id}.pdf`,
        "Cache-Control": "no-store"
      }});
    } catch (e) { return new Response("Erro: " + e.message, { status: 500 }); }
  }

  // ── GET /export/excel ──
  if (path === "/export/excel" && method === "GET") {
    const user = await getAuth(request, env);
    if (!user) return json({ error: "Token required" }, 401);
    try {
      const { results } = await env.DB.prepare("SELECT * FROM fires ORDER BY createdAt DESC").all();
      const buf = gerarExcel(results, new Date());
      return new Response(buf, { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=incendios-brigada-${new Date().toISOString().slice(0,10)}.xlsx`,
        "Cache-Control": "no-store"
      }});
    } catch (e) { return json({ error: "Erro Excel: " + e.message }, 500); }
  }

  // ── GET /export/kmz ──
  if (path === "/export/kmz" && method === "GET") {
    const user = await getAuth(request, env);
    if (!user) return json({ error: "Token required" }, 401);
    try {
      const { results } = await env.DB.prepare("SELECT * FROM fires ORDER BY createdAt DESC").all();
      const kmzBytes = gerarKMZ(results);
      return new Response(kmzBytes, { headers: {
        "Content-Type": "application/vnd.google-earth.kmz",
        "Content-Disposition": "attachment; filename=incendios-brigada.kmz",
        "Cache-Control": "no-store"
      }});
    } catch (e) { return json({ error: "Erro KMZ: " + e.message }, 500); }
  }

  // ── POST /sync ──
  if (path === "/sync" && method === "POST") {
    const user = await getAuth(request, env);
    if (!user) return json({ error: "Token required" }, 401);
    try {
      const { fires } = await request.json();
      if (!fires || !Array.isArray(fires)) return json({ ok: false });
      let count = 0;
      for (const fire of fires) {
        let area = 0;
        try {
          if (fire.polygon && fire.polygon.length >= 3) {
            area = turf.area(turf.polygon([[...fire.polygon, fire.polygon[0]]])) / 10000;
          } else if (fire.data && fire.data.areaAtingida) area = parseFloat(fire.data.areaAtingida) || 0;
        } catch {}
        await env.DB.prepare(
          "INSERT INTO fires (data,area,team,polygon,photos,signature,createdAt) VALUES (?,?,?,?,?,?,?)"
        ).bind(
          JSON.stringify(fire.data || {}), area, user.team,
          JSON.stringify(fire.polygon || []), "[]",
          fire.signature || null, fire.createdAt || new Date().toISOString()
        ).run();
        count++;
      }
      return json({ ok: true, synced: count });
    } catch (e) { return json({ error: e.message }, 500); }
  }

  return new Response("Not found", { status: 404 });
}
