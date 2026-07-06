# Fogo Branco — Sistema de Combate a Incêndios Florestais

## Visão Geral
PWA (Progressive Web App) para registro e gestão de incêndios florestais na região de Ouro Branco/MG. Funciona 100% offline após a primeira carga.

## Stack
- **Backend**: Node.js + Express + SQLite (`sqlite3`)
- **Frontend**: HTML/CSS/JS vanilla + Leaflet.js
- **Offline**: Service Worker (cache-first tiles, stale-while-revalidate shell) + IndexedDB (fila de pendentes)
- **Auth**: JWT com suporte a tokens locais offline (base64 payload + `.local` sufixo)
- **Exports**: PDF (pdfkit), Excel (exceljs), KMZ (archiver + @turf/turf)

## Como rodar
```bash
cd app && npm install && node server.js
```
Workflow configurado: `cd app && node server.js` (porta 5000)

## Usuários padrão (criados se o banco estiver vazio)
- `admin` / `admin123`
- `brigada1` / `brigada123`

## Acesso offline (combatente)
- Sem senha — gera token local automaticamente
- Gestor: senha `106106`, equipes válidas: Defesa Civil, IEF, Carcará, AMDA Gerdau, AMDA IEF, CBMMG

## Estrutura
```
app/
  server.js          # API Express + SQLite
  public/
    index.html       # App principal (tabs: Registrar / Mapa / Dashboard)
    login.html       # Tela de login (combatente / gestor)
    app.js           # Lógica principal do frontend
    db.js            # IndexedDB (fila offline, cache dashboard, ruas)
    sw.js            # Service Worker (cache tiles OSM/satélite, shell SPA)
    style.css        # Estilos
    manifest.json    # PWA manifest
```

## User preferences
- Projeto em português (pt-BR)
- Manter estrutura existente do projeto
