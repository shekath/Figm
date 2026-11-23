# Figmy

Figmy is an open-source vector design and prototyping tool. It runs in the browser, as a Windows desktop app (Electron), and as a self-hostable server. The server adds real-time multiplayer and an MCP connector, so Claude, ChatGPT or any MCP client can design inside your files while you watch.

It was written from scratch. It contains no code, assets or branding from any proprietary design product. Figma files can be imported through Figma's public REST API.

## Features

| Area | What's included |
| --- | --- |
| **Canvas & tools** | Infinite canvas, rulers, pixel grid, outline mode, smart guides. Tools: frame, section, rectangle, ellipse, polygon, star, line, arrow, pen (bezier, point editing), pencil, text, image, comment |
| **Editing** | Resize/rotate/flip, corner radius handles, align/distribute/tidy, groups, masks, pages, layer tree with drag-reorder, copy/paste across files, undo/redo |
| **Boolean operations** | Union, subtract, intersect, exclude, flatten (`Ctrl+Alt+U/S/I/X`, `Ctrl+E`) with even-odd holes, works on any shapes, groups and rotated layers |
| **Layout** | Auto layout (direction, gap, padding, alignment, space-between, hug, wrap), constraints |
| **Components & variants** | Main components and synced instances. Component sets with variant properties (`State=Hover, Size=L`): combine as variants (`Ctrl+Alt+Shift+K`), add variants, rename properties/values. Instances swap variants from dropdowns and keep overrides by layer name. Boolean (show/hide), text and **instance-swap** component properties. **Nested instance overrides** at any depth: swap a nested instance, switch its variant, set its properties, visibility or text. Each nested copy is independent, detach keeps the overrides, and swaps that would make a component contain itself are blocked. Assets panel |
| **Interactive components** | A "Change to" prototype action switches an instance to another variant on click, hover (reverts on leave), press, mouse enter/leave, key or after delay, with Smart Animate between variants. Works in the presenter and in exported HTML |
| **Variables** | Collections, colour/number/string/boolean variables, unlimited modes (Light/Dark, brands, breakpoints), bind fill, stroke, radius, opacity, gap, padding, size, text, font size and visibility; per-frame mode overrides |
| **Styles** | Multiple fills (solid/linear/radial/image), strokes, shadows, blurs, blend modes; colour, text and effect styles |
| **Prototyping** | Triggers: click, hover, press, mouse enter/leave, after delay, key press. Actions: navigate, open/swap/close overlay, scroll to, back, open URL. Animations: instant, dissolve, **Smart Animate** (matches layers by name; also between component variants), move in/out, push, slide in/out with direction. Easing: linear, ease in/out, back, gentle/quick/bouncy springs. Scrolling frames with fixed layers |
| **Real-time multiplayer** | Live cursors, selections, avatars, follow mode, share links, per-user undo (never reverts other people's work), offline edits re-applied on reconnect |
| **AI connector (MCP)** | 26 design tools (read outline/selection, create/update/delete layers from JSON specs, booleans, components, variants, component properties, variables, prototype links including interactive components, export HTML/SVG). Works over Streamable HTTP and stdio; AI edits show up live with a ✦ AI cursor |
| **Import** | Figma files through the official REST API (link + personal access token), or saved REST JSON: vectors, images, auto layout, text, effects, styles, prototype links. SVG and images by drag & drop or paste |
| **Export** | PNG/JPG at any scale, SVG, multi-page PDF, and **design → HTML**: one self-contained file with flexbox for auto layout, real text, inline SVG, embedded images, plus an optional prototype runtime (navigation, transitions, overlays, hover/press/key/delay triggers) |
| **Inspect / dev mode** | Measurements, CSS and JSX snippets |
| **Accounts** | Sign in with Google (server-verified sessions, optional required login and domain/email allow-lists; desktop signs in through the system browser). Collaborators show your Google name |
| **Files** | Home screen with recents, autosave (IndexedDB), `.figmy` files, native dialogs on desktop, version history, comments |

## Quick start

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Then open http://localhost:4317. `npm start` serves the web app, collaboration (`/collab`) and the MCP connector (`/mcp`) from one process, and saves files in `~/.figmy`.

Other ways to run it:

| Command | What it does |
| --- | --- |
| `npm run dev` | Web app with hot reload (local only, no server features) |
| `npm run dev:server` | Server with auto-reload; run alongside `npm run dev` |
| `npm run electron:dev` | Desktop app with hot reload |
| `npm run electron:build` | Windows installer + portable `.exe` in `release/` (run on Windows; CI builds it too) |
| `docker build -t figmy . && docker run -p 4317:4317 -v figmy:/data -e FIGMY_TOKEN=secret figmy` | Host the server |

The desktop app starts the server automatically on `127.0.0.1:4317`, so collaboration on your machine and the AI connector work with no setup.

### Server options

`node server-dist/server.cjs [--port 4317] [--host 127.0.0.1] [--data DIR] [--static dist] [--token SECRET] [--public-url URL]`

- `--token` (or `FIGMY_TOKEN`) requires `Authorization: Bearer <token>` (or `?token=`) for the API, MCP and WebSocket. Always set it when the server is reachable from other machines.
- The server binds to `127.0.0.1` by default. Use `--host 0.0.0.0` to share it on your network.

## Always-on in Cloudflare (Containers)

This runs the full server (editor, collaboration, AI connector, Google sign-in) on Cloudflare itself, so no machine of yours has to stay on. A Worker on your domain sends every request, including WebSockets, to one Figmy container. The container's disk is wiped when it restarts, so all files and sign-in sessions are backed up to **R2** and restored on start. The container sleeps after `SLEEP_AFTER` (default 2h) without visitors and wakes on the next request; the first load after a sleep takes a few seconds.

You need the **Workers Paid** plan (Containers and R2 are billed by usage).

1. **R2 bucket.** In R2, create a bucket named `figmy-data`. Then go to R2 → *Manage API tokens* → create a token with **Object Read & Write** on that bucket and copy its access key ID and secret.
2. **API token.** In My Profile → API Tokens, create a token from the **Edit Cloudflare Workers** template, and add **Containers: Edit** if it's listed separately.
3. **GitHub secrets** (Settings → Secrets and variables → Actions → Secrets): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FIGMY_TOKEN` (a long random string), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
4. **GitHub variables** (Variables tab): `FIGMY_CONTAINER` = `1`, and `FIGMY_SERVER_URL` = e.g. `https://app.example.com`. Optionally add `GOOGLE_CLIENT_ID`, `REQUIRE_LOGIN` (default `1`), `ALLOWED_DOMAINS`, `ALLOWED_EMAILS` and `R2_BUCKET`.
5. **Deploy.** Run **Deploy server to Cloudflare Containers** in the Actions tab (it also runs on every push once enabled).
6. **Your domain.** In Workers & Pages → **figmy** (the Worker) → Settings → Domains & Routes → *Add custom domain*, enter `app.example.com`. If a Tunnel already uses that hostname, remove the Tunnel's public hostname first.

The AI connector address is `https://app.example.com/mcp`, with the header `Authorization: Bearer <FIGMY_TOKEN>`. To make the Pages site use this server, set the `FIGMY_SERVER_URL` variable and redeploy Pages.

Any S3-compatible host works for backups via `FIGMY_S3_ENDPOINT`, `FIGMY_S3_BUCKET`, `FIGMY_S3_ACCESS_KEY_ID` and `FIGMY_S3_SECRET_ACCESS_KEY`, so you can also use this with Docker anywhere.

## Sign in with Google

Figmy can sign people in with their Google account. On a Figmy server (`npm start`, Docker, or the desktop app's built-in server), the browser gets a Google-signed ID token. The server checks its signature against Google's published keys, then checks the audience, issuer, expiry, verified email and your allow-lists, and creates a 30-day session. No client secret is needed.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create **OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add every address people open Figmy at, for example `http://localhost:4317`, `https://figmy.example.com` and `https://<user>.github.io`. Use `localhost`, not `127.0.0.1`.
3. Start the server with the client ID:

```bash
FIGMY_GOOGLE_CLIENT_ID=1234.apps.googleusercontent.com FIGMY_REQUIRE_LOGIN=1 FIGMY_ALLOWED_DOMAINS=example.com npm start
```

| Variable | Meaning |
| --- | --- |
| `FIGMY_GOOGLE_CLIENT_ID` | Turns on "Sign in with Google" |
| `FIGMY_REQUIRE_LOGIN=1` | The editor, API, collaboration and MCP need a signed-in user. `--token` / `FIGMY_TOKEN` still works for AI clients. |
| `FIGMY_ALLOWED_DOMAINS` | Comma-separated list, e.g. `example.com`. Only these Google Workspace domains or email domains may sign in. |
| `FIGMY_ALLOWED_EMAILS` | Comma-separated list of individual addresses that may sign in |

- **Desktop app:** Google doesn't allow sign-in inside embedded app windows, so **Continue with Google** opens your normal browser at `http://localhost:4317/login`, and the app picks up the session when you're done. Configure it with the same environment variables, or with `<userData>/config.json`: `{ "googleClientId": "…", "requireLogin": true, "allowedDomains": ["example.com"] }`.
- **GitHub Pages / static hosting:** set the repository variable `GOOGLE_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables). The Pages workflows build it in as `VITE_GOOGLE_CLIENT_ID`. Without a server, sign-in only sets your name and avatar; it can't protect files.

## Deploying on your own domain (Cloudflare)

There are two options. You can use both together, for example `figmy.example.com` on Pages and `app.example.com` through a Tunnel.

### A. Web app on Cloudflare Pages (static)

`.github/workflows/cloudflare-pages.yml` builds the app and deploys it with Wrangler.

1. Create an API token in Cloudflare (My Profile → API Tokens) with the **Cloudflare Pages: Edit** permission. Copy your **Account ID** from the dashboard.
2. In GitHub, go to Settings → Secrets and variables → Actions. Add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Optionally add the variables `CLOUDFLARE_PAGES_PROJECT` (default `figmy`), `GOOGLE_CLIENT_ID` and `FIGMY_SERVER_URL`.
3. Push, or run the workflow manually. The first run creates the Pages project.
4. In Cloudflare, go to Workers & Pages → **figmy** → **Custom domains** → *Set up a custom domain* and enter e.g. `figmy.example.com`. Your DNS is already on Cloudflare, so the record and certificate are created automatically.

The Pages site on its own has no server. To get collaboration, the AI connector and verified Google sign-in, also run option B, then set `FIGMY_SERVER_URL` to its address and redeploy.

### B. Full server through a Cloudflare Tunnel

This runs the complete app (editor, collaboration, MCP, Google sign-in) on any machine or VPS with Docker. No ports need opening.

1. In Cloudflare, go to Zero Trust → Networks → **Tunnels** → *Create a tunnel* (Cloudflared) and copy the token.
2. In the tunnel, add a **Public hostname**, e.g. `app.example.com`, pointing to service `HTTP` → `figmy:4317`. WebSockets work through tunnels with no extra settings.
3. Copy the example env file:

   ```bash
   cp .env.example .env
   ```

   Then fill in `CLOUDFLARE_TUNNEL_TOKEN`, `PUBLIC_URL=https://app.example.com` and a long random `FIGMY_TOKEN`. Optionally add the Google sign-in variables.
4. Start it:

   ```bash
   docker compose up -d
   ```

5. AI connectors (Claude.ai, ChatGPT, Claude Code) use `https://app.example.com/mcp` with the header `Authorization: Bearer <FIGMY_TOKEN>`.

For Google sign-in, add each domain (e.g. `https://figmy.example.com`, `https://app.example.com`) to the OAuth client's **Authorized JavaScript origins**.

## Real-time collaboration

1. Open a file in an editor that can reach a Figmy server: the desktop app, or the web app served by `npm start`. It goes live automatically (green dot in the toolbar).
2. Click **Share** and copy the link (`…/?room=<id>`). Everyone who opens it edits the same file live.
3. Click an avatar to follow that person's viewport.

Sync works per layer, last writer wins, and the server sets the order of edits. Each client holds back incoming changes to layers it has edited but the server hasn't confirmed yet, so every client converges to the same document. The e2e suite checks this.

## Connect Claude or ChatGPT (MCP)

The MCP endpoint is `http://localhost:4317/mcp` (Streamable HTTP, stateless). In the editor, **Share → Connect AI** shows ready-to-copy settings.

**Claude Code:**

```bash
claude mcp add --transport http figmy http://localhost:4317/mcp
```

**Claude Desktop:** add this to `claude_desktop_config.json`. The stdio bridge uses a running server, or starts one if none is reachable.

```json
{
  "mcpServers": {
    "figmy": { "command": "node", "args": ["/path/to/figmy/server-dist/server.cjs", "--stdio"] }
  }
}
```

**Claude.ai custom connectors and ChatGPT connectors (developer mode):** these run in the cloud, so they need a public HTTPS URL.
1. Host the server (see the Docker command above), or expose a local one with a tunnel such as `cloudflared tunnel --url http://localhost:4317`.
2. Start the server with `--token`.
3. Add `https://<host>/mcp` as a custom connector.

Example prompt:

> In my open Figmy file, design a mobile sign-in screen with an email field, password field and gradient button using auto layout, add a Home screen, and link the button to it with smart animate.

Main tools: `get_started`, `list_files`, `create_file`, `get_file_outline`, `get_nodes`, `get_selection`, `create_nodes`, `update_nodes`, `delete_nodes`, `duplicate_nodes`, `group_nodes`, `boolean_operation`, `create_component`, `create_instance`, `combine_as_variants`, `add_variant`, `add_component_property`, `set_instance_properties`, `create_page`, `set_variables`, `bind_variable`, `set_variable_mode`, `add_interaction`, `export_html`, `export_svg`, `focus_nodes`.

The same tools are available as REST for scripts: `GET /api/tools`, and `POST /api/tools/<name>` with a JSON body.

## Importing from Figma

**Home → Import from Figma** (or **File → Import from Figma…**):
1. Paste a `figma.com/design/…` link.
2. Paste a personal access token (Figma → Settings → Security, with the `file_content:read` scope). The token stays in the browser session; when the browser can't reach Figma directly, the request goes through your own Figmy server.

The import covers vector geometry, image fills, gradients, effects, text styles, auto layout, constraints, components, component sets and variants, boolean/text/instance-swap component properties, fill styles, scroll behaviour and prototype interactions (including Change to). You can also import a saved REST API JSON response.

Instances without overrides stay linked to their main component, including their property values. Instances with overrides are imported as editable frames, so they look exactly like the original. Binary `.fig` files are not supported: the format is private and undocumented.

## Tests

| Command | What it does |
| --- | --- |
| `npm test` | 79 unit tests: Google sign-in token checks and sessions, sync/repair, booleans, variables, variants/component properties/nested overrides, Figma conversion, node specs, HTML export, animation maths, store, MCP tools |
| `npm run test:e2e` | Starts a temporary server and drives the real UI in Chromium: drawing, booleans, variables, overlays, export, variants and interactive components, two-browser collaboration, every kind of MCP edit, the stdio bridge, and the Google sign-in gate |

CI (`.github/workflows/build.yml`) runs type-checks, the build, unit tests and e2e tests, and builds the Windows installer on a Windows runner.

## Project layout

```
electron/          Electron main (embedded server, native menus/dialogs) + sandboxed preload
server/            HTTP server: WebSocket rooms, MCP (HTTP + stdio), REST tools, Figma proxy, static hosting
src/
  store/           Zustand + immer editor store: document model, undo/redo, change feed
  collab/          Collaboration client, presence UI, share/AI dialogs, server discovery
  canvas/          SVG renderer, hit-testing, interactive canvas, overlays
  panels/          Toolbar, layers/assets, design/prototype/inspect, variables, import/export dialogs
  lib/             Geometry, layout, booleans, variables, Figma import, HTML export, node specs, prototype maths
  Presenter.tsx    Prototype player (smart animate, overlays, scrolling)
tests/             Unit (vitest) and e2e (Playwright) suites + Figma REST fixture
```

## Known limits

- Smart Animate interpolates position, size, rotation, opacity, corner radius, solid colours and font size. It does not morph vector point data.
- Nested overrides cover component swaps, variant/properties, text, visibility and fill; other style overrides on nested layers are applied but not yet editable from the panel.
- Text sizes computed on the server for AI-created text use an estimate; the editor renders the real font.
- Background blur is exported to HTML/CSS but not drawn on the canvas.

## License

MIT

## Export to Figma

Figmy files move into Figma as native, editable layers through the bundled plugin:

1. In Figmy, use **Export → Figma** (or the command palette, “Export for Figma…”). This saves a `.figmy` file.
2. In Figma desktop, go to **Plugins → Development → Import plugin from manifest…** and pick `figma-plugin/manifest.json`. You only do this once.
3. Run **Figmy Importer** and choose the `.figmy` file.

The plugin rebuilds these as native Figma layers:
- pages, frames, auto layout and constraints
- shapes, vectors, text, images, fills, strokes and effects
- components, variant sets and component properties (boolean, text, instance swap)
- instances, including nested overrides
- prototype links and variables

Anything it can't convert is listed when the import finishes.
