# Mix Bliss / Impasto — Cursor agent brief

You are building **Mix Bliss / Impasto**. There are **two shipping surfaces**. Match the code that is here.

1. **Mobile web app** in `web/` — Vite + TypeScript + WebGL2. This is what a phone (and this cloud Preview pane) can actually play. The user asked for it.
2. **Unreal Engine 5.8 C++** at the repo root (`Impasto.uproject`, `Source/`). This is the Windows editor / PC GPU path. **Do not delete it.**

Read `web/`, `Impasto.uproject`, `Source/`, `Shaders/`, `Config/`, and `README.md` before changing anything.

The rejected Babylon orbit-blob mixer in `_legacy_web/` is **not** the product. Do not revive those blobs. A new `web/` app that looks like overhead oil is allowed.

---

## Goal

Photoreal **oil paint** on a porcelain tray. It must **not look CGI**.

Reference: top-down HD YouTube **#paintmixing** macros — Joshua Javaherian / palette-knife / finger oil. Thick wet paint, still until touched, then viscous folds that settle dead still.

If a frame looks like a shader toy, slime, water, or particle grapes, **tear that path out** and raise the sim/material until it reads as paint.

Houdini viscous MPM / FLIP oil is a **quality bar**, not software to install.

---

## Which surface to edit

| You are on | Product |
| --- | --- |
| Cloud VM / no GPU / phone Preview | `web/` — `npm run dev` on **127.0.0.1:43147** |
| Windows PC with UE 5.8 | `Impasto.uproject` — Play In Editor (Alt+P) |

Do **not** try to Pixel Stream Unreal from a machine with no GPU and no Epic-linked GitHub. Do **not** demand `EPIC_GITHUB_TOKEN` or Linux editor binaries unless they explicitly want a source build.

Do **not** open Playwright, RecordScreen, or browser-automation religion unless they ask. Do **not** open PRs unless they ask.

---

## Mobile web app (`web/`)

```bash
cd web && npm i && npm run dev
```

Stack: Vite + TypeScript + WebGL2. Official app folder is `web/` at repo root.

### Invariants

1. **Blank tray** at start. Pick a tube. **Tap dumps that exact tube color.** No default puddle.
2. **Drag never dumps color.** Finger smears/folds paint that is already there. Palette scraper is optional and also never dumps.
3. **Static until touched.** Residual vibration, crawling beads, or sparkling after the finger lifts = **failure**. Sleep must zero velocity **and** APIC `C`.
4. Motion must read as **viscous oil**, then settle **dead still**.
5. Always look like **paint**. True tube colors (cadmium looks like cadmium).
6. Full-viewport tray. Top-down HD copy-stand. Mobile-first, safe-area, no hover-only controls. Empty and WebGL-fail states with real copy.
7. PWA-ish: viewport meta, `touch-action: none` on the canvas, block scroll/zoom while mixing.

### Solver / look

- MLS-MPM + implicit viscosity APIC (`web/src/mpm.ts`) — Hu 2018, Batty–Bridson Jacobi. No in-plane gravity. Sleep when still.
- Kubelka–Munk K/S in `web/src/km.ts` + tube spectra in `web/src/paints.ts`. Folds may marble before they homogenize.
- Film renderer in `web/src/render.ts`. High-res enough that pixels are not obvious on a phone. Cap film on software GL.

Tubes (same hexes as the Unreal HUD):

1. Cadmium Red `#d42a1e`
2. Quinacridone Magenta `#c2185b`
3. Naples Yellow `#e8c547`
4. Hansa Yellow `#ffd84a`
5. Ultramarine `#2a4bd7`
6. Cerulean `#3d9ad1`
7. Phthalo Green `#0b6e56`
8. Burnt Sienna `#a3542d`
9. Titanium White `#f3eee4`
10. Mars Black `#1c1816`

Viscosity slider labels: **Thin oil → Heavy oil → Impasto → Tar**. Never “water”.

---

## Unreal Engine 5.8 (Windows PC)

1. Epic Launcher → Unreal Engine **5.8** installed.
2. Double-click `Impasto.uproject`.
3. First launch compiles modules **Impasto** (runtime) and **ImpastoEditor** (editor).
4. `ImpastoEditor` writes oil / porcelain / steel materials and `/Game/Maps/PaintTray`.
5. **Play In Editor.** `ImpastoGameMode` possesses `APaintStudioPawn` (tray, knife, MPM surface, lights).

Do not switch engine association off **5.8** unless they explicitly need 5.7 compatibility.

### Current UE stack

| Piece | Reality |
| --- | --- |
| Project | `Impasto.uproject` — UE **5.8** C++, `EngineAssociation: "5.8"` |
| Live oil solver | **MLS-MPM** CPU in `Source/Impasto/Private/PaintMPM.cpp` (Hu et al., SIGGRAPH 2018) |
| GPU port | `Shaders/PaintMPM.usf` — **not dispatched** |
| Niagara Fluids | Plugin **enabled**. It is **water/gas FLIP**, not the live oil. |
| Surface | `UPaintSimComponent` — procedural mesh, **160²** field, **vertex tube color**, cover-wins |
| Camera | Fixed top-down. **No orbit camera.** |
| Tools | **Click = glop**. **Drag = scraper only.** |

UE cover-wins is correct in that slice (no KM there yet). The web app does KM.

UE controls: click glop, drag scraper, **G** dump, **R** blank, **1–0** tubes, **[ ]** viscosity, **- =** size.

---

## Shared invariants (do not violate)

1. Blank tray. Tube tap/click dumps that tube only.
2. Mix tools never deposit color while dragging.
3. Static until touched. Sleep zeros velocity and APIC `C`.
4. Viscous oil, then dead still. Not water, slime, grapes, foam.
5. Always look like paint. If it looks like a heightfield shader toy, fix lighting/thickness/solver.
6. Keep the shot **top-down HD macro**.

---

## Layout

```
web/                         mobile web app — the phone product
  src/mpm.ts                 MLS-MPM + finger/scraper
  src/km.ts                  Kubelka–Munk
  src/paints.ts              tube spectra
  src/render.ts              WebGL2 film
Impasto.uproject
Source/Impasto/              UE runtime
Source/ImpastoEditor/        first-run materials + map
Shaders/PaintMPM.usf         GPU port, not live
_legacy_web/                 rejected Babylon — do not revive
```

---

## Git / files

- `.gitignore` drops UE `Binaries/`, `Intermediate/`, `Saved/`, and `web/node_modules/`, `web/dist/`.
- Do **not** put `package.json` / `index.html` at repo root. The web app lives in `web/`.
- Do not copy `_legacy_web/` back to the root.

---

## Taste check (every run)

After a glop and a smear:

- Does it look like **tube oil on porcelain**, or like a game VFX?
- When the finger lifts, does it **stop**?
- Is the color the **tube**, or a muddy blend you did not ask for?
- Would a painter believe this still?

If no: fix sim and material. Do not ship a prettier HUD.
