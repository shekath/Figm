# Figmy Importer (Figma plugin)

Imports `.figmy` files into Figma as native, editable layers.

## Try it locally
In Figma desktop, go to Plugins → Development → Import plugin from manifest… and pick `manifest.json`.

## Publish to the Figma Community
1. Run the plugin once from Development, then open Plugins → Development → Manage plugins in development → **Publish**.
2. Assets for the listing are in `assets/`:
   - Icon: `assets/icon.png` (128×128)
   - Thumbnail/cover: `assets/cover.png` (1920×1080)
   - The SVG sources are next to them.
3. Name: **Figmy Importer**. Tagline: *Bring .figmy designs in as native, editable layers.*
4. Figma assigns a real plugin ID when you publish. Replace `"id"` in `manifest.json` with it and commit.
5. The plugin makes no network requests (`networkAccess: none`), so the review needs no justification for that.
