# Frame.io LUT Action Service

Apply color grading LUTs to video assets directly inside [Frame.io](https://frame.io). Right-click any video (or select multiple), pick a LUT from a visual preview grid, and get graded versions uploaded as new asset versions — no round-tripping through an NLE.

## Features

- **Multi-asset support** — select multiple videos and grade them all in one action
- **Visual LUT preview** — see how every LUT looks on your footage before committing
- **Version stacking** — processed videos are uploaded as v2 of the original, with built-in "Compare versions" support
- **Progress notifications** — real-time Frame.io comments at each processing stage
- **Official Frame.io SDK** — uses the `frameio` TypeScript SDK for reliable API interactions
- **FFmpeg processing** — `.cube` LUT application with `lut3d` filter
- **Secure webhooks** — HMAC-SHA256 signature verification

## Prerequisites

- **Node.js 20+**
- **FFmpeg** with `lut3d` filter support (`brew install ffmpeg` on macOS)
- **ngrok** for local development (`brew install ngrok`)
- **Frame.io account** with access to the [Adobe Developer Console](https://developer.adobe.com/console)

---

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Frame.io API project

1. Go to the [Adobe Developer Console](https://developer.adobe.com/console)
2. Create a new project and add the **Frame.io API**
3. Under **OAuth User Authentication**, note your **Client ID** and **Client Secret**
4. Add a redirect URI — you'll update this to your ngrok URL later

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Your ngrok URL (set after starting ngrok in step 5)
PUBLIC_URL=https://your-subdomain.ngrok-free.dev

# From the Adobe Developer Console
FRAMEIO_CLIENT_ID=your_client_id
FRAMEIO_CLIENT_SECRET=your_client_secret

# Will be set after registering the custom action (step 8)
FRAMEIO_WEBHOOK_SECRET=

# Must be at least 32 characters
JWT_SECRET=generate-a-long-random-string-here

# Where to store temp downloads, processed files, and LUT registry
# (created automatically if it doesn't exist)
TMP_DIR=~/tmp/frameio-lut
```

### 4. Import LUTs

The repo includes a sample `.cube` LUT file. Import it into the registry:

```bash
npm run import:luts luts/
```

You can also import your own LUTs from any directory:

```bash
npm run import:luts ~/path/to/your/LUTs
```

### 5. Start ngrok

```bash
ngrok http 8080
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.dev`) and:
- Set `PUBLIC_URL` in `.env` to this URL
- Update the **Redirect URI** in the Adobe Developer Console to `https://abc123.ngrok-free.dev/auth/callback`

### 6. Start the dev server

```bash
npm run dev
```

The server starts on `http://localhost:8080`. Verify it's working:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/luts
```

### 7. Authenticate with Frame.io

Open your browser to:

```
http://localhost:8080/auth/authorize
```

This redirects to Adobe IMS for OAuth. After authorizing, the token is saved to `.frameio-token`.

### 8. Register the custom action

```bash
# Get your account/workspace info first
npm run frameio:info

# Register the action
npm run register:action
```

The registration script outputs a **webhook secret** — copy it into `FRAMEIO_WEBHOOK_SECRET` in `.env` and **restart the dev server** (`tsx watch` doesn't reload env vars automatically).

After registration, go to [Frame.io Settings > Actions](https://next.frame.io/settings/actions) and toggle **Multi-asset** on for the action if you want to process multiple videos at once.

### 9. Use it

1. Go to your Frame.io workspace
2. Right-click a video (or select multiple) → choose **Apply LUT**
3. Optionally click the preview link to see how each LUT looks on your footage
4. Select a LUT from the dropdown and submit
5. Watch the progress comments appear, then refresh to see the new version

---

## Deploying to a Cloud Service

The service ships with a `Dockerfile` that handles everything: installing FFmpeg, building the TypeScript, and importing the bundled LUTs. It works with any Docker-based hosting platform (Railway, Render, Fly.io, etc.).

A `nixpacks.toml` is also included as an alternative for platforms that use Nixpacks (like Railway) — both work.

### Railway (step-by-step)

#### 1. Create a Railway project

1. Sign up at [railway.app](https://railway.app) and create a new project
2. Choose **Deploy from GitHub repo** and connect this repository

Railway will auto-detect the Dockerfile and start a build.

#### 2. Configure environment variables

In the Railway service settings, add these variables:

| Variable | Value |
|---|---|
| `PUBLIC_URL` | Your Railway service URL (e.g. `https://your-app.up.railway.app`) |
| `FRAMEIO_CLIENT_ID` | From Adobe Developer Console |
| `FRAMEIO_CLIENT_SECRET` | From Adobe Developer Console |
| `FRAMEIO_WEBHOOK_SECRET` | Set after custom action registration (step 5) — use a 32+ char placeholder initially |
| `JWT_SECRET` | A random string, 32+ characters |
| `NODE_ENV` | `production` |
| `LOG_PRETTY` | `false` |

Optional S2S auth (recommended for production — avoids token expiry):

| Variable | Value |
|---|---|
| `FRAMEIO_S2S_CLIENT_ID` | S2S client ID from Adobe Developer Console |
| `FRAMEIO_S2S_CLIENT_SECRET` | S2S client secret |
| `FRAMEIO_S2S_ORG_ID` | Your Adobe org ID |

> **Note:** You need either User OAuth (`FRAMEIO_CLIENT_ID` + `FRAMEIO_CLIENT_SECRET`) or S2S OAuth (`FRAMEIO_S2S_*`) configured — at least one is required.

#### 3. Deploy

Push to your linked branch. Railway auto-builds and deploys. The Dockerfile:
- Installs Node.js 20 and FFmpeg (with `lut3d` support)
- Runs `npm ci`, `tsc`, and imports the bundled LUTs
- Prunes dev dependencies for a smaller image
- Runs a health check on `/health`

Verify the deployment:

```bash
curl https://your-app.up.railway.app/health
curl https://your-app.up.railway.app/luts
```

#### 4. Update the Redirect URI

In the Adobe Developer Console, update the **Redirect URI** to:

```
https://your-app.up.railway.app/auth/callback
```

#### 5. Register the custom action

Set `PUBLIC_URL` in your **local** `.env` to the Railway URL, then run:

```bash
npm run register:action
```

Copy the webhook secret from the output and set `FRAMEIO_WEBHOOK_SECRET` in Railway's environment variables. Railway will auto-redeploy.

#### 6. Authenticate

Visit `https://your-app.up.railway.app/auth/authorize` to complete the OAuth flow.

For production, use S2S auth instead — set the `FRAMEIO_S2S_*` variables and the service handles token management automatically.

### Other platforms (Render, Fly.io, etc.)

The `Dockerfile` is platform-agnostic. The general steps are:

1. Point the platform at this repo
2. Set the environment variables from the table above
3. Ensure port `8080` is exposed
4. Deploy — the Dockerfile handles FFmpeg, build, and LUT import

### Docker (local or self-hosted)

If you don't want to install Node.js or FFmpeg on your machine, you can run everything in Docker. The Dockerfile handles all dependencies.

```bash
cp .env.example .env
# Fill in .env with your Frame.io credentials and ngrok URL
```

Then start the service:

```bash
# Option A: Docker Compose (recommended)
docker-compose up --build

# Option B: Build and run directly
docker build -t lut-action .
docker run -p 8080:8080 --env-file .env lut-action
```

The image includes FFmpeg and all bundled LUTs. The service starts on `http://localhost:8080`.

You'll still need ngrok running on your host machine for the OAuth callback and webhook delivery — the rest runs entirely inside the container.

---

## Architecture

```
Frame.io Custom Action
        ↓
  Webhook (HMAC verified)
        ↓
  LUT selection form + preview link
        ↓
  Per-asset background jobs (in-memory)
        ↓
  Download → FFmpeg LUT → Upload → Version Stack
        ↓
  Progress comments + completion notification
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /auth/authorize` | Initiate OAuth flow |
| `GET /auth/callback` | OAuth callback |
| `POST /webhooks/frameio/custom-action` | Custom action webhook |
| `GET /preview?accountId=...&assetId=...` | Visual LUT preview page |
| `GET /luts` | List available LUTs |
| `GET /jobs/:id` | Job status |
| `GET /health` | Health check |

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Compile TypeScript + import LUTs |
| `npm start` | Production server |
| `npm run import:luts <dir>` | Import `.cube` LUT files |
| `npm run register:action` | Register custom action with Frame.io |
| `npm run frameio:info` | Print account/workspace info |
| `npm run test:lut` | Test LUT processing with a manual webhook |

## Adding Custom LUTs

Drop any `.cube` LUT files into the `luts/` directory, then run:

```bash
npm run import:luts luts/
```

The service will pick them up and include them in the LUT selection dropdown.

## Troubleshooting

**Webhook signature verification failed** — restart the dev server after updating `FRAMEIO_WEBHOOK_SECRET` in `.env`. The `tsx watch` process doesn't reload env vars automatically.

**OAuth callback fails / token not saved** — make sure the Redirect URI in the Adobe Developer Console matches your current ngrok or production URL exactly (including `https://`).

**FFmpeg not found** — install with `brew install ffmpeg` (macOS) or `apt-get install ffmpeg` (Linux). Verify with `ffmpeg -version`.

**Preview page errors** — clear the preview cache: `rm -rf ~/tmp/frameio-lut/processing/previews/`

**LUTs showing count 0** — run `npm run import:luts luts/` and check with `curl http://localhost:8080/luts`.

**Railway build fails with env validation** — the Dockerfile sets placeholder env vars for the build phase. If using Nixpacks, the `nixpacks.toml` handles this too. Make sure you haven't removed those placeholders.

## License

MIT
