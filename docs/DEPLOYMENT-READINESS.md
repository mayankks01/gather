# Deployment readiness review — 23 September 2026

Verdict: the local MVP is working, but the repository is not ready for unrestricted public deployment as configured. The interface is suitable for a portfolio demonstration; public readiness depends on the operational and security items below.

## Evidence

- Release publish succeeded: `dotnet publish backend/Gather.Api -c Release --no-restore`.
- Latest frontend production build passed TypeScript and Vite; JavaScript is approximately 128 KB gzip.
- Latest integration run passed all 31 tests against isolated SQLite, including connection removal and reconnect approval. This review did not rerun the unchanged integration suite.
- `npm audit --omit=dev --json` reported zero known vulnerabilities in production dependencies.
- `dotnet list backend/Gather.Api package --vulnerable --include-transitive` reported no vulnerable packages from its current feeds. Feed results are not a security certification.
- Docker Desktop's Linux engine was unavailable. Container startup, PostgreSQL upgrades, Redis behavior and the HTTPS deployment path remain unverified. CI currently exercises SQLite in Development.

## Fix before an unrestricted public launch

1. **P1 — Production configuration and HTTPS are missing from the supplied deployment recipe.** `compose.yaml:26` sets Development, line 31 uses a localhost public URL, and Nginx listens on HTTP (`frontend/nginx.conf:2`). Refresh cookies are only Secure outside Development (`backend/Gather.Api/Auth/AuthService.cs:52`). Supply a separate Production configuration, real HTTPS origin, persistent random signing key, and a verified TLS/proxy setup. The localhost-only port mapping is appropriate for local use; do not simply expose it publicly unchanged.

2. **P1 — Recovery and verification emails are never delivered.** `backend/Gather.Api/Auth/AuthService.cs:88` always writes links to local files, including in Production. Add a real email sender, retain the file outbox only for Development, and test delivery and one-time link use against the public URL.

3. **P1 — Proxy client identity breaks unauthenticated rate-limit isolation.** Nginx's API location (`frontend/nginx.conf:7`) does not forward client IP information, and `Program.cs` has no trusted forwarded-header processing. The auth policy at `backend/Gather.Api/Program.cs:53` keys unauthenticated traffic by RemoteIpAddress. Behind the supplied Nginx proxy, users therefore share the proxy's 20-request-per-minute authentication bucket. Forward client IP/scheme and trust only the actual proxy network; verify two clients do not consume the same bucket.

4. **P1 — A revoked chat session can continue receiving broadcasts.** Password reset increments AuthVersion (`backend/Gather.Api/Auth/AuthService.cs:104`), but the hub only checks that version during invocations (`backend/Gather.Api/Realtime/ChatHub.cs:110`). Existing connections remain in their personal receive group (`ChatHub.cs:84`), and broadcasts target that group (`ChatHub.cs:19`). Static review indicates a passive old connection can receive messages until token expiry or another invocation. Disconnect revoked sessions or exclude them from delivery, and add a two-session reset/receive regression test.

5. **P1 — Upload storage has no cumulative quota or cleanup.** `backend/Gather.Api/Features/MediaEndpoints.cs` limits individual uploads but persists files before they are attached to a message. No per-account storage quota or orphan cleanup is implemented. Repeated allowed uploads can exhaust disk space. Add storage limits, cleanup and disk monitoring; use persistent storage with backups. A durable local volume can serve a single-instance pilot—cloud object storage is not mandatory for that scope.

## Deployment acceptance checks still needed

- Bring up the intended container/database stack and exercise sign-in, cookie refresh, WebSockets, uploads, restart persistence and schema upgrades behind HTTPS.
- Verify backup restoration for both the database and uploaded media. Named volumes and pre-upgrade SQLite backups exist; scheduled off-host backups and restore drills are not demonstrated.
- Add dependency-aware readiness checks. `/api/v1/health` currently returns a constant response (`backend/Gather.Api/Program.cs:70`) and cannot detect database/storage failure.
- Apply frontend security headers, including a Content Security Policy appropriate for its assets. The API's restrictive CSP does not protect HTML served by Nginx.
- Establish basic error/uptime/disk alerts and test representative concurrent chat/upload traffic. Multi-instance presence and rate limiting require further work; they are currently in memory.
- Complete browser/accessibility checks and a release commit. Current local changes have not been committed or pushed by this review.

No deployment was performed and no product code was changed during this review. Hosting credentials, live secrets and an external production environment were not inspected.
