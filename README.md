# Impasto — Unreal Engine 5.8

Top-down oil on a porcelain tray. Click a **glop** of tube paint, then fold it with a **palette knife**. No orbit camera, no extra tools, **no color mixing**.

It is meant to read like an overhead YouTube #paintmixing macro: thick wet oil, sitting still until you scrape it.

This repository is an **Unreal Engine 5 C++ project**. The old Vite/WebGL prototype is not the product.

## Engine version

**Unreal Engine 5.8** (`Impasto.uproject` → `EngineAssociation: "5.8"`).

5.7 will usually open it if you switch the association and regenerate project files. Pixel Streaming infrastructure must match the engine (branch `UE5.8`).

## How to open

1. Install UE 5.8 from the Epic Games Launcher, or clone/build [EpicGames/UnrealEngine](https://github.com/EpicGames/UnrealEngine) **5.8** (GitHub account must be linked at [unrealengine.com/ue4-on-github](https://www.unrealengine.com/ue4-on-github)).
2. Double-click `Impasto.uproject`, or:

```bash
# Linux example — adjust the engine path
"$UE_ROOT/Engine/Binaries/Linux/UnrealEditor" "$(pwd)/Impasto.uproject"
```

3. First editor launch compiles the `Impasto` / `ImpastoEditor` modules, writes `/Game/Maps/PaintTray` and the oil/porcelain/steel materials, then Play In Editor.

Play (Alt+P). The studio pawn is the default: fixed overhead camera, tray, knife, Lumen softboxes.

## How to paint

- **Click** the tray — dump a still bead of the selected tube.
- **Drag** — scraper strain only (the knife never dumps color).
- **G** — dump at the cursor.
- **R** — blank tray.
- **1–0** — tube colors (cadmium red … mars black).
- **[ ]** — viscosity (soft oil → tar).
- **- =** — bead / knife size.

Paints sit side by side or cover. Kubelka–Munk mixing is intentionally not in this slice.

## Viscous paint

This is **not** Niagara Fluids 3D (that plugin is enabled for later; it is a water/gas FLIP, not still-until-touched oil).

Live solver: **MLS-MPM** (Hu et al., SIGGRAPH 2018) on an 80² tray grid — quadratic B-splines, APIC affine **C**, Newtonian Tait-style pressure, **implicit viscosity** after P2G (Batty & Bridson 2008, cheap decoupled Jacobi). No in-plane gravity. When the knife is up and speeds fall, velocity and **C** are zeroed and the field sleeps.

The same kernels live in `Shaders/PaintMPM.usf` for a GPU dispatch chapter. The shipping path is the C++ solver in `Source/Impasto/Private/PaintMPM.cpp`. The surface is a dense procedural mesh (clearcoat dielectric, vertex tube color, height from particle mass). Cover rule: the strongest splat wins; colors are not blended.

Lighting: overhead rect-light softboxes + skylight, Lumen GI/reflections, TSR. Path Tracer is available (`r.PathTracing 1` / the viewport mode) once a GPU is present.

## Pixel Streaming

Uncommon HTTP port **43171** (not 3000 / 5173 / 8080). Signalling WebSocket **8888**. Bind loopback.

```bash
./scripts/pixel-stream.sh
```

The script looks for `UnrealEditor`, clones [PixelStreamingInfrastructure](https://github.com/EpicGamesExt/PixelStreamingInfrastructure) branch `UE5.8` if needed, starts Cirrus on `127.0.0.1:43171`, then launches:

```text
UnrealEditor Impasto.uproject /Engine/Maps/Templates/Template_Default -game
  -PixelStreamingURL=ws://127.0.0.1:8888
  -PixelStreamingIP=127.0.0.1
  -ForceRes -ResX=1280 -ResY=720
```

Open **http://127.0.0.1:43171**.

If the editor binary is missing, the script prints the blocker and exits. It will not start a WebGL stand-in.

## This cloud VM

This environment **cannot run UE5**:

| Need | This VM |
| --- | --- |
| UE 5.8 editor/binaries | Not installed. `github.com/EpicGames/UnrealEngine` is 404 without an Epic-linked GitHub login. |
| GPU / Vulkan | None (`nvidia-smi` missing, `/dev/dri` empty). Pixel Streaming of Lumen oil needs a real GPU. |
| RAM / CPU | 16 GB, 4 vCPU — tight even if binaries existed. |
| Disk | ~226 GB free — enough for a **prebuilt** Linux editor, not a comfortable source build. |
| Docker | Not installed. Official `ghcr.io/epicgames/unreal-engine` images also require EULA + GitHub auth. |

### What a follow-up needs

1. **Epic account** linked to GitHub (or Launcher install of 5.8 on a workstation).
2. **GPU** with current Vulkan/NVIDIA or AMD drivers (Linux or Windows).
3. Optionally a **secret** `EPIC_GITHUB_TOKEN` / engine drop if you want agents to download Linux binaries here.
4. **32 GB RAM** recommended for the editor.

Until then Pixel Streaming is **not up**. There is no preview URL.

## Layout

```
Impasto.uproject
Source/Impasto/           runtime module (sim, pawn, HUD, materials)
Source/ImpastoEditor/     first-run map + material cook
Config/
Shaders/PaintMPM.usf      GPU port (not dispatched yet)
scripts/pixel-stream.sh
```
