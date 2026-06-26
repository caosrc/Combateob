# Configuração Cloudflare – Brigada Ouro

## ✅ JÁ FEITO (pelo agente automaticamente)

| Item | Status | Detalhe |
|------|--------|---------|
| Banco D1 criado | ✅ Pronto | Nome: `brigada-ouro` |
| Database ID no wrangler.toml | ✅ Pronto | `397a7ca6-93fa-4f31-a609-1ff22f6d1231` |
| Schema (tabelas users + fires) | ✅ Pronto | Criado via API |

---

## 🔧 O QUE FALTA FAZER (você faz no Cloudflare)

### Passo 1 – Push para o GitHub

No Replit, clique no ícone **Source Control (⎇)** na barra lateral:
1. Escreva uma mensagem de commit (ex: `deploy cloudflare`)
2. Clique em **Commit & Push**

---

### Passo 2 – Conectar GitHub ao Cloudflare Pages

1. Acesse **dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git**
2. Autorize o GitHub e selecione o repositório **Combateob**
3. Configure o build:
   - **Build command**: (deixe **vazio**)
   - **Build output directory**: `app/public`
   - **Root directory**: `/`
4. Clique em **Save and Deploy**

---

### Passo 3 – Variável de ambiente JWT_SECRET

Em **Pages → Settings → Environment variables → Add variable**:

| Variável | Valor |
|----------|-------|
| `JWT_SECRET` | qualquer texto longo e secreto (ex: `brigada-ouro-2025-secret`) |

---

### Passo 4 – Vincular o banco D1

Em **Pages → Settings → Functions → D1 database bindings → Add binding**:

| Variável | Banco |
|----------|-------|
| `DB` | `brigada-ouro` |

---

### Passo 5 – Compatibility flags

Em **Pages → Settings → Functions**:
- **Compatibility flags**: `nodejs_compat`
- **Compatibility date**: `2024-09-23`

---

### Passo 6 – Redeploy

Após salvar as configurações, clique em **Retry deployment** (ou faça um novo push) para o deploy rodar com as novas variáveis.

---

## Usuários padrão (criados automaticamente na 1ª requisição)

| Usuário | Senha | Equipe |
|---------|-------|--------|
| admin | admin123 | Equipe Alpha |
| brigada1 | brigada123 | Equipe Beta |

---

## Banco D1 – Referência

- **Nome**: `brigada-ouro`
- **ID**: `397a7ca6-93fa-4f31-a609-1ff22f6d1231`
- **Account ID**: `eabd9971defcda96c2d754fa51d20d4f`
