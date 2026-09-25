# Impasto — Unreal Engine 5.8 mobile paint mixer

Photoreal oil on a porcelain tray. Top-down like YouTube #paintmixing. **REAL PAINT. REAL SIMS.**

This is an **Unreal Engine 5.8 C++ game** (`Impasto.uproject`) that targets **phones**. Tap a selected tube to dump a glop; drag a finger to smear. The palette knife is optional. Paint sits still until you touch it.

The old Vite / WebGL / Babylon trees (`_legacy_web/`, any leftover `web/`) are **not the app**. Do not ship a browser stand-in.

Cursor agents: read **[AGENTS.md](AGENTS.md)** (same text in `AGENT.md`) before changing anything.

## What you get

| Piece | Reality |
| --- | --- |
| Live oil | MLS-MPM in `Source/Impasto/Private/PaintMPM.cpp` (Hu et al. 2018). Not Niagara water. |
| Touch | Tap = glop of the selected tube. Drag = smear (never dumps color). **K** / HUD checkbox = palette knife. |
| HUD | UMG `UImpastoMixerWidget` — large swatches, viscosity slider, Blank, safe areas. Works in PIE and on device. |
| Desktop PIE | Lumen softboxes, TSR, 160² paint mesh. |
| Phone | Device profiles drop Lumen / VSM / path tracing. Mobile deferred + HDR so the clearcoat oil still looks wet. 112² mesh, fewer Jacobi iters. |

## Open on Windows (required before any phone package)

This cloud / Linux VM has **no Unreal Editor and no GPU**. There is **no local Pixel Stream here**. Build on a Windows PC.

1. Install **Unreal Engine 5.8** from the Epic Games Launcher.
2. Double-click `Impasto.uproject`.
3. First launch compiles `Impasto` / `ImpastoEditor` and writes:
   - `/Game/Impasto/Materials/M_OilPaint` (clearcoat dielectric, vertex color)
   - `/Game/Impasto/Materials/M_Porcelain`
   - `/Game/Impasto/Materials/M_SteelKnife`
   - `/Game/Maps/PaintTray`
4. **Play In Editor (Alt+P)** on the local GPU. Mouse = same as finger (click glop, drag smear).

`ImpastoGameMode` possesses `APaintStudioPawn` (tray, lights, MPM surface). The pawn is the studio. First PIE uses the engine template map so the editor can open before `PaintTray` exists; the packaged game default is `/Game/Maps/PaintTray`.

## How to paint

| Input | Action |
| --- | --- |
| Tap / click (no drag) | Dump a still bead of the selected tube |
| Drag finger / mouse | Smear only — never dumps color |
| **Blank** button or **R** | Clear the tray |
| Swatches or **1–0** | Select a tube |
| Viscosity slider or **[ ]** | Soft oil → tar |
| **Knife** checkbox or **K** | Optional palette scraper (shows the steel blade) |
| **- =** | Bead / contact size |
| **G** | Dump at cursor (editor) |

Tubes stay **exact**. Cover-wins splat. No Kubelka–Munk mixing in this slice.

## Package for a phone (Windows PC)

Open the project in the editor **once** first so materials and `/Game/Maps/PaintTray` exist. A cook without those assets will fail or ship default-gray oil.

### Android APK / AAB

1. Install the Android toolchain Epic documents for **UE 5.8**:
   - Android Studio + SDK
   - NDK (the version the 5.8 docs list — commonly r25c / r27)
   - JDK 17
2. Epic Launcher → UE 5.8 → **Options** → enable **Android** target platform.
3. In the editor: **Edit → Editor Preferences → Source Code** if you use VS, then **Edit → Project Settings → Platforms → Android**:
   - SDK / NDK / JDK paths (or accept Android Studio defaults)
   - Package name is already `com.impasto.paintmixer`
   - Orientation is `FullSensor` (portrait + landscape, safe-area HUD)
   - Vulkan on, arm64 on, ASTC + ETC2
4. **Platforms → Android → Package Project**:
   - **Android (AFS/ASTC)** or **Android (ETC2)** → APK for `adb install`
   - **Android (AAB)** when you want Play Store upload
5. Output lands under `Saved/StagedBuilds/Android*` or the folder you pick. Install with:

```bat
adb install -r Impasto-arm64.apk
```

Development packages use the debug keystore. For a store AAB: Project Settings → Android → Distribution Signing, then package **Shipping** + **For Distribution**.

### iOS (optional, needs a Mac)

iOS runtime settings are already in `Config/DefaultEngine.ini` (`com.impasto.paintmixer`, iOS 16, portrait + landscape). Cooking an IPA from Windows is not supported. On a Mac with Xcode and an Apple team:

1. Open the same `Impasto.uproject` in UE 5.8.
2. Project Settings → Platforms → iOS → Bundle Identifier + signing team.
3. **Platforms → iOS → Package Project**.

### Device profiles

`Config/DefaultDeviceProfiles.ini` + `[SystemSettingsAndroid]` / `[SystemSettingsIOS]` in `DefaultEngine.ini`:

- Lumen GI / Lumen reflections **off**
- Virtual shadow maps **off**
- Path tracing **off**
- Mobile **deferred** + HDR + MSAA so the oil clearcoat still reads as wet paint
- Android_Low falls back to forward + lower resolution

Do not replace the MLS-MPM solver with Niagara Fluids to “make it cheaper.”

## Pixel Streaming (optional, Windows PC only)

Pixel Streaming is enabled for **Win64 / Linux / Mac** only — it is stripped from phone packages.

On the Windows PC, PIE is enough. If you later want a remote desktop preview, use Epic’s UE 5.8 Pixel Streaming docs. `scripts/pixel-stream.sh` is a Linux helper (HTTP `127.0.0.1:43171`, streamer WS `8888`).

**This VM cannot run a Pixel Stream.** There is no editor binary and no GPU here. Do not stand up a WebGL preview as a substitute.

## Layout

```
Impasto.uproject
AGENTS.md / AGENT.md      product memory for Cursor
Source/Impasto/           runtime (MPM, pawn, UMG HUD, materials)
Source/ImpastoEditor/     first-run map + materials
Config/                   Android / iOS / device profiles / scalability
Shaders/PaintMPM.usf      GPU port (not dispatched yet)
_legacy_web/              rejected WebGL prototype
```
