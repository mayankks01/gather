# Free demo deployment: Vercel + Render + Neon + Cloudinary + Brevo

This is the recommended route for a small portfolio/demo deployment. Select the free plans and stay within each provider's quotas. Render's free API sleeps when idle, so the first request can take about a minute. A paid disk is not needed with this configuration.

## 1. Create the external services

### Neon — PostgreSQL

1. Create a Free project at https://neon.com/ and choose a region near your Render service.
2. Open **Connect**, select the database and role, enable **connection pooling**, and copy the PostgreSQL connection URL.
3. Keep only the URL beginning `postgresql://`. Do not include `psql`, shell quotes or a command wrapper.

The backend accepts this URL as `DATABASE_URL`, decodes escaped passwords, uses a small connection pool and requires verified TLS in Production. The database/schema are created in your chosen Neon database on first startup. Do not select an unrelated existing database. A fresh database starts empty; local SQLite accounts/messages/files are not migrated automatically.

### Cloudinary — private chat attachments

1. Create a Free account at https://cloudinary.com/ and open the Image and Video product environment.
2. Copy the **Cloud name**, **API key** and **API secret** from its API Keys settings.
3. No unsigned upload preset is needed. The backend performs signed uploads with `type=authenticated`.

Images/videos remain protected by Gather's membership, blocking and deleted-message checks. The API streams authorized downloads; it never exposes a reusable Cloudinary delivery URL. Avatar/room-icon images are already stored in the database, so they persist in Neon. Use a dedicated Cloudinary product environment for Gather when possible. Do not change uploaded assets to public delivery in its console.

### Brevo — verification and password-reset email

1. Create a Free account at https://www.brevo.com/ and complete sender verification/transactional sending activation.
2. Open **SMTP & API → API Keys** and create an API key. This is **not an SMTP key**.
3. Note the verified sender email address. If you use your own domain, complete the DNS authentication Brevo requires.

Gather sends to Brevo over HTTPS. No SMTP ports are needed. Account activation/sender verification and real delivery must be completed in Brevo; adding a key alone does not prove delivery works.

## 2. Push this update to GitHub

Review `git status`, then commit and push the changes. Secrets belong only in the hosting dashboards. `deploy/free.env.example` contains placeholders; do not replace them in a tracked file.

## 3. Create the Render Free API

In https://dashboard.render.com/, use **New → Web Service**, connect the GitHub repository and configure:

| Setting | Value |
| --- | --- |
| Runtime | Docker |
| Branch | Your branch containing this update |
| Root Directory | Leave blank |
| Dockerfile Path | `backend/Gather.Api/Dockerfile` |
| Docker Build Context | `.` |
| Docker Command | Leave blank |
| Instance type | Free |
| Persistent disk | None |
| Health Check Path | `/api/v1/health` |

Use the liveness path for Render's frequent health checks so they don't continuously wake Neon. Manually use `/api/v1/ready` for a database/scratch-storage readiness check. That endpoint does not send an email or upload a file to test provider credentials.

Alternatively, choose **New → Blueprint** and select this repository's `render.yaml`; it specifies a free service and prompts for secret values. It does not create Neon, Cloudinary or Brevo accounts. Blueprint generates `Jwt__Key` and `Proxy__VercelSecret`; copy the proxy secret from the service's environment settings for Vercel later.

For manual service setup, generate two different secrets by running this command twice locally:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add the following Render environment variables:

