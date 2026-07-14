---
name: Dual backend Cloudflare vs Node auth mismatch
description: How to spot and fix "Falha na conexão"-style errors caused by parallel Node/Express and Cloudflare Pages/Worker backends drifting out of sync on auth logic.
---

Some imported projects ship two parallel backend implementations for the same frontend: a Node/Express server (for local/Replit dev) and a Cloudflare Pages Function or Worker (for production, using D1 instead of SQLite). The frontend is shared and offline-first: login screens generate a client-side `.local` token (base64 JSON payload + `.local` suffix) immediately so the user can work offline, then try to silently exchange it for a real server JWT in the background.

**Why this matters:** if the Cloudflare-side `getAuth`/auth middleware only verifies real JWTs and doesn't special-case the `.local` token format, every authenticated request (e.g. POST /fire) made while the client is still holding the `.local` token returns 401. The frontend's fetch wrapper often treats *any* non-OK response as a network failure (checks `res.ok` before parsing), so the user sees a generic "connection failed, saved offline" message even though the app is fully online and the server is reachable — the real bug is an auth format mismatch, not connectivity.

**How to apply:** when a user reports a "falha de conexão" / "saved offline" error that reproduces consistently (not intermittently) on a Cloudflare-deployed variant of an app that also has a working Node/Express counterpart, diff the two backends' auth logic first. Check whether the Cloudflare side handles the same offline/local token format the Node side does, and whether both expose the same `/auth/*` routes. Also check for a `worker-entry.js`-style bundled artifact that may be the actual deployed file, separate from readable source under something like `_src/functions/` — bundled and source copies can drift and both may need the same fix.
