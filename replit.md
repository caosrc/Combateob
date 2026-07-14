# Fogo Branco — Incêndio v3

Sistema de registo de ocorrências de incêndios florestais para brigadas de combate a incêndios.

## Stack
- **Backend**: Node.js + Express + SQLite (`app/server.js`)
- **Frontend**: HTML/CSS/JS estático em `app/public/` (PWA com service worker)
- **Auth**: tokens JWT (servidor) + tokens `.local` base64 (offline)
- **BD**: SQLite em `app/db.sqlite`

## Como correr
```bash
cd app && node server.js
```
O servidor fica disponível na porta 5000.

## Workflow configurado
- **Start application**: `cd app && node server.js`

## Credenciais padrão
- **Combatente**: qualquer — clica "Combatente" no login (sem senha)
- **Gestor – Defesa Civil**: senha `301067`
- **Gestor – outras equipes**: senha `106106` (gerenciável pela Defesa Civil)

## Variáveis de ambiente
- `SESSION_SECRET` — usado como segredo JWT. Se não definido, usa `"incendio_secret_key_v3"`.

## Estrutura
```
app/
  server.js       # API Express (rotas: /auth/*, /fire, /dashboard, /report, /export)
  public/         # Frontend estático servido pelo Express
    index.html    # App principal (aba Registrar, Mapa, Dashboard)
    login.html    # Tela de login
    app.js        # Lógica do frontend (v=13)
    sw.js         # Service Worker (cache offline)
    db.js         # IndexedDB helpers (cache local + pendentes offline)
```

## User preferences
- Respostas apenas em português.
