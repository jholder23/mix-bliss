# Impasto — Cursor agent brief (Windows PC)

You are building **Impasto** on the user's **Windows PC**. They opened this repo in Cursor and will iterate in **Unreal Editor 5.8** locally. This file is product memory. Match the **code that is here**, not git history from the Vite/Babylon era.

Read `Impasto.uproject`, `Source/`, `Shaders/`, `Config/`, and `README.md` before changing anything.

---

## Goal

Photoreal **oil paint** on a porcelain tray. It must **not look CGI**.

Reference: top-down HD YouTube **#paintmixing** macros — Joshua Javaherian / palette-knife oil. Thick wet paint, still until scraped, then viscous folds that settle dead still.

**REAL PAINT. REAL SIMS.** Fluids and photoreal look first. Color mixing and extra tools later.

If a frame looks computer-generated, **tear that path out** and raise the sim/material until it reads as paint.

Houdini viscous MPM / FLIP oil is a **quality bar**, not software to install.

---

## Machine you are on

- **Windows PC**, GPU, **Unreal Editor 5.8** from the Epic Games Launcher.
- User authenticates with **Windows Hello PIN / passkey MFA** on this machine. Do not ask them to paste GitHub passwords, AWS keys, or Epic tokens unless a specific source-build step truly needs engine GitHub access.
- **Prefer local Play In Editor** (Alt+P). Do **not** set up AWS Pixel Streaming unless they ask. Pixel Streaming was a fallback for a cloud VM that had **no GPU** and **no Epic-linked GitHub** — that is not this machine.
- Do **not** demand `EPIC_GITHUB_TOKEN`, AWS credentials, or Linux editor binaries.
- Do **not** open Playwright, RecordScreen, or browser-automation religion. There is no web app to test.
- Do **not** open PRs unless they ask. Commit locally when they want history; they own git on this PC.
- Do **not** revive WebGL, Vite, Babylon, or anything under `_legacy_web/`. That mixer was rejected. **Never fall back to the browser as the product.**

---

## Open the project (first thing)

1. Epic Launcher → Unreal Engine **5.8** installed.
2. Double-click `Impasto.uproject` (or right-click → Generate Visual Studio project files, then open the `.sln` plus the editor).
3. First launch compiles modules **Impasto** (runtime) and **ImpastoEditor** (editor).
4. `ImpastoEditor` on `OnPostEngineInit` writes:
   - `/Game/Impasto/Materials/M_OilPaint` — clearcoat dielectric, vertex color
   - `/Game/Impasto/Materials/M_Porcelain`
   - `/Game/Impasto/Materials/M_SteelKnife`
   - `/Game/Maps/PaintTray` — empty world package if missing
5. **Play In Editor.** Default map in `Config/DefaultEngine.ini` is still `/Engine/Maps/Templates/Template_Default`. That is OK: `ImpastoGameMode` possesses `APaintStudioPawn`, which **is** the studio (tray, knife, MPM surface, lights). The generated `PaintTray` map is a stub; the pawn is the product.

Do not switch engine association off **5.8** unless they explicitly need 5.7 compatibility.

---

## Current stack (source of truth)

| Piece | Reality |
| --- | --- |
| Project | `Impasto.uproject` — UE **5.8** C++, `EngineAssociation: "5.8"` |
| Live oil solver | **MLS-MPM** CPU in `Source/Impasto/Private/PaintMPM.cpp` (Hu et al., SIGGRAPH 2018) |
| GPU port | `Shaders/PaintMPM.usf` mapped as `/Impasto/PaintMPM.usf` from `FImpastoModule` — **not dispatched**. Incomplete (float atomics stubbed). No `FGlobalShader` wrapper yet. |
| Niagara Fluids | Plugin **enabled**. It is **water/gas FLIP**, not the live oil. Do not replace MPM with Niagara Fluids 3D and call it paint. |
| Surface | `UPaintSimComponent` — procedural mesh, **160²** field, height from particle mass, **vertex tube color** |
| Cover | **Strongest splat wins** (`if (W > ColorW[Idx])` take that particle RGB). **No Kubelka–Munk. Do not start mixing until paint/fluid look real.** |
| Camera | Fixed top-down on `APaintStudioPawn` (`Z=56`, pitch `-90`, FOV `24`). **No orbit camera.** |
| Lights | Three rect-light softboxes + realtime skylight, **Lumen** GI/reflections, TSR (`r.AntiAliasingMethod=4`), path tracing available (`r.PathTracing`). |
| Tools | **Click = glop** of selected tube. **Drag = scraper only** (palette knife). Knife never deposits color. |
| Legacy | `_legacy_web/` — dead Vite/Babylon. Ignore. |

