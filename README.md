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
| **Components** | Main components, synced instances, text overrides, detach, assets panel |
| **Variables** | Collections, colour/number/string/boolean variables, unlimited modes (Light/Dark, brands, breakpoints), bind fill, stroke, radius, opacity, gap, padding, size, text, font size and visibility; per-frame mode overrides |
| **Styles** | Multiple fills (solid/linear/radial/image), strokes, shadows, blurs, blend modes; colour, text and effect styles |
| **Prototyping** | Triggers: click, hover, press, mouse enter/leave, after delay, key press. Actions: navigate, open/swap/close overlay, scroll to, back, open URL. Animations: instant, dissolve, **Smart Animate** (matches layers by name), move in/out, push, slide in/out with direction. Easing: linear, ease in/out, back, gentle/quick/bouncy springs. Scrolling frames with fixed layers |
| **Real-time multiplayer** | Live cursors, selections, avatars, follow mode, share links, per-user undo (never reverts other people's work), offline edits re-applied on reconnect |
| **AI connector (MCP)** | 22 design tools (read outline/selection, create/update/delete layers from JSON specs, booleans, components, variables, prototype links, export HTML/SVG). Works over Streamable HTTP and stdio; AI edits show up live with a ✦ AI cursor |
| **Import** | Figma files through the official REST API (link + personal access token), or saved REST JSON: vectors, images, auto layout, text, effects, styles, prototype links. SVG and images by drag & drop or paste |
| **Export** | PNG/JPG at any scale, SVG, multi-page PDF, and **design → HTML**: one self-contained file with flexbox for auto layout, real text, inline SVG, embedded images, plus an optional prototype runtime (navigation, transitions, overlays, hover/press/key/delay triggers) |
| **Inspect / dev mode** | Measurements, CSS and JSX snippets |
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

Main tools: `get_started`, `list_files`, `create_file`, `get_file_outline`, `get_nodes`, `get_selection`, `create_nodes`, `update_nodes`, `delete_nodes`, `duplicate_nodes`, `group_nodes`, `boolean_operation`, `create_component`, `create_instance`, `create_page`, `set_variables`, `bind_variable`, `set_variable_mode`, `add_interaction`, `export_html`, `export_svg`, `focus_nodes`.

The same tools are available as REST for scripts: `GET /api/tools`, and `POST /api/tools/<name>` with a JSON body.

## Importing from Figma

**Home → Import from Figma** (or **File → Import from Figma…**):
1. Paste a `figma.com/design/…` link.
2. Paste a personal access token (Figma → Settings → Security, with the `file_content:read` scope). The token stays in the browser session; when the browser can't reach Figma directly, the request goes through your own Figmy server.

The import covers vector geometry, image fills, gradients, effects, text styles, auto layout, constraints, components, fill styles, scroll behaviour and prototype interactions. You can also import a saved REST API JSON response.

Instances are imported as editable frames, so they look exactly like the original. Binary `.fig` files are not supported: the format is private and undocumented.

## Tests

| Command | What it does |
| --- | --- |
| `npm test` | 44 unit tests: sync/repair, booleans, variables, Figma conversion, node specs, HTML export, animation maths, store, MCP tools |
| `npm run test:e2e` | Starts a temporary server and drives the real UI in Chromium: drawing, booleans, variables, overlays, export, two-browser collaboration, every kind of MCP edit, and the stdio bridge |

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
- Variants and interactive component states are not implemented yet.
- Text sizes computed on the server for AI-created text use an estimate; the editor renders the real font.
- Background blur is exported to HTML/CSS but not drawn on the canvas.

## License

MIT
