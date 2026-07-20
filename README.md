# kori-backend

NestJS backend for Kori — a digital sticky-note board where visitors leave text notes and drawings, with an admin dashboard for moderation.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 / TypeScript |
| Framework | NestJS 11 |
| ORM | Prisma 6.19.3 |
| Database | PostgreSQL via Supabase Session Pooler |
| Storage | Supabase Storage |
| Auth | JWT (HS256, issuer + audience validated) |
| Container | Docker multi-stage (node:22-slim) |
| Package manager | pnpm 10 |

---

## Architecture

```
src/
├── config/
│   └── env.validation.ts        # Fail-fast env validation at startup
├── common/
│   ├── constants/               # Note field limits, style ranges
│   ├── filters/
│   │   └── http-exception.filter.ts   # Global error envelope
│   ├── interceptors/
│   │   ├── request-logging.interceptor.ts
│   │   ├── public-notes-cache.interceptor.ts   # ETag + Cache-Control
│   │   └── no-cache.interceptor.ts
│   ├── middleware/
│   │   └── request-id.middleware.ts   # x-request-id propagation
│   └── utils/
│       ├── hash.util.ts         # HMAC-SHA256 fingerprinting
│       ├── client-ip.util.ts    # Trust-proxy-aware IP extraction
│       ├── random-note-style.util.ts
│       └── text-sanitize.util.ts
└── modules/
    ├── admin/     # GET|DELETE /admin/notes (JWT-protected)
    ├── auth/      # POST /auth/login
    ├── health/    # GET /health, /health/liveness, /health/readiness
    ├── notes/     # POST /notes/text|drawing, GET /notes/public
    ├── prisma/    # PrismaService (global)
    └── storage/   # Supabase Storage
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in all values before starting.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Supabase Session Pooler URL (pgbouncer mode) |
| `DIRECT_URL` | yes | Direct PostgreSQL URL (for Prisma Migrate) |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service_role key (backend-only) |
| `SUPABASE_STORAGE_BUCKET` | yes | Storage bucket name (default: `notes`) |
| `ADMIN_USERNAME` | yes | Dashboard admin username |
| `ADMIN_PASSWORD_HASH` | yes | bcrypt hash of admin password ($2b$ format) |
| `JWT_SECRET` | yes | HMAC secret — minimum 32 characters |
| `JWT_EXPIRES_IN` | yes | Token TTL (e.g. `2h`) |
| `JWT_ISSUER` | yes | JWT `iss` claim (e.g. `kori-backend`) |
| `JWT_AUDIENCE` | yes | JWT `aud` claim (e.g. `kori-dashboard`) |
| `HASH_PEPPER` | yes | HMAC pepper for IP/UA fingerprints — minimum 32 characters |
| `LANDING_ORIGIN` | yes | Allowed CORS origin for landing page |
| `DASHBOARD_ORIGIN` | yes | Allowed CORS origin for admin dashboard |
| `PORT` | yes | HTTP port (default: `4000`) |
| `NODE_ENV` | yes | `development` / `test` / `production` |
| `ENABLE_REQUEST_LOGGING` | no | Set `true` to log structured HTTP requests |
| `TRUST_PROXY` | no | Proxy hops to trust (`1` for Cloudflare) |

**Generating secrets:**
```bash
# JWT_SECRET / HASH_PEPPER
openssl rand -base64 48

# ADMIN_PASSWORD_HASH
node -e "const b=require('bcrypt');console.log(b.hashSync('your-password',12))"
```

---

## Supabase setup

### PostgreSQL (Session Pooler)

1. Create a Supabase project.
2. In **Settings > Database > Connection pooling**, enable Session Mode.
3. Copy the connection string into `DATABASE_URL` (add `?pgbouncer=true&connection_limit=1`).
4. Copy the direct connection string into `DIRECT_URL`.

### Storage

1. In **Storage**, create a bucket named `notes`.
2. Set the bucket to **public** (drawing image URLs are served directly to the landing page).
3. Only the backend accesses storage via the `service_role` key — never expose this key client-side.

---

## Commands

```bash
# Install dependencies
pnpm install