| Variable | Value |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ASPNETCORE_URLS` | `http://+:8080` |
| `PORT` | `8080` |
| `Hosting__Ephemeral` | `true` |
| `App__PublicUrl` | Your stable Vercel HTTPS URL; use `https://setup-pending.example` temporarily if not created yet |
| `Jwt__Key` | First generated secret; preserve across redeploys |
| `Proxy__VercelSecret` | Second generated secret |
| `Database__Provider` | `Postgres` |
| `DATABASE_URL` | Neon pooled connection URL |
| `Storage__Provider` | `Cloudinary` |
| `Cloudinary__CloudName` | Cloudinary cloud name |
| `Cloudinary__ApiKey` | Cloudinary API key |
| `Cloudinary__ApiSecret` | Cloudinary API secret |
| `Email__Provider` | `Brevo` |
| `Email__ApiKey` | Brevo API key |
| `Email__From` | Verified sender email address |
| `Storage__UserQuotaBytes` | `134217728` (128 MiB/account) |
| `Storage__TotalQuotaBytes` | `1073741824` (1 GiB across this app) |
| `Storage__MinimumFreeBytes` | `67108864` (64 MiB temporary-disk reserve) |
| `Storage__UnattachedHours` | `24` |

Remove any old `ConnectionStrings__Gather` variable: it takes precedence over `DATABASE_URL` and may still point to SQLite. Remove unused SMTP variables to avoid confusion. The startup guard rejects ephemeral hosting with a local database, local media provider or SMTP email provider. It also rejects databases containing old local attachment references; those need an explicit file/data migration before using an ephemeral host.

Deploy, wait for **Live**, and copy the Render HTTPS service address. Open `https://YOUR-API.onrender.com/api/v1/ready` and confirm `{"status":"ready"}`. Do not create users until the real `App__PublicUrl` is set below.

## 4. Deploy Vercel

Import the same GitHub repository at https://vercel.com/new:

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Root Directory | `frontend` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output | `dist` |
| Node | 22.x |

Add Production environment variables:

- `VITE_BACKEND_ORIGIN`: the Render HTTPS origin, without a trailing slash or path.
- `GATHER_PROXY_SECRET`: exactly the Render `Proxy__VercelSecret` value.

Deploy. Copy the stable production address from **Settings → Domains**. Back on Render, replace `App__PublicUrl` with that exact HTTPS origin and redeploy. Do not use a changing preview deployment URL. Cloudinary, Brevo and Neon secrets must never be added to a `VITE_` variable.

## 5. Check persistence and privacy

1. Register through Vercel and verify the real email link points to the Vercel address. Check Brevo's transactional logs if delivery fails.
2. Reload while signed in; the session should restore. Test recovery and a second use of the same link (it should fail).
3. Test room messaging and accepted DMs in two browser profiles.
4. Upload an image and short video. In Cloudinary confirm their delivery type is **authenticated**. Test that an unrelated account cannot fetch private-room media through Gather.
5. Restart the Render service and confirm messages, accounts, avatars and chat attachments survive. The backend only uses local disk for temporary processing; durable attachments are in Cloudinary and metadata is in Neon.
6. Watch Render bandwidth, Neon database/compute usage, Cloudinary credits and Brevo daily sends. The app's 1 GiB storage cap does not cap external bandwidth, transformations or provider billing. Keep the providers on free plans and review their usage dashboards.

## Storage and cleanup behavior

Uploads are journaled in PostgreSQL **before** contacting Cloudinary. Failed/uncertain uploads retain a quota reservation and are retried for cleanup after 24 hours. On startup and hourly while the API runs, cleanup deletes up to 100 expired unattached/orphaned cloud assets; if the service sleeps it resumes on its next start. Cloud deletion failures keep the journal for retry. Attachments associated with messages are retained, including soft-deleted message data; hiding a DM never deletes shared media.

The host remains a single-instance pilot: upload coordination, presence and rate limits are in process. Cloudinary downloads are proxied for access control and consume provider/backend bandwidth; Cloudinary's private download endpoint is not CDN cached. Back up important Neon data and keep a recovery plan for Cloudinary; free tiers are not a substitute for backups.

Local Development remains SQLite + local files + private email outbox unless provider variables are explicitly configured. SMTP and persistent-disk deployment remain available using the older guide.

References: [Render free limits](https://render.com/docs/free), [Neon free plan](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan), [Cloudinary authenticated media](https://cloudinary.com/documentation/control_access_to_media), [Brevo transactional email API](https://developers.brevo.com/docs/send-a-transactional-email).
