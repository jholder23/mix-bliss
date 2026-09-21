# Impasto — Unreal Engine 5.8

Top-down oil on a porcelain tray. Click a **glop** of tube paint, then fold it with a **palette knife**. No orbit camera, no extra tools, **no color mixing**.

It should read like an overhead YouTube #paintmixing macro: thick wet oil, sitting still until you scrape it.

This is an **Unreal Engine 5.8 C++ project**. The old Vite/Babylon mixer in `_legacy_web/` is not the product.

Cursor agents: read **[AGENTS.md](AGENTS.md)** (same text in `AGENT.md`) before changing anything.

## Open on Windows

1. Install **Unreal Engine 5.8** from the Epic Games Launcher.
2. Double-click `Impasto.uproject`.
3. First launch compiles `Impasto` / `ImpastoEditor`, writes oil/porcelain/steel materials and `/Game/Maps/PaintTray`.
4. Play In Editor (**Alt+P**). Use the local GPU. Pixel Streaming is optional and not required.

`ImpastoGameMode` spawns `APaintStudioPawn` even on the default template map: fixed overhead camera, tray, knife, Lumen softboxes.

## How to paint

- **Click** — dump a still bead of the selected tube.
- **Drag** — scraper only (the knife never dumps color).
- **G** dump · **R** blank · **1–0** tubes · **[ ]** viscosity · **- =** size.

Paints sit side by side or **cover**. Kubelka–Munk mixing is not in this slice.

## Viscous paint

Live solver: **MLS-MPM** in `Source/Impasto/Private/PaintMPM.cpp` (Hu et al. 2018) — 80², quadratic B-splines, APIC **C**, Tait pressure, Batty–Bridson Jacobi viscosity. No in-plane gravity. Sleeps dead-still when the knife is up.

Niagara Fluids is enabled but is **not** the oil. `Shaders/PaintMPM.usf` is a GPU port **not dispatched yet**. Surface: procedural mesh, clearcoat dielectric, vertex tube color, height from mass.

## Layout

```
Impasto.uproject
AGENTS.md / AGENT.md      product memory for Cursor
Source/Impasto/           runtime (sim, pawn, HUD, materials)
Source/ImpastoEditor/     first-run map + materials
Shaders/PaintMPM.usf      GPU port (not live)
_legacy_web/              rejected WebGL prototype
```
