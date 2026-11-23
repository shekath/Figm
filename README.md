# Vectura

Vectura is an open-source vector design and prototyping tool. It runs in the browser and as a Windows desktop app built with Electron. Both share one React + TypeScript codebase.

It was written from scratch. It contains no code, assets or branding from any proprietary design product.

## Features

| Area | What's included |
| --- | --- |
| **Canvas** | Infinite canvas, pan (Space / middle mouse / H), zoom (Ctrl+scroll, pinch, Shift+0/1/2), rulers, pixel grid, outline mode, snapping with smart guides, marquee select, deep select (Ctrl+click), Alt+drag duplicate |
| **Tools** | Move, Frame, Section, Rectangle, Ellipse, Polygon, Star, Line, Arrow, Pen (bezier), Pencil (smoothed freehand), Text, Image, Hand, Comment |
| **Editing** | Resize (Shift keeps ratio, Alt resizes from centre), rotate, flip, corner radius handle and independent corners, vector point and handle editing, nudge, align and distribute, tidy up, z-order |
| **Structure** | Pages, frames with clip content, groups, sections, masks, layer tree with drag-to-reorder and reparent, rename, hide, lock, search |
| **Layout** | Auto layout (direction, gap, padding, alignment, space-between, hug contents, drag to reorder), constraints (left/right/center/scale/stretch) |
| **Components** | Main components, instances that stay in sync, text overrides, detach, go to main, assets panel with drag-to-canvas |
| **Styling** | Multiple fills (solid, linear and radial gradients, image), strokes (inside/center/outside, dash, caps), effects (drop shadow, inner shadow, layer blur), blend modes, opacity |
| **Text** | 20 fonts (Google Fonts on demand), weight, size, line height, letter spacing, alignment, decoration, case, auto width / auto height / fixed |
| **Design system** | Colour styles, text styles, effect styles, variables with light/dark modes |
| **Prototyping** | Click / hover / after-delay interactions, drag-to-connect handles, dissolve/slide/push transitions, back navigation, start frame, full-screen presenter |
| **Dev mode** | Inspect panel with measurements, generated CSS and JSX, copy to clipboard |
| **Collaboration (local)** | Comment pins with replies and resolve, version history with restore |
| **Import / export** | PNG / JPG at any scale, SVG, multi-page PDF, per-layer export settings, SVG import, image drag-and-drop and paste, copy/paste between files |
| **Files** | Home screen with recent files and thumbnails, autosave to local storage (IndexedDB), `.vectura` file format, native open/save dialogs on desktop, File System Access API on the web |
| **App** | Light and dark themes, full keyboard shortcut set (Ctrl+Shift+? lists them), right-click context menu, undo/redo history, offline-capable PWA for the web build |

## Development

```bash
npm install
```

Web app with hot reload:

```bash
npm run dev
```

Desktop app with hot reload:

```bash
npm run electron:dev
```

Production web build (output in `dist/`):

```bash
npm run build
```

Windows installer and portable `.exe` (output in `release/`):

```bash
npm run electron:build
```

`electron:build` should be run on Windows. On Linux and macOS, electron-builder needs Wine to build Windows targets. CI handles this for you: `.github/workflows/build.yml` builds the web bundle and the Windows installer on every push and uploads both as artifacts. `.github/workflows/pages.yml` deploys the web app to GitHub Pages when `main` changes. To use it, enable Pages in the repository settings with the source set to "GitHub Actions".

## Project layout

```
electron/        Electron main process + secure preload bridge
src/
  store/         Zustand editor store: document model, undo/redo, all editing operations
  canvas/        SVG renderer, hit-testing, interactive canvas, overlays, text editor
  panels/        Toolbar, layers/assets panel, design/prototype/inspect panel, controls
  lib/           Geometry, auto layout + constraints, text layout, export, SVG import, platform IO
  Presenter.tsx  Prototype player
  Home.tsx       File browser
```

## Keyboard shortcuts (selection)

`V` move · `F` frame · `R` rectangle · `O` ellipse · `L` line · `P` pen · `T` text · `C` comment · `Ctrl+G` group · `Ctrl+Alt+G` frame selection · `Shift+A` auto layout · `Ctrl+Alt+K` component · `Ctrl+D` duplicate · `Ctrl+]` / `Ctrl+[` reorder · `Shift+1` zoom to fit · `Ctrl+Alt+Enter` present

## License

MIT
