# Webmentions Worker

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yash-garg/iwc-webmentions-demo)

A standalone Cloudflare Worker that receives and serves webmentions.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webmention` | Receive a webmention (`source` + `target` form fields) |
| `GET`  | `/webmention` | Describes the endpoint |
| `GET`  | `/mentions?target=/posts/slug/` | Returns stored mentions as JSON |

---

## Deploy

### Prerequisites
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org) >= 18
- [pnpm](https://pnpm.io/installation) (`npm install -g pnpm`)

### 1. Install dependencies

```bash
cd worker
pnpm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the D1 database

```bash
npx wrangler d1 create webmentions-worker
```

Copy the `database_id` from the output and paste it into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "webmentions-worker",
    "database_id": "PASTE_YOUR_ID_HERE",   // <-- here
    "migrations_dir": "./migrations"
  }
]
```

### 4. Run database migrations

```bash
# Applies the schema to the remote D1 database
pnpm run db:migrate:remote
```

### 5. (Optional) Set SITE_URL

If you want the worker to redirect browsers back to your blog after they POST a webmention, and to validate that webmentions target your site, set `SITE_URL` as a secret:

```bash
npx wrangler secret put SITE_URL
# Enter your site URL, e.g.: https://webmentions-demo.pages.dev
```

### 6. Deploy

```bash
pnpm run deploy
```

Your worker will be live at `https://webmentions-worker.<your-subdomain>.workers.dev`.

---

## Local Development

```bash
# Apply the schema to the local D1 database
pnpm run db:migrate:local

# Start the local dev server
pnpm run dev
```

The worker runs at `http://localhost:8787`.

Test it:

```bash
curl -X POST http://localhost:8787/webmention \
  -d "source=https://example.com/my-post&target=https://yourblog.com/posts/hello-world/"
```

Fetch mentions:

```bash
curl "http://localhost:8787/mentions?target=/posts/hello-world/"
```

---

## Testing your endpoint

Once deployed, verify it works with [webmention.rocks](https://webmention.rocks) — paste your worker URL and run the test suite.

To check your blog advertises the endpoint correctly, use [indiewebify.me](https://indiewebify.me).
