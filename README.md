# Mix Bliss / Impasto

Thick oil on a porcelain tray. Tap a tube color, then smear and fold it — like an overhead YouTube #paintmixing macro.

There are **two ways to run this**:

1. **Phone / browser (playable here):** Vite + TypeScript + WebGL2 in `web/`.
2. **Unreal Engine 5.8:** Windows editor, and Android / iOS packages from a machine that has the editor.

This cloud VM has **no Unreal Editor and no GPU**. The web app is the mixer you can open on a phone or in the Preview pane. Keep `Impasto.uproject` — do not delete it. The rejected Babylon orbit blobs in `_legacy_web/` are not the product.

Cursor agents: read **[AGENTS.md](AGENTS.md)** (same text in `AGENT.md`) before changing anything.

---

## Mobile web app

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

1. Open the page. Add it to the home screen if you want a standalone web app (PWA-ish: viewport locked, `touch-action: none` on the canvas, pinch-zoom blocked while mixing).
2. Pick a tube. Cadmium looks like cadmium.
3. **Tap** the tray to lay a still bead of that tube.
4. **Drag** to smear and fold paint that is already there. The finger never dumps more color.
5. Optional **palette scraper** — also never dumps color. It plows ridges.
6. Viscosity goes thin oil → tar. Size is dab → pile. **Blank tray** wipes the porcelain.

The oil is static until you touch it. After a smear it moves like thick paint, then settles dead still. Residual crawl is a bug.

Mixing uses Kubelka–Munk K/S on particles. Folds marble first, then slowly homogenize.

### Honest limits

This cloud pod is **software GL** (llvmpipe / SwiftShader), not a real GPU. The film still draws, but highlights and fill rate are softer than a phone. On a real phone GPU the tray is sharper. The solver is MLS-MPM + implicit viscosity on the CPU (Hu 2018, Batty–Bridson Jacobi) — 80² grid, sleeps when still, no in-plane gravity.

---

## Unreal Engine 5.8 on Windows

The PC editor / phone-package path.

1. Install **Unreal Engine 5.8** from the Epic Games Launcher.
2. Double-click `Impasto.uproject`.
3. First launch compiles `Impasto` / `ImpastoEditor` and writes oil / porcelain / steel materials plus `/Game/Maps/PaintTray`.
4. **Play In Editor (Alt+P)** on the local GPU. Mouse = same as finger (click glop, drag smear).

`ImpastoGameMode` possesses `APaintStudioPawn` (tray, lights, MPM surface). Live oil is MLS-MPM in `Source/Impasto/Private/PaintMPM.cpp`. Cover-wins color (no KM in this slice). Desktop PIE uses Lumen; phone device profiles drop Lumen and keep the clearcoat oil.

| Input | Action |
| --- | --- |
| Tap / click (no drag) | Dump a still bead of the selected tube |
| Drag | Smear only — never dumps color |
| **Blank** / **R** | Clear the tray |
| Swatches / **1–0** | Select a tube |
| Viscosity slider / **[ ]** | Soft oil → tar |
| **Knife** / **K** | Optional palette scraper |
| **- =** | Bead / contact size |
| **G** | Dump at cursor (editor) |

### Package for a phone (Windows PC)

Open the project in the editor **once** first so materials and `/Game/Maps/PaintTray` exist.

**Android APK / AAB:** Epic Launcher → UE 5.8 → enable **Android**. Install the Android toolchain the 5.8 docs list (Android Studio, NDK, JDK 17). Package name is `com.impasto.paintmixer`. **Platforms → Android → Package Project**. Install with `adb install -r Impasto-arm64.apk`.

**iOS:** settings are in `Config/DefaultEngine.ini`. Cooking an IPA needs a Mac with Xcode.

Pixel Streaming is desktop-only and **not available on this VM**. Do not try to Pixel Stream Unreal from a machine with no GPU.

---

## Layout

```
web/                      playable mobile web app (Vite + WebGL2)
Impasto.uproject          UE 5.8 C++ — Windows editor + Android / iOS
AGENTS.md / AGENT.md      product memory for Cursor
Source/Impasto/           runtime (MPM, pawn, UMG HUD, materials)
Source/ImpastoEditor/     first-run map + materials
Config/                   Android / iOS / device profiles
Shaders/PaintMPM.usf      GPU port (not dispatched)
_legacy_web/              rejected Babylon prototype — ignore
```
