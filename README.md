# Media Utils

A growing set of tools to package and prepare content for social media and production. Built with Next.js on Vercel; domain: [media-utils.com](https://media-utils.com).

## Tools

| Route | Purpose |
|-------|---------|
| `/clipper` | Trim video from an allowlisted URL or a private `uploads/` file; export MP4 to `clips/`; optional transcription; **Vertical 9:16** mode |
| `/reframe` | Reframe landscape video to 9:16 (1080×1920) with adjustable crop; same upload/URL sources as the clipper |
| `/images` | Upload images to `images/`; labels, tags, and sheet copy for the DealBook calendar |
| `/file-browser` | Browse recent clips and images from Blob; copy links or delete assets |
| `/social-post-preview` | Build Instagram and X mockups, create named share links, manage share history |
| `/preview/<id>` | View-only review page for a share link (mockups + team comments). Not in the sidebar |

Internal routes (`/`, `/clipper`, `/reframe`, `/images`, `/file-browser`, `/social-post-preview`) are meant to sit behind **Cloudflare Zero Trust**. Share links at `/preview/<id>` are for reviewers; editors who pass Access may see **Edit Preview** in the header (see **Access** below).

## Repository layout

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router. Each tool is a route at `/<slug>` (`app/<slug>/page.tsx`); API routes under `app/api/` |
| `components/` | Shared UI (ShadCN in `components/ui/`) and per-tool components (`components/<slug>/`) |
| `lib/` | Shared logic. `lib/tools.ts` is the tool registry; `lib/media/` holds ffmpeg, Sandbox, and transcription helpers |
| `scripts/` | CLI helpers (`try:*`, `sandbox:snapshot`) |
| `workspaces/<name>/` | Content and tooling for one show or client. Currently `workspaces/dealbook/` |

### Adding a tool

1. Add an entry to `lib/tools.ts` in the right `toolGroups` section (slug, title, description, icon). It shows up in the sidebar and dashboard.
2. Create `app/<slug>/page.tsx` and put its components in `components/<slug>/`.
3. Put any server routes under `app/api/`.

### DealBook workspace

| Path | Purpose |
|------|---------|
| `workspaces/dealbook/source/` | Content calendar CSV, research HTML, sheet manifest |
| `workspaces/dealbook/data/` | JSON generated from the CSV (`pnpm dealbook:build:data`) |
| `workspaces/dealbook/scripts/` | Sheet sync and JSON build |
| `workspaces/dealbook/lib/` | Calendar parse/build helpers used by those scripts |
| `workspaces/dealbook/schema/` | Post / platform-variant JSON Schema |
| `workspaces/dealbook/media/` | Local media library (gitignored; see its README) |

## Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Clip and transcribe run ffmpeg in [Vercel Sandbox](https://vercel.com/docs/sandbox). Environment variables live in the Vercel project; pull them into `.env.local`. A pull rewrites the whole file, so re-add any values you set only locally (such as `AI_GATEWAY_API_KEY`) afterwards. Transcription uses [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) (`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` on deployed builds):

```bash
vercel env pull .env.local   # project env (Development target) + Sandbox auth token, ~12 h
pnpm try:transcribe '<url>' 60 120   # extract + transcribe a range from the CLI
pnpm try:clip '<url>' 60 120 team    # export a clip (team | copy) and print the public download URL
```

Blob: private **`media-utils`** for source uploads (`BLOB_STORE_ID` + OIDC; client uploads use presigned URLs); public **`media-utils-clips-public`** for exported clips, images, and social preview data (`BLOB_READ_WRITE_TOKEN`). Mimir URLs are read directly in Sandbox. Local files upload to private `uploads/` (up to 5 GB); public prefixes are `clips/`, `images/`, and `previews/<id>/` (post JSON + review comments). Nothing is deleted automatically.

### Access (Cloudflare Zero Trust)

Production assumes **Cloudflare Access** on the main app (hostname **proxied** through Cloudflare, not DNS-only to Vercel). Only `/preview/<id>` and the preview comments API are public; see **`docs/cloudflare-access.md`** for application layout and troubleshooting. Production also enforces Access identity headers in **`proxy.ts`** (set `SKIP_CLOUDFLARE_ACCESS=1` on Vercel only for emergencies).

Authenticated requests include identity headers (`cf-access-authenticated-user-email`, etc.). **`lib/media-utils-admins.ts`** decides who counts as an editor:

- **`jcottam@gmail.com`** is always an admin in code.
- Optional **`MEDIA_UTILS_ADMIN_EMAILS`** (comma-separated on Vercel): when set, only those emails plus the core admin get editor affordances; when unset, anyone who passes Access is an admin.

On `/preview/<id>`, admins see **Edit Preview** → `/social-post-preview?edit=<id>`. Local `pnpm dev` does not send Access headers unless you route through Access.

### Video clipper (`/clipper`)

See CLI helpers above (`pnpm try:clip`, `pnpm try:transcribe`). Exported clips use the public store under `clips/<uuid>/`. Labels and sheet copy work the same as images (`PUT /api/labels`, `lib/sheet-format.ts`).

### Image uploader (`/images`)

Upload JPG, PNG, WebP, GIF, or HEIC images (up to 50 MB each) by drag and drop, file picker, or paste. Each one gets a public link that keeps its original filename (`images/<id>/_DSC0457.jpg`), and the page lists everything under `images/` with copy and delete buttons. Files go straight from the browser to Blob ([client uploads](https://vercel.com/docs/vercel-blob/client-upload)), so the Function body limit doesn't apply. `/api/images/upload` only issues upload tokens; `/api/images` lists and deletes.

**Labels and sheet copy.** Images and clips take an optional label, such as the original Mjoll path or "Title slide". **Copy for sheet** copies text for the content calendar's "Source w/ timestamps" column, one line per asset:

```text
Title slide: https://…/images/…/_DSC0457.jpg
Musk quote (00:04:55–00:05:17): https://…/clips/…/clip.mp4
"I have no problem being hated…"
```

In the image uploader, select the images for a post (a fresh upload batch is selected for you) and copy them together. In the clipper, the transcript line is optional. The clipboard also carries a one-cell HTML version, so pasting onto a selected Sheets cell keeps every line in that cell. Blob has no custom metadata, so a label is stored as a small `label-<base64url>.txt` blob next to its asset (`PUT /api/labels`); format lives in `lib/sheet-format.ts`.

**Tags and sort.** Each image can also take one free-text tag, such as "Post 1", to group photos by post. Tags are only for organizing the page and aren't included in sheet copy. The library sorts by **Newest first** (default) or **Tag (A–Z)**, which orders tags naturally ("Post 2" before "Post 10") and puts untagged images last. A tag is a `tag-<base64url>.txt` blob next to the image, saved with `PUT /api/images/tag`; clearing the field removes it.

Blob setup (once per Vercel project):

1. Vercel dashboard → **Storage** → **Create** → **Blob**, name it `media-utils-clips-public`, access **Public**. Skip this if the store already exists.
2. Open the store → **Connect Project** → `media-utils`, all environments. This adds `BLOB_READ_WRITE_TOKEN`. If another store already owns that variable, disconnect it or use a custom prefix for the other store.
3. Redeploy so the new variable and the `next/image` allowlist for the store's host are picked up at build time.
4. Locally: `vercel env pull .env.local`.

Deleted images can stay in the CDN cache for up to a minute.

### File browser (`/file-browser`)

Read-only view of public Blob assets: exported MP4s under `clips/` and uploads under `images/`, newest first. Uses `GET /api/clips` and `GET /api/images` (same listings as the social post preview picker). Requires **`BLOB_READ_WRITE_TOKEN`** on the `media-utils-clips-public` store. Copy link, open in a new tab, edit labels (`PUT /api/labels`), or delete (`DELETE /api/images` and `DELETE /api/clips` remove the file and any label or tag sidecars in its folder).

### Social post preview (`/social-post-preview`)

Assemble media and per-platform copy, preview Instagram feed and X cards, then **Create share link** (internal name stays private). Share URLs use the current site origin (`/preview/<id>`; `lib/social-post-preview/share-url.ts` — localhost in dev, production domain when deployed). Saving again updates the same link; newest `post-<timestamp>.json` in `previews/<id>/` wins.

- **Share history:** copy, edit, open team view, delete.
- **Media:** upload or pick from existing `images/` and `clips/` in the public store.
- **Profiles:** mockup handles/avatars come from workspace config (`workspaces/dealbook/social-profile.ts` via `lib/social-profiles.ts`); keep tool code workspace-agnostic.
- **Team view** (`/preview/<id>`): mockups only; floating **Comments** control opens a sheet to read and post feedback (name required). Comments are `comment-<timestamp>.json` beside the post in Blob; API: `/api/social-post-preview/[id]/comments`.

API routes under `/api/social-post-preview` require the public Blob store (same as images/clips).

`.env.example` lists the variables. To rebuild the ffmpeg snapshot, run `pnpm sandbox:snapshot` and update `FFMPEG_SNAPSHOT_ID` in Vercel.

## DealBook commands

```bash
pnpm dealbook:sync         # Google Sheet → source/content-calendar.csv + data/*.json
pnpm dealbook:build:data   # regenerate data/*.json from source/
```

Sheet manifest: **`workspaces/dealbook/source/calendar-source.json`**. Details in **`AGENTS.md`**.

## Checks

```bash
pnpm check   # lint, typecheck, DealBook calendar tests, Vitest for lib/ and app/ routes
```

## Deploy

The Next.js app deploys to Vercel from `main`.
