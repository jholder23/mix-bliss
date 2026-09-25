# Impasto — Cursor agent brief (UE 5.8 mobile paint mixer)

You are building **Impasto**, a **hyper-realistic paint mixing mobile game** in **Unreal Engine 5.8**. The product is `Impasto.uproject`. Match the **code that is here**.

**WebGL is not the app.** Do not revive Vite, Babylon, Playwright, or anything under `_legacy_web/` or `web/`. Never fall back to a browser stand-in — not on a cloud VM, not “just for preview.”

Read `Impasto.uproject`, `Source/`, `Shaders/`, `Config/`, and `README.md` before changing anything.

---

## Goal

Photoreal **oil paint** on a porcelain tray, on a **phone**. It must **not look CGI**.

Reference: top-down HD YouTube **#paintmixing** macros — Joshua Javaherian / palette-knife oil. Thick wet paint, still until touched, then viscous folds that settle dead still.

**REAL PAINT. REAL SIMS.** Fluids and photoreal look first. Color mixing later.

If a frame looks computer-generated, **tear that path out** and raise the sim/material until it reads as paint.

Houdini viscous MPM / FLIP oil is a **quality bar**, not software to install.

---

## Machine you are on

Two places this repo is opened:

1. **Windows PC** with a GPU and **Unreal Editor 5.8** — this is where you **Play In Editor** and **package APK/AAB**. Prefer local PIE (Alt+P).
2. **Cloud / Linux VMs** (this agent environment included) — **no UE editor, no GPU**. You can edit C++, Config, and docs. You **cannot** run the game. Do **not** fake a WebGL / Pixel Stream preview here.

Other rules:

- Do **not** demand `EPIC_GITHUB_TOKEN`, AWS credentials, or Linux editor binaries unless they ask to stream from a machine that actually has the editor.
- Do **not** open Playwright, RecordScreen, or browser-automation religion. There is no web app to test.
- Do **not** open PRs unless they ask.
- Pixel Streaming is **optional on the Windows PC** for remote preview. It is **not available on this VM**.

---

## Open the project (Windows)

1. Epic Launcher → Unreal Engine **5.8** installed. Enable the **Android** target platform.
2. Double-click `Impasto.uproject`.
3. First launch compiles **Impasto** (runtime) and **ImpastoEditor**.
4. `ImpastoEditor` on `OnPostEngineInit` writes oil / porcelain / steel materials and `/Game/Maps/PaintTray`.
5. **Play In Editor.** Default map is `/Game/Maps/PaintTray`. `ImpastoGameMode` possesses `APaintStudioPawn` (the studio).

Package for phones only **after** that first editor open. See **README.md** for Android SDK / APK / AAB / iOS.

Do not switch engine association off **5.8** unless they explicitly need 5.7 compatibility.

---

## Current stack (source of truth)

| Piece | Reality |
| --- | --- |
| Project | `Impasto.uproject` — UE **5.8** C++, `EngineAssociation: "5.8"` |
| Targets | Game target cooks **Windows**, **Android** (APK/AAB), **iOS** (settings in ini; IPA needs a Mac) |
| Live oil solver | **MLS-MPM** CPU in `Source/Impasto/Private/PaintMPM.cpp` (Hu et al., SIGGRAPH 2018) |
| Finger smear | Round contact (`FKnife::bRound`). Palette knife rectangle is optional. **Neither dumps color.** |
| GPU port | `Shaders/PaintMPM.usf` — **not dispatched**. Incomplete. |
| Niagara Fluids | Plugin **enabled**. It is **water/gas FLIP**, not the live oil. Do not replace MPM with Niagara Fluids. |
| Surface | `UPaintSimComponent` — procedural mesh, **160²** desktop / **112²** mobile, height from mass, **vertex tube color** |
| Cover | **Strongest splat wins**. **No Kubelka–Munk.** |
| Camera | Fixed top-down on `APaintStudioPawn`. FOV 24 desktop / 32 phone. **No orbit camera.** |
| Lights | Three rect-light softboxes + skylight. **Lumen** in desktop PIE. **No Lumen on phone** (device profiles + pawn). Keep dielectric oil. |
| Touch | Tap = glop of selected tube. Drag = smear. HUD chrome does not dump paint. |
| HUD | UMG `UImpastoMixerWidget` — large swatches, viscosity, Blank, Knife toggle, safe zone. `AImpastoHUD` canvas is retired. |
| Legacy | `_legacy_web/`, `web/` — dead Vite/Babylon. Ignore. |

Plugins: Niagara, NiagaraFluids, ProceduralMeshComponent, EnhancedInput, GeometryProcessing. PixelStreaming / PixelStreaming2 are **desktop-only** (`PlatformAllowList`).

---

## Invariants (do not violate)

1. **Blank tray** at start. Pick a tube. **Glop dumps that exact tube color.** No default puddle, no auto-mix.
2. **Drag never deposits color.** Finger smear and the optional scraper only strain existing paint.
3. **Static until touched.** Residual vibration after the finger lifts = **failure**. Sleep must zero velocity **and** APIC `C`.
4. Motion must read as **viscous oil**, then settle **dead still**. Not water, slime, grapes, foam, or particle soup.
5. Always look like **paint**. Photoreal material + thick geometry. On phones, drop Lumen — do **not** drop the wet clearcoat oil for a flat unlit blob.
6. **MLS-MPM stays the oil.** Do not replace it with Niagara Fluids, a heightfield shader toy, or WebGL.
7. Keep the shot **top-down HD macro**. Do not add an orbit camera in the shipping pawn.
8. **Do not ship a browser mixer** as a preview, fallback, or “mobile web build.”

