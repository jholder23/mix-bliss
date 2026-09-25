# Mix Bliss / Impasto

Thick oil on a porcelain tray. Tap a tube color, then smear and fold it with a finger — like an overhead YouTube #paintmixing macro.

There are **two ways to run this**:

1. **Phone / browser (the playable app here):** Vite + TypeScript + WebGL2 in `web/`.
2. **Windows PC editor:** Unreal Engine 5.8 C++ project at the repo root (`Impasto.uproject`).

The old rejected Babylon orbit mixer in `_legacy_web/` is not the product. Do not delete the Unreal project.

---

## Mobile web app

Open Mix Bliss on a phone or in the Preview pane.

```bash
cd web
npm i
npm run dev
```

Dev server binds **127.0.0.1:43147** (not 3000 / 5173 / 8080). Production build:

```bash
cd web
npm run build
```

### How to paint on a phone

1. Add the page to your home screen if you want it as a standalone web app (PWA-ish: viewport locked, `touch-action: none` on the canvas, pinch-zoom blocked while mixing).
2. Pick a tube. Cadmium looks like cadmium.
3. **Tap** the tray to lay a still bead of that tube.
4. **Drag** to smear and fold paint that is already there. The finger never dumps more color.
5. Optional **palette scraper** — also never dumps color. It plows ridges.
6. Viscosity goes thin oil → tar. Size is dab → pile. **Blank tray** wipes the porcelain.

The oil is static until you touch it. After a smear it moves like thick paint, then settles dead still. Residual crawl is a bug.

Mixing uses Kubelka–Munk K/S on particles (same spectra as the older `src/km.ts` work). Folds marble first, then slowly homogenize.

### Honest limits

This cloud pod has **software GL** (llvmpipe / SwiftShader), not a real GPU. The film still draws, but highlights and fill rate are softer than a phone. On a real phone GPU the tray is sharper. The solver is MLS-MPM + implicit viscosity on the CPU (Hu 2018, Batty–Bridson Jacobi) — 80² grid, sleeps when still, no in-plane gravity.

---

## Unreal Engine 5.8 on Windows

The PC editor path is unchanged.

1. Install **Unreal Engine 5.8** from the Epic Games Launcher.
2. Double-click `Impasto.uproject`.
3. First launch compiles `Impasto` / `ImpastoEditor`, writes oil/porcelain/steel materials and `/Game/Maps/PaintTray`.
4. Play In Editor (**Alt+P**). Use the local GPU. Pixel Streaming is optional and not required.

`ImpastoGameMode` spawns `APaintStudioPawn` even on the default template map: fixed overhead camera, tray, knife, Lumen softboxes.

### How to paint in the editor

- **Click** — dump a still bead of the selected tube.
- **Drag** — scraper only (the knife never dumps color).
- **G** dump · **R** blank · **1–0** tubes · **[ ]** viscosity · **- =** size.

Live solver: **MLS-MPM** in `Source/Impasto/Private/PaintMPM.cpp`. Cover-wins color (no KM in this slice).

---

## Layout

```
web/                      playable mobile web app (Vite + WebGL2)
Impasto.uproject          UE 5.8 C++ project for the Windows editor
AGENTS.md / AGENT.md      product memory for Cursor
Source/Impasto/           runtime (sim, pawn, HUD, materials)
Source/ImpastoEditor/     first-run map + materials
Shaders/PaintMPM.usf      GPU port (not dispatched)
_legacy_web/              rejected Babylon prototype — ignore
```
