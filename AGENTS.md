# Mix Bliss / Impasto — Cursor agent brief

You are building **Mix Bliss / Impasto**. There are **two shipping surfaces**. Match the code that is here.

1. **Mobile web app** in `web/` — Vite + TypeScript + WebGL2. This is what a phone (and this cloud Preview pane) can actually play. The user asked for it. **Do not say “never ship WebGL.”**
2. **Unreal Engine 5.8 C++** at the repo root (`Impasto.uproject`, `Source/`). Windows editor, Android APK/AAB, iOS settings. **Do not delete it.**

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
| Cloud VM / no GPU / phone Preview | `web/` — `cd web && npm i && npm run dev` on **127.0.0.1:43147** |
| Windows PC with UE 5.8 | `Impasto.uproject` — Play In Editor, then package Android / iOS |

This cloud VM has **no Unreal Editor and no GPU**. Do **not** try to Pixel Stream Unreal from here. Do **not** demand `EPIC_GITHUB_TOKEN` or Linux editor binaries unless they explicitly want a source build.

Do **not** open Playwright, RecordScreen, or browser-automation religion unless they ask. Do **not** open PRs unless they ask.

---

## Mobile web app (`web/`)

```bash
cd web && npm i && npm run dev
```

### Invariants

1. **Blank tray** at start. Pick a tube. **Tap dumps that exact tube color.** No default puddle.
2. **Drag never dumps color.** Finger smears/folds paint that is already there. Palette scraper is optional and also never dumps.
3. **Static until touched.** Residual vibration after the finger lifts = **failure**. Sleep must zero velocity **and** APIC `C`.
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

## Unreal Engine 5.8 (Windows PC + phone packages)

1. Epic Launcher → Unreal Engine **5.8**. Enable the **Android** target if they will package an APK.
2. Double-click `Impasto.uproject`.
3. First launch compiles **Impasto** and **ImpastoEditor**, writes materials and `/Game/Maps/PaintTray`.
4. **Play In Editor.** `ImpastoGameMode` possesses `APaintStudioPawn`.
5. Package Android / iOS only **after** that first editor open. See README.

Do not switch engine association off **5.8** unless they explicitly need 5.7 compatibility.

### Current UE stack

| Piece | Reality |
| --- | --- |
| Project | `Impasto.uproject` — UE **5.8** C++ |
| Targets | Windows, Android (APK/AAB), iOS settings |
| Live oil | **MLS-MPM** CPU in `Source/Impasto/Private/PaintMPM.cpp` |
| Finger smear | Round contact (`FKnife::bRound`). Palette knife optional. **Neither dumps color.** |
| GPU port | `Shaders/PaintMPM.usf` — **not dispatched** |
| Niagara Fluids | Enabled. Water/gas FLIP — not the live oil. |
| Surface | Procedural mesh, **160²** desktop / **112²** mobile, cover-wins vertex color |
| Camera | Fixed top-down. **No orbit camera.** |
| Lights | Softboxes. **Lumen** in desktop PIE. **No Lumen on phone.** Keep dielectric oil. |
| HUD | UMG `UImpastoMixerWidget` — large swatches, viscosity, Blank, Knife, safe zone |

UE cover-wins is correct in that slice (no KM there yet). The web app does KM.

---

## Shared invariants

1. Blank tray. Tube tap/click dumps that tube only.
2. Mix tools never deposit color while dragging.
3. Static until touched. Sleep zeros velocity and APIC `C`.
4. Viscous oil, then dead still. Not water, slime, grapes, foam.
5. Always look like paint. If it looks like a heightfield shader toy, fix lighting/thickness/solver.
6. Keep the shot **top-down HD macro**.
7. MLS-MPM stays the oil. Do not replace it with Niagara Fluids.

---

## Layout

```
web/                         mobile web app — the phone product you can run here
  src/mpm.ts                 MLS-MPM + finger/scraper
  src/km.ts                  Kubelka–Munk
  src/paints.ts              tube spectra
  src/render.ts              WebGL2 film
Impasto.uproject
Source/Impasto/              UE runtime: MPM, pawn, UMG HUD
Source/ImpastoEditor/        first-run materials + map
Config/                      Android / iOS / device profiles
Shaders/PaintMPM.usf         GPU port, not live
_legacy_web/                 rejected Babylon — do not revive
```

---

## Git / files

- `.gitignore` drops UE `Binaries/`, `Intermediate/`, `Saved/`, and `web/node_modules/`, `web/dist/`.
- Do **not** put `package.json` / `index.html` at repo root. The web app lives in `web/`.
- Do not copy `_legacy_web/` back to the root.
- Do **not** gitignore the whole `web/` tree.

---

## Taste check

After a glop and a smear:

- Does it look like **tube oil on porcelain**, or like a game VFX?
- When the finger lifts, does it **stop**?
- Is the color the **tube**, or a muddy blend you did not ask for?
- Would a painter believe this still?

If no: fix sim and material. Do not ship a prettier HUD.
