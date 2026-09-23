# Deploy Gather: Vercel frontend + Docker API

This setup uses Vercel for the React site and one long-running Docker service for ASP.NET Core, SignalR and persistent files. The existing .NET server is not a Vercel Function. No live deployment has been performed by preparing these files.

## 1. Push the changes to GitHub

From the repository root, review `git status`, then:

```powershell
git add .
git commit -m "Prepare Vercel frontend and production Docker API"
git push
```

Real secrets, local databases, uploads, test artifacts and `deploy/backend.env` are ignored. Never put secrets in source files or in a variable beginning `VITE_`.

## 2. Create the frontend project in Vercel

Import the GitHub repository. Use these project settings:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js | 22.x |

Reserve/note the stable production address, for example `https://gather-yourname.vercel.app`. You can create the project before the API is ready, but its build intentionally fails until the two environment variables in step 4 are set. Use the stable production domain, not a different preview deployment URL each time.

## 3. Deploy the API to a Docker host

Use a host with HTTPS, WebSocket support, outbound SMTP and a persistent writable volume. Select **one instance** for this pilot. The local disk, upload coordination, presence and rate limits are not designed for independent replicas.

| Setting | Value |
| --- | --- |
| Build context / repository root | `.` |
| Dockerfile | `backend/Gather.Api/Dockerfile` |
| Internal HTTP port | `8080` |
| Start command | Leave default (`dotnet Gather.Api.dll`) |
| Environment | Production |
| Persistent disk mount | `/app/App_Data` |
| Readiness URL | `/api/v1/ready` |
| Liveness URL | `/api/v1/health` |

The provider must terminate HTTPS and forward HTTP/WebSocket traffic to port 8080. Redirect public HTTP to HTTPS at the provider. Do not expose the container's HTTP port directly to the Internet. The container runs as the .NET `app` user (UID 1654); the mounted data directory must be writable by that user. A new named Docker volume inherits the image directory's ownership; a host bind mount might need ownership set by the host administrator.

Copy the variable names from [`deploy/backend.env.example`](../deploy/backend.env.example) into the provider's environment/secret settings, then replace every placeholder:

- `App__PublicUrl`: your exact stable Vercel HTTPS origin, without a trailing slash.
- `Jwt__Key`: a unique random signing key; preserve it across deployments.
- `Proxy__VercelSecret`: a different random secret, also used by Vercel in step 4.
- `Email__Host`, `Email__Port`, `Email__From`, `Email__Username`, `Email__Password`: your transactional SMTP provider's details and verified sender. Port 587 uses `Email__Security=StartTls`; for port 465 use `SslOnConnect`. SMTP TLS and normal certificate validation are mandatory. Production refuses to start without a sender configuration.
- SQLite is configured in the example and is sufficient for a small single-instance pilot. PostgreSQL is optional; the media/key volume is still required with PostgreSQL.

Generate each secret separately in local PowerShell and paste it directly into the provider dashboards:

```powershell
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Default attachment limits are 512 MiB per account, 5 GiB total and 256 MiB of free disk reserved. Choose a volume larger than the total attachment limit **plus database, picture, key and backup storage**, or lower `Storage__TotalQuotaBytes`. Unattached uploads and orphan files older than 24 hours are removed at startup and hourly. Sent attachments are retained; deleting a conversation does not delete its files. These quotas cover chat attachment files, not database growth or off-host backups.

For direct API client IP forwarding, configure `Proxy__KnownProxies` or `Proxy__KnownNetworks` only with the host's documented immediate proxy addresses. Unknown forwarded headers are ignored. Do not enable trust-all forwarded headers. Authentication through Vercel uses its overwritten `X-Vercel-Forwarded-For` header only when the rewrite carries the shared secret; the Docker host must preserve that header. An unsigned request directly to an auth endpoint is deliberately rejected.

**Example provider:** a Render Docker web service can use this Dockerfile and mount path. Its [persistent disks](https://render.com/docs/disks) require a paid service; its default filesystem is ephemeral. Do not put SQLite or user uploads on an ephemeral/free filesystem and expect them to survive restarts. Choose a provider/plan yourself before creating billable resources.

## 4. Connect Vercel to the API

Once the API has a public HTTPS address, add these Vercel environment variables for **Production**:

| Variable | Value |
| --- | --- |
| `VITE_BACKEND_ORIGIN` | API HTTPS origin, e.g. `https://gather-api.example.com` (no path) |
| `GATHER_PROXY_SECRET` | Exactly the same value as API `Proxy__VercelSecret` |

Redeploy the frontend. `frontend/vercel.mjs` reads these settings, sets security headers, proxies `/api/*`, and provides the SPA fallback. The secret is a server-side rewrite header and is not part of the browser bundle. The API origin is public by design.

REST/auth requests use the Vercel URL. Refresh cookies remain HttpOnly, Secure and SameSite=Strict on that origin, avoiding third-party-cookie dependence. SignalR, attachments and pictures use the API origin with bearer tokens. CORS/browser WebSocket origins are restricted to `App__PublicUrl`. For a preview environment use a **separate API/database with its own exact preview origin**; arbitrary Vercel preview domains are not automatically trusted.

## 5. Verify the live deployment

Before sharing the public URL:

1. Open the API `/api/v1/ready` URL; it should return `{"status":"ready"}`. This checks database connectivity and a writable media directory.
2. Create a test account through Vercel, receive the verification email and follow its single-use link. Verify the link uses the Vercel URL. Exercise password recovery too. The code's TLS rejection test does not prove your real provider delivers mail.
3. Reload the site while signed in. Check the browser's refresh cookie has Secure, HttpOnly and SameSite=Strict, and that refresh succeeds through Vercel. If auth returns “Proxy client address is missing”, check whether the backend host preserves `X-Vercel-Forwarded-For`; do not bypass verification or trust arbitrary IP headers.
4. Use two browser profiles to exchange room and accepted-DM messages. Confirm the WebSocket connects to the API host and messages arrive without a reload.
5. Upload a picture and a short video. Confirm direct API uploads/downloads work and the browser reports no CORS/CSP failures.
6. Restart/redeploy the API and check users, messages and attachments persist.
7. Configure disk/uptime/error alerts and scheduled off-host backups. For SQLite, use its online backup API or stop writes while copying; do not copy only a live `.db` while ignoring its WAL. Back up the database and the media/keys directory together, and rehearse restoration before relying on it.

Local data is **not migrated automatically**. Start with a clean hosted database, or plan an explicit consistent transfer of the main local database and its matching media. The disposable preview/test database must not be deployed as production data.

## Local verification commands

```powershell
dotnet build backend/Gather.Api -c Release -o artifacts/deploy-build
node --test tests/deployment.test.mjs
node --test tests/vercel-config.test.mjs
cd frontend
npm ci
npm run build
```

The deployment suite starts isolated APIs and stores disposable fixtures under ignored `artifacts/`. It does not use your local application database or send external email. For an optional container smoke test, fill the ignored `deploy/backend.env` then run `docker compose -f deploy/compose.backend.yaml up --build -d`; the port is local-only at 5082.

References: [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts), [external rewrites](https://vercel.com/docs/routing/rewrites), [Vercel request headers](https://vercel.com/docs/headers/request-headers).
