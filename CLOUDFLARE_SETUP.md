# Configuração Cloudflare – Brigada Ouro

## Pré-requisitos
- Conta Cloudflare (cloudflare.com)
- Repositório GitHub com este código

---

## Passo 1 – Criar o banco de dados D1

No terminal (ou no Replit Shell):

```bash
npx wrangler login
npx wrangler d1 create brigada-ouro
```

Copie o `database_id` que aparecer e cole no `wrangler.toml`:
```toml
database_id = "cole-aqui-o-id"
```

Depois aplique o schema:
```bash
npx wrangler d1 execute brigada-ouro --remote --file=./schema.sql
```

---

## Passo 2 – Conectar GitHub ao Cloudflare Pages

1. Acesse **dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git**
2. Escolha seu repositório GitHub
3. Configure o build:
   - **Build command**: (deixe vazio)
   - **Build output directory**: `app/public`
   - **Root directory**: `/` (raiz)

---

## Passo 3 – Configurar variáveis de ambiente

Em **Cloudflare Pages → Settings → Environment variables**, adicione:

| Variável    | Valor               |
|-------------|---------------------|
| JWT_SECRET  | uma-chave-secreta   |

---

## Passo 4 – Vincular o banco D1

Em **Pages → Settings → Functions → D1 database bindings**, adicione:

| Nome da variável | Banco de dados   |
|------------------|------------------|
| DB               | brigada-ouro     |

---

## Passo 5 – Deploy

Faça push para o GitHub:
```bash
git add .
git commit -m "deploy cloudflare"
git push
```

O Cloudflare Pages detecta o push e faz o deploy automaticamente.

---

## Usuários padrão criados automaticamente

| Usuário  | Senha      | Equipe       |
|----------|------------|--------------|
| admin    | admin123   | Equipe Alpha |
| brigada1 | brigada123 | Equipe Beta  |

---

## Compatibilidade de flags

No painel Cloudflare Pages → Settings → Functions:
- **Compatibility flags**: `nodejs_compat`
- **Compatibility date**: `2024-09-23`
