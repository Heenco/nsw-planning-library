# CraftBot viewer — vendored

This directory is a verbatim copy of the `viewer/` folder from:

    https://github.com/lukapiskorec/craftbot

Copyright (c) 2026 Luka Piškorec. MIT licensed — see `LICENSE` beside this file.
Only `test/` (node test scaffolding) was left out.

## Local modifications

Kept to a minimum so upstream stays re-copyable:

1. `css/local-overrides.css` — **ours**, not upstream. Swaps the UI font from
   MEK-Mono to the app's Figtree stack. Change `--local-ui-font` in that file
   to restyle; upstream sets the family once on `body` and its controls use
   `font: inherit`, so the whole GUI follows.
2. `index.html` — four added `<link>` lines (Figtree from Google Fonts, plus
   the override sheet) after the `style.css` link; `<title>` set to "3D Viewer";
   the whole `<footer id="footer">` removed — it held the "Github source" link
   and the {protocell:labs} link to https://protocell.xyz. Its CSS in
   `style.css` is left in place so the block can be pasted back verbatim.
3. `js/gui.js` — the `makePanel` default title changed from "CRAFTBOT VIEWER"
   to "3D VIEWER". `main.js` passes `undefined`, so this default is what the
   GUI header shows.

4. `js/main.js` — a `?model=` URL that is not listed in `models/index.json` is
   now loaded directly instead of being ignored. Upstream resolves the parameter
   against the index and falls back to a random showcase model, which is right
   for a fixed model library; here `/api/property/envelope` generates a model per
   lot on request and 73,595 Hornsby lots cannot be enumerated in the index. It
   is inserted as a synthetic index entry (titled from a `label` parameter) so
   the MODEL picker names the model that is on screen, with its `rationale`
   pointing back at the same route. `loadPicked` and `loadRunDocs` treat a path
   beginning with `/` as app-served rather than prefixing `models/`.

Attribution: the UI credits — the GitHub source link and the {protocell:labs}
link — were removed at the repo owner's request. MIT requires the copyright
notice to travel with copies, not to appear in the interface; `LICENSE` beside
this file and this document carry it, so the copy stays compliant.

To restore the original look, delete those `<link>` lines and revert the two
strings above. `fonts/MEK-Mono.otf` and its `@font-face` rule are untouched.

When re-copying from upstream, re-apply step 2 and keep `local-overrides.css`.

## What it is

A static three.js app that displays building models produced by CraftBot, a
research agent that designs by writing Blender Python rather than by generating
images. Models here are the outputs of 13 experiments (155 model files across
two agents), covering timber framing, roofs, staircases and a CLT tower.

Served at `/craftbot-viewer/index.html`; the app wraps it at the `/craftbot`
route (`app/pages/craftbot.vue`). The folder is named `craftbot-viewer` because
a `public/` directory shadows a page route of the same name.

## How it finds models

`models/index.json` is the manifest — experiments → agent runs → versions:

    { "experiments": [ { "id", "title",
        "runs": [ { "agent", "versions": [ { "v", "file", "elements", "bytes" } ] } ] } ] }

Every path inside the viewer is relative, which is why it works unchanged under
the `/craftbot-viewer/` subpath.

A model file is compact box geometry, not a mesh:

    { "format": "craftbot-model", "version": 1, "source": "...",
      "collections": [...], "boxes": [ [name, ...numbers], ... ] }

`?model=<path>` deep-links to one file — the wrapper page passes its own query
string through, so `/craftbot?model=models/11_Hip_Roof.../fable_v02.json` works.

## Adding our own models

Write a `craftbot-model` JSON into `models/`, add it to `models/index.json`, and
it appears in the picker. Producing one requires Blender running the CraftBot
export pipeline (`tools/export_model_json.py` in the upstream repo) — it is not
something this app generates.

## Updating

Re-copy from upstream and diff `models/index.json`; keep `LICENSE` and this file.
Upstream pulls three.js from a jsdelivr CDN via an import map, so the viewer
needs network access at runtime.
