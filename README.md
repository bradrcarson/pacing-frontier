# Pacing Frontier AI Site

This repository serves the Pacing Frontier AI microsite as a small standalone web app. The site has 18 pages built from the 15-tab research document on proposals to pause, pace or contain frontier AI. It includes a proposal map, a comparison matrix, a timeline, a bibliography and full-text search.

| Path | What it is |
| --- | --- |
| `site/` | The built site: 18 HTML pages, `404.html` and `assets/` (CSS, JS, favicon, search index) |
| `server.js` | A zero-dependency Node static server for `site/` |
| `package.json` | `npm start` runs the server; no dependencies |
| `Dockerfile`, `.dockerignore` | The container image Railway builds |
| `railway.json` | Railway build and deploy settings (see the note under Deploy on Railway) |
| `scripts/refresh.sh` | Rebuilds `site/` from the microsite source |

## Run It Locally

You need Node 20 or later.

```sh
npm start                      # http://localhost:8080
PORT=3000 npm start            # another port
SITE_PASSWORD=secret npm start # with a password (user: guest)
```

Or run the container:

```sh
docker build -t pacing-site .
docker run --rm -p 8080:8080 -e SITE_PASSWORD=secret pacing-site
```

The server reads every file in `site/` into memory at startup, so restart it after you change `site/`.

## Environment Variables

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8080` | The port to listen on, on all interfaces (0.0.0.0). Railway sets it for you. |
| `SITE_PASSWORD` | unset | When set, every path except `/healthz` requires HTTP Basic Auth with this password. The browser shows a login box for the realm “Pacing Frontier AI”. |
| `SITE_USER` | `guest` | The Basic Auth user name. Used only when `SITE_PASSWORD` is set. |
| `SITE_NOINDEX` | unset | Set to `1` to keep search engines out. Every response then carries `X-Robots-Tag: noindex, nofollow`, and `robots.txt` disallows everything. |
| `SITE_URL` | unset | The public address, such as `https://pacing.example.org`. When set, and `SITE_NOINDEX` is off, `robots.txt` points to `/sitemap.xml`, which lists every page with absolute URLs. |

For a private review copy, set `SITE_PASSWORD` and `SITE_NOINDEX=1`. For a public site, leave both unset and set `SITE_URL`.

## What the Server Does

- Serves `/` as `index.html`, and a path with no extension as the same path plus `.html` (`/stop` serves `stop.html`). Unknown paths get `site/404.html` with status 404.
- Answers `GET` and `HEAD`. Other methods get 405. Paths that try to climb out of `site/` get 400.
- Compresses text files with gzip and brotli in memory at startup and sends whichever the browser accepts. Brotli finishes a few seconds after the server starts; until then, browsers get gzip.
- Sends an `ETag` with every file and answers a matching `If-None-Match` with 304.
- Caching: HTML gets `Cache-Control: no-cache`, so browsers check for a new version on every visit. CSS, JS and the search index get `max-age=3600`. With a password set, both also carry `private`.
- Security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a Permissions-Policy that turns off camera, microphone, geolocation, payment and USB, and a Content-Security-Policy with `frame-ancestors 'none'`. `Strict-Transport-Security` is added when the request arrived over HTTPS (Railway’s proxy sends `X-Forwarded-Proto: https`).
- The pages get a strict Content-Security-Policy. It allows this site’s own scripts and styles, the Google Fonts stylesheet and font files, `data:` images (two CSS icons) and the search index fetch, and nothing inline. Other responses (CSS, JS, JSON, SVG, `robots.txt`, plain-text replies) get a policy that blocks all scripts and allows only the inline styles and `data:` icons that Chrome’s own text and XML viewers add when someone opens such a file directly.
- `/healthz` returns 200 `ok` without a password, for Railway’s health check.
- Logs one line per request: time, client IP, method, path, status, bytes, duration and encoding.

If the pages ever load something from a new origin, add it to `buildCsp()` in `server.js`. Inline `<script>` and `<style>` blocks need no change: the server allows them by hash at startup.

## Deploy on Railway

### 1. The Repository

This folder is the private repository `bradrcarson/pacing-frontier`. Railway deploys its `main` branch, so every push to `main` redeploys the site.

### 2. Create the Service