# Generate Prisma client (required after schema changes or clean install)
pnpm exec prisma generate

# Apply database migrations
pnpm exec prisma migrate deploy

# Start development server (watch mode)
pnpm run start:dev

# Build for production
pnpm run build

# Start production build
pnpm run start:prod

# Lint (auto-fix)
pnpm run lint

# Lint (CI — no auto-fix, max-warnings 0)
pnpm run lint:check

# Unit tests
pnpm run test

# Unit tests with coverage
pnpm run test:cov

# E2E tests
pnpm run test:e2e
```

---

## Docker

```bash
# Build production image
docker build -t kori-backend:local .

# Build migrator image (runs prisma migrate deploy)
docker build --target migrator -t kori-backend:migrator .

# Run production container
docker run --rm --env-file .env -p 4000:4000 kori-backend:local

# Run migrator (applies pending migrations then exits)
docker run --rm --env-file .env kori-backend:migrator

# Docker Compose (production-like)
docker compose up --build
```

---

## Endpoints

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/notes/public` | Returns the latest notes (max 200) |
| `POST` | `/notes/text` | Creates a text note |
| `POST` | `/notes/drawing` | Creates a drawing note (multipart/form-data) |

Rate limits: `/notes/text` 5 req/60s · `/notes/drawing` 3 req/60s

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/login` | Returns JWT access token |

Rate limit: 5 req/60s · Response always includes `Cache-Control: no-store`

### Admin (JWT required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/notes` | Paginated note list with storagePath |
| `GET` | `/admin/notes/stats` | Total/text/drawing counts |
| `GET` | `/admin/notes/:id` | Single note detail |
| `DELETE` | `/admin/notes/:id` | Delete note + storage file if DRAWING |

All admin responses include `Cache-Control: no-store`.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Process alive check |
| `GET` | `/health/liveness` | Liveness probe (no external deps) |
| `GET` | `/health/readiness` | Readiness probe (validates DB with SELECT 1) |

Health endpoints are exempt from rate limiting.

---

## Error response format

All errors return a uniform JSON envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "message cannot exceed 256 characters",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-05-24T10:00:00.000Z",
    "path": "/notes/text",
    "method": "POST"
  }
}
```

Error codes: `VALIDATION_ERROR` · `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `RATE_LIMITED` · `SERVICE_UNAVAILABLE` · `INTERNAL_ERROR` · `REQUEST_ERROR`

Stack traces are never exposed. `requestId` is included in every error for correlation.

---

## Rate limiting

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 5 requests / 60s |
| `POST /notes/text` | 5 requests / 60s |
| `POST /notes/drawing` | 3 requests / 60s |
| `GET /notes/public` | 60 requests / 60s (global) |
| `/admin/*` | 60 requests / 60s (global) |
| `/health/*` | No limit |

Rate-limited requests receive HTTP 429 with `RATE_LIMITED` error code.

---

## Caching

### `GET /notes/public`
- `Cache-Control: public, max-age=30, stale-while-revalidate=60`
- ETag computed from response body (SHA-256 prefix, first 16 hex chars)
- Returns `304 Not Modified` when `If-None-Match` matches

**Cloudflare configuration:**
- Cache Rule: `GET /notes/public` → Cache Everything, Edge TTL 1 minute
- Auth/Admin routes: `Cache-Control: no-store` → Cloudflare bypasses cache automatically

### Auth + Admin
All responses include `Cache-Control: no-store`.

---

## Security

- **Env validation**: fail-fast at startup if required variables are missing or malformed
- **Helmet**: security headers on all responses
- **CORS**: explicit origin allowlist (`LANDING_ORIGIN`, `DASHBOARD_ORIGIN`)
- **JWT**: HS256 with issuer + audience validation; tokens expire per `JWT_EXPIRES_IN`
- **Fingerprinting**: HMAC-SHA256 with `HASH_PEPPER` — raw IP/UA is never stored in DB
- **Trust proxy**: configurable via `TRUST_PROXY` for correct client IP behind Cloudflare
- **File validation**: MIME type + magic bytes checked for drawing uploads
- **Multer limits**: fileSize 2 MB, 1 file, 5 fields, 6 parts
- **Input sanitization**: HTML stripped from all text fields via `sanitize-html`
- **Error filter**: stack traces never exposed; sensitive env values never logged
- **x-request-id**: propagated from caller or generated per request (UUID v4)