Plugins in the `.uproject`: Niagara, NiagaraFluids, ProceduralMeshComponent, EnhancedInput, PixelStreaming, PixelStreaming2, GeometryProcessing.

---

## Invariants (do not violate)

1. **Blank tray** at start. Pick a tube. **Glop dumps that exact tube color.** No default puddle, no auto-mix.
2. **Scraper only** for now (palette knife). Mix tools never deposit color. Do not add brushes, fingers, or extra deposit tools until the oil itself looks real.
3. **Static until touched.** Residual vibration, crawling beads, or sparkling particles after the knife lifts = **failure**. Sleep must zero velocity **and** APIC `C`.
4. Motion must read as **viscous oil**, then settle **dead still**. Not water, slime, grapes, foam, or particle soup.
5. Always look like **paint**. Photoreal material + thick geometry. If it looks like a heightfield shader toy, fix lighting/thickness/solver, do not grade it in post until the sim is honest.
6. **Fluids + photoreal paint first.** Color mixing, extra tools, UI chrome — later.
7. Keep the shot **top-down HD macro**. Do not add an orbit camera "for debugging" in the shipping pawn.

---

## How to paint (controls — keep these)

Bound in `APaintStudioPawn` (Enhanced Input + raw number keys):

| Input | Action |
| --- | --- |
| Click (no drag) | Dump a still bead of the selected tube |
| Drag | Scraper strain only |
| **G** | Dump at cursor |
| **R** | Blank tray |
| **1–0** | Tubes (see list below) |
| **[ ]** | Viscosity slider (soft oil → tar) |
| **- =** | Bead / knife size |

Tubes in `UPaintSimComponent::BuildTubes` (index 0 = key 1, index 9 = key 0):

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

HUD (`AImpastoHUD`): swatches bottom-left, hint line with tube name, feel label, particle count, `still` when sleeping.

---

## Solver — edit here, not in Niagara

`FPaintMPM` (`PaintMPM.h` / `PaintMPM.cpp`):

- Grid **80²** (`Grid = 80`, `Nodes = 81`), `MaxParticles = 24576`, hex-ish spawn `Spacing = 0.46`
- Quadratic B-spline weights (3×3), **APIC** affine `C` (C00, C01, C10, C11)
- Newtonian **Tait-style** pressure from density vs `RestDensity`
- **Batty–Bridson** implicit viscosity after P2G — cheap decoupled **Jacobi** (`Feel.Jacobi`, default ~14)
- Surface-tension / cohesion pull on grid mass gradient
- **No in-plane gravity**
- Knife: oriented rectangle, mixes grid velocity toward stroke, plus plow and ridge
- Sleep: if knife inactive and `Vmax < SleepSpeed`, after `Settle` frames, **zero Vx, Vy, and all C**, `bSleeping = true`. `Step` returns immediately while sleeping.
- Feel from slider `FeelFromSlider` (default slider `0.72` → impasto/tar side): viscosity ~28–420, stiffness, cohesion, rest density, sleep speed, Jacobi, damping

`UPaintSimComponent`:

- Worlds the 80² grid onto a tray `TrayExtent = 18` cm, `TrayZ = 2.05`
- Ticks solver PrePhysics; rebuilds mesh when dirty
- Height `HeightCm = 0.55` from splatted mass; empty verts get alpha-0 vertex color

