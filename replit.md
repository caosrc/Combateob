# Fogo Branco — Sistema de Combate a Incêndios Florestais

Aplicação web de gestão de brigadas de combate a incêndios florestais (Incendio v3).

## Stack
- **Backend:** Node.js + Express
- **Base de dados:** SQLite (`app/db.sqlite`)
- **Autenticação:** JWT (usa `SESSION_SECRET` do ambiente ou chave padrão)
- **Frontend:** HTML/CSS/JS puro (PWA com service worker)
- **Exportação:** PDF (pdfkit), Excel (exceljs/xlsx), KMZ (archiver + turf)

## Estrutura
```
app/
  server.js        # servidor Express + todas as rotas da API
  package.json
  public/          # frontend estático (HTML, CSS, JS, ícones)
  uploads/         # ficheiros enviados pelos utilizadores
  db.sqlite        # base de dados SQLite (criada automaticamente)
```

## Como executar
```bash
cd app && node server.js
```
O servidor inicia na porta `5000` (ou `PORT` se definida no ambiente).

## Funcionalidades
- Login com dois perfis: **Combatente** (registo + mapa) e **Gestor** (acesso completo)
- Registo de ocorrências de incêndio com geolocalização
- Dashboard de gestão
- Exportação de relatórios em PDF, Excel e KMZ
- PWA (instalável em dispositivos móveis)

## Variáveis de ambiente
| Variável | Descrição |
|---|---|
| `SESSION_SECRET` / `JWT_SECRET` | Chave para assinar tokens JWT |
| `PORT` | Porta do servidor (padrão: 5000) |

## Preferências do utilizador
- Responder sempre em português.