---

## Database migrations

| Migration | Description |
|---|---|
| `20260524000000_init_notes` | Initial schema: `notes` table, `NoteType` enum, indexes |
| `20260524100000_add_note_constraints` | CHECK constraints for type invariants, position ranges, z-index, non-empty recipient_name |

To apply pending migrations:
```bash
pnpm exec prisma migrate deploy
# or via Docker migrator:
docker run --rm --env-file .env kori-backend:migrator
```

---

## CI/CD

GitHub Actions pipeline at `.github/workflows/ci.yml`:

1. **quality** job: install → prisma generate → lint:check → test → test:e2e → build → pnpm audit
2. **docker** job (after quality): build production image → build migrator image → Trivy security scan

No secrets are used in the workflow. Deployment is not automated.

**Future roadmap:** BullMQ/Redis queue for async drawing uploads, and a notification service layer are designed for but not implemented. The current service architecture (StorageService injected into NotesService) supports this refactor without breaking existing endpoints.

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `EADDRINUSE: address already in use :::4000` | Port 4000 occupied | `lsof -ti:4000 \| xargs kill` or change `PORT` |
| `P1001: Can't reach database server` | DATABASE_URL unreachable | Check Supabase Session Pooler status and URL |
| `P1000: Authentication failed` | Wrong DB password | Regenerate password in Supabase dashboard |
| `Invalid Compact JWS` | SUPABASE_SERVICE_ROLE_KEY wrong/empty | Copy the full service_role key from Supabase API settings |
| `Bucket "notes" not found` | Bucket missing or wrong name | Create bucket in Supabase Storage matching `SUPABASE_STORAGE_BUCKET` |
| `Environment validation failed` | Missing or malformed env var | Check `.env` against `.env.example`; run `pnpm run start:dev` to see which variable failed |
| CORS errors in browser | Origin not in allowlist | Add origin to `LANDING_ORIGIN` or `DASHBOARD_ORIGIN` |
| 401 on admin routes | JWT expired or wrong issuer/audience | Verify `JWT_ISSUER` and `JWT_AUDIENCE` match between backend and dashboard config |

---

## Recent additions (July 2026)

### Pre-moderation (`NoteStatus`)

Notes are created as `PENDING` and only `APPROVED` notes are returned by
`GET /notes/public`. Approve from the dashboard or via:

```
PATCH /admin/notes/:id/approve   (JWT required)
```

`GET /admin/notes` accepts `?status=PENDING|APPROVED`. Stats include
`totalPending`.

### Subscribers (landing "Coming soon")

```
POST   /subscribers               { email }   → 201 | 409 duplicate (3/min throttle)
GET    /admin/subscribers?page&limit          (JWT)
DELETE /admin/subscribers/:id                 (JWT, idempotent)
```

Emails are normalized to lowercase; the client IP is stored only as an
HMAC-SHA256 hash (`HASH_PEPPER`).

### App settings (landing countdown / album link)

```
GET   /settings/public            → { countdownTarget, albumUrl }  (cached 60s)
GET   /admin/settings             (JWT)
PATCH /admin/settings             (JWT) { countdownTarget?, albumUrl? }
```

Empty string deletes a key; `undefined` leaves it untouched. The landing
countdown becomes a CTA button pointing to `albumUrl` when it reaches zero.

### Local storage driver (development only)

Set `STORAGE_DRIVER=local` to skip Supabase entirely: drawings are written to
`./uploads` and served at `/uploads/*` with CORP `cross-origin`. Rejected by
env validation when `NODE_ENV=production`.

### Optional Sentry

Set `SENTRY_DSN` to report 5xx exceptions (free tier is plenty). Without the
variable, Sentry is a no-op.