---

## How to paint (keep these)

| Input | Action |
| --- | --- |
| Tap / click (no drag) | Dump a still bead of the selected tube |
| Drag | Finger smear (default) or palette knife if enabled |
| **Blank** / **R** | Blank tray |
| Swatches / **1–0** | Tubes |
| Viscosity slider / **[ ]** | Soft oil → tar |
| **Knife** / **K** | Toggle optional scraper |
| **- =** | Bead / contact size |
| **G** | Dump at cursor (editor) |

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

---

## Solver — edit here, not in Niagara

`FPaintMPM` (`PaintMPM.h` / `PaintMPM.cpp`):

- Grid **80²** (`Grid = 80`, `Nodes = 81`), `MaxParticles = 24576`, hex-ish spawn `Spacing = 0.46`
- Quadratic B-spline weights (3×3), **APIC** affine `C`
- Newtonian **Tait-style** pressure from density vs `RestDensity`
- **Batty–Bridson** implicit viscosity after P2G — Jacobi (`Feel.Jacobi`, default ~14; **capped at 10 on mobile**)
- Surface-tension / cohesion pull on grid mass gradient
- **No in-plane gravity**
- Contact: **round fingertip** (`ApplyRoundSmear`) or oriented knife rectangle (`ApplyKnife`)
- Sleep: if contact inactive and `Vmax < SleepSpeed`, after `Settle` frames, **zero Vx, Vy, and all C**
- Mobile budget: fewer substeps, Jacobi cap, 112² mesh — still the same oil, not a different solver

`UPaintSimComponent`:

- Worlds the 80² grid onto a tray `TrayExtent = 18` cm, `TrayZ = 2.05`
- Ticks solver PrePhysics; rebuilds mesh when dirty
- Height `HeightCm = 0.55` from splatted mass

Do not “simplify” this into a texture-blob or Niagara sprite overlay.

---

## Material / lighting / phones

`FPaintMaterials::EnsureSavedAssets` (editor-only):

- **Oil** — `MSM_ClearCoat`, base color = **vertex color**, roughness `0.12`, clearcoat `1`, clearcoat roughness `0.04`, `bUsedWithProceduralMesh`
- **Porcelain** — default-lit, warm off-white, roughness `0.38`
- **Steel knife** — metallic `1`, roughness `0.22`

Desktop PIE: key/fill/rim rect lights, manual exposure, Lumen, TSR.

**Phone** (`ImpastoIsMobileTarget`, `Config/DefaultDeviceProfiles.ini`, `[SystemSettingsAndroid]` / `[SystemSettingsIOS]`):

- Lumen GI + Lumen reflections **off** (post-process on the pawn must not force them back on)
- Virtual shadows **off**, path tracing **off**, realtime skylight capture **off**
- Mobile **deferred** + HDR + MSAA so clearcoat oil still reads wet
- Softboxes stay. The oil is still a dielectric, not a flat unlit decal.

---

## Layout

```
Impasto.uproject
Source/Impasto/              runtime: MPM, sim, pawn, UMG HUD, game mode
  Public/PaintMPM.h
  Private/PaintMPM.cpp       LIVE solver
  Public/ImpastoMixerWidget.h
  Private/ImpastoMixerWidget.cpp
  Public/ImpastoPlatform.h   Android / iOS / ES3.1 preview
Config/DefaultEngine.ini     maps, Lumen desktop, Android / iOS packaging
Config/DefaultDeviceProfiles.ini
Config/DefaultScalability.ini
Source/ImpastoEditor/        first-run materials + /Game/Maps/PaintTray
Shaders/PaintMPM.usf         GPU port, not live
Content/                     generated after first editor launch — required to cook
scripts/pixel-stream.sh      Linux/desktop fallback — not this VM
_legacy_web/                 rejected Vite/Babylon — do not revive
```

---

## What to improve (priority)

1. **It has to look like oil, on a phone and in PIE.** Residual motion, watery splash, cheap plastic → fail.
2. Raise MPM resolution if 80² reads coarse. Profile first. Keep CPU MPM as the live path.
3. Dispatch GPU `PaintMPM.usf` when CPU is the limiter. Keep CPU fallback.
4. Oil material — thicker dielectric, wet clearcoat, contact with porcelain. Works without Lumen.
5. Finger smear / optional knife should fold oil, not smear a heightfield.
6. Sleep / settle — finger up → viscous decay → stone still.
7. Research: MLS-MPM (Hu 2018), Batty & Bridson 2008, later yield-stress / Herschel–Bulkley if Newtonian still looks like honey.
8. **Only then** Kubelka–Munk. Cover-wins is correct until the fluid is real.

Keep top-down. Do not add a third-person sandbox.

---

## Git / files to leave alone

- `.gitignore` drops `Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`, `.sln`, Web leftovers, and `web/`.
- Do not add `package.json`, Vite, Playwright, or `index.html` at repo root.
- Do not copy `_legacy_web/` or `web/` back to the product.

---

## Taste check (every Play / every device)

After a glop and a smear:

- Does it look like **tube oil on porcelain**, or like a game VFX?
- When the finger lifts, does it **stop**?
- Is the color the **tube**, or a muddy blend you did not ask for?
- Would a painter believe this still?
- On a phone: is the HUD thumb-reachable, and does the paint still look like paint without Lumen?

If no: fix sim and material. Do not ship a prettier web page.