1. In the Railway dashboard, click **New Project**, then choose **GitHub repo**.
2. If Railway asks, link your GitHub account and give the Railway GitHub app access to the repository.
3. Pick the repository. Choose **Add variables** so you can set the password before the first deploy. Choose **Deploy Now** for a public site.

Railway finds the `Dockerfile` at the root of the repository and builds it. Each push to the connected branch then deploys again.

### 3. Check the Health Check and Restart Settings

`railway.json` asks for the Dockerfile builder, a health check on `/healthz` with a 100-second timeout, and the On Failure restart policy with 10 retries.

Railway has deprecated these config files, which it calls Config as Code. As of October 2026 its documentation says new services cannot opt into them, and existing files stop being read on 2026-12-01. So in a new service, set the same values by hand. Open the service’s **Settings** and, in the deploy settings:

- set **Healthcheck Path** to `/healthz`;
- set **Restart Policy** to **On Failure**. On Failure with 10 retries is Railway’s default.

The Dockerfile needs no setting, because Railway uses a root `Dockerfile` automatically. Railway’s replacement for config files, Infrastructure as Code (`.railway/railway.ts`, applied with the Railway CLI), needs the `railway` npm package, and this repository does not use it.

### 4. Set the Variables

Open the service and choose the **Variables** tab. Add each variable with **New Variable**, or paste several at once in the **RAW Editor**:

```
SITE_PASSWORD=choose-a-long-password
SITE_USER=guest
SITE_NOINDEX=1
```

Variable changes are staged. Click **Deploy** to apply them. Do not set `PORT`; Railway provides it.

### 5. Give the Site an Address

- **Railway address.** In **Settings**, under **Networking**, find **Public Networking** and click **Generate Domain**. You get an address ending in `.up.railway.app`.
- **Custom domain.** In the same **Public Networking** section, click **+ Custom Domain** and enter the domain, such as `pacing.example.org`. Pick the port the app listens on when Railway offers a list. Railway then shows a `CNAME` record and a `TXT` record. Create both at your DNS provider exactly as shown; the domain will not verify with the `CNAME` alone. Railway issues a Let’s Encrypt certificate, usually within an hour of the DNS update, though DNS changes can take up to 72 hours to spread.
  - A root domain (`example.org` with no subdomain) needs a DNS provider that supports CNAME flattening or ALIAS records, such as Cloudflare.
  - If Cloudflare proxies the domain (orange cloud), set Cloudflare’s SSL/TLS mode to **Full**. Full (Strict) does not work here.
  - Railway allows 1 custom domain on the Trial plan, 2 per service on Hobby and 20 per service on Pro.
- After the domain works, set `SITE_URL` to it (for example `https://pacing.example.org`) so `robots.txt` and `sitemap.xml` use the right address.

### 6. Check the Deploy

```sh
curl -sI https://pacing.example.org/healthz            # 200, no password needed
curl -sI https://pacing.example.org/                   # 401 when SITE_PASSWORD is set
curl -sI -u guest:PASSWORD https://pacing.example.org/ # 200 with the security headers
curl -s https://pacing.example.org/robots.txt -u guest:PASSWORD
```

## Update the Content

The pages come from the microsite project (`/home/claude/microsite`), which is not part of this repository. Its `content/` folder holds the markdown, and `src/` holds the templates and assets.

1. Make the change in the microsite project.
2. From this folder, run `scripts/refresh.sh`. It runs the microsite build with `--preview`, removes `build-report.json`, copies `site/404.html` across, checks the result and replaces `site/`. If the microsite lives somewhere else, run `MICROSITE_DIR=/path/to/microsite scripts/refresh.sh`.
3. Run `npm start` and look over the site at http://localhost:8080.
4. Commit and push. Railway deploys the new version.

Notes:

- `site/404.html` is written by hand, so the build does not touch it. Edit it directly. It uses `<base href="/">` so its links and styles work at any depth.
- The social sharing description (the Open Graph and Twitter `description` tags) is fixed text in the microsite’s `src/templates/head.html`. The sharing title is each page’s own title.
- CSS, JS and the search index may stay in a browser’s cache for up to an hour after a deploy, while HTML updates at once. A change to the templates or scripts can take that long to reach every reader.