Do not “simplify” this into a texture-blob or Niagara sprite overlay.

---

## Material / lighting

`FPaintMaterials::EnsureSavedAssets` (editor-only):

- **Oil** — `MSM_ClearCoat`, base color = **vertex color**, roughness `0.12`, clearcoat `1`, clearcoat roughness `0.04`, `bUsedWithProceduralMesh`
- **Porcelain** — default-lit, warm off-white, roughness `0.38`
- **Steel knife** — metallic `1`, roughness `0.22`

Studio: key/fill/rim rect lights, manual exposure, no motion blur, slight vignette, Lumen gather quality `1.5`. Path Tracer is a look-dev option once they hit Play, not a required shipping path.

Raise dielectric wetness, thickness, and macro specular **in the material and mesh**, not with a fake ACES LUT from the old web prototype.

---

## Layout

```
Impasto.uproject
Source/Impasto/              runtime: MPM, sim component, pawn, HUD, game mode, materials
  Public/PaintMPM.h
  Private/PaintMPM.cpp       LIVE solver
  Public/PaintSimComponent.h
  Private/PaintSimComponent.cpp
  Public/PaintStudioPawn.h
  Private/PaintStudioPawn.cpp
  Private/PaintMaterials.cpp
  Private/Impasto.cpp        shader dir map /Impasto → Shaders/
Source/ImpastoEditor/        first-run materials + /Game/Maps/PaintTray
Shaders/PaintMPM.usf         GPU port, not live
Config/DefaultEngine.ini     GameMode, Lumen, TSR, Pixel Streaming knobs
Content/                     generated assets appear after first editor launch
scripts/pixel-stream.sh      Linux/cloud fallback — not the Windows workflow
_legacy_web/                 rejected Vite/Babylon — do not revive
```

---

## What to improve (priority)

Work in this order unless they say otherwise:

1. **It has to look like oil, not a sim demo.** Residual motion, blobby grapes, watery splash, cheap plastic shader → fail.
2. **Raise MPM resolution** (grid / particles / mesh res) if 80² reads coarse. Profile first; CPU 80² is the live path.
3. **Dispatch GPU `PaintMPM.usf`** with a real `FGlobalShader` / RDG pass when CPU resolution is the limiter. Finish the shader (the mass P2G atomic is stubbed). Keep the CPU solver as fallback until GPU matches feel + sleep.
4. **Oil material** — thicker dielectric, wet clearcoat, believable height, contact with porcelain.
5. **Scraper feel** — knife should fold and ridge oil like a palette knife, not smear a heightfield.
6. **Sleep / settle** — knife up → viscous decay → stone still. No humming.
7. Research: MLS-MPM (Hu 2018), implicit viscosity (Batty & Bridson 2008), later papers on yield-stress / Herschel–Bulkley paint if Newtonian oil still looks like honey.
8. **Only then** Kubelka–Munk or any spectral mixing. Cover-wins is correct until the fluid is real.

Keep top-down. Do not add a third-person sandbox.

---

## Pixel Streaming (only if they ask)

`./scripts/pixel-stream.sh` is a **Linux** helper: HTTP **127.0.0.1:43171**, streamer WS **8888**, clones PixelStreamingInfrastructure branch `UE5.8`. On this Windows PC, **Play In Editor is enough**. If they later want to stream, use Epic's Windows Pixel Streaming docs — do not invent AWS.

---

## Git / files to leave alone

- `.gitignore` already drops `Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`, `.sln`, Web leftovers. Keep it that way.
- Do not add `package.json`, Vite, Playwright, or `index.html` at repo root.
- Do not copy `_legacy_web/` back to the root.

---

## Taste check (every Play)

After a glop and a scrape:

- Does it look like **tube oil on porcelain**, or like a game VFX?
- When the knife lifts, does it **stop**?
- Is the color the **tube**, or a muddy blend you did not ask for?
- Would a painter believe this still?

If no: fix sim and material. Do not ship a prettier HUD.
