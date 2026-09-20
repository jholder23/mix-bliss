# Impasto

A 3D wet-paint mixer. The tray sits in a small studio you can orbit from any direction. Paint is a viscous particle fluid that piles into real mounds, then gets rendered as a continuous oil surface with thickness-based subsurface scattering, a GGX clearcoat, contact shadows, and ray-marched reflections.

It is framed like the viral macro HD oil-mixing videos: shallow focus, studio softbox, wet-film grain.

This is the ASMR swirl, not a studio tool.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints. This project pins **port 43147**.

```bash
npm run build
npm run preview
```

WebGL2 is required. Software renderers (SwiftShader included) still get the 3D camera, volume, and wet-oil lighting — just a bit softer.

## Tests

Playwright looks at the running 3D mixer: the WebGL canvas, camera chips, glop color, and mix tools. Headless Chromium is enough — no screen recordings.

```bash
npm test
```

or

```bash
npm run test:e2e
```

The suite reuses Vite on **port 43147** if it is already running; otherwise it starts `npm run dev`. Screenshots from a run land in `test-results/`.

## How to mix

- **Glop** — tap the dish to dump a 3D mound of the selected tube color. Drag to lay spaced beads. Holding still does not keep pumping.
- **Finger / Knife / Stick** — fold existing paint only. They never dump color.
- **Look** — left-drag to tumble the camera in any direction.
- **Right-drag or middle-drag** always orbits, even while a mix tool is selected.
- **Scroll** (or pinch) to zoom. Arrow keys also orbit.
- **Camera angles** — 3/4, Top, Front, Side, Low, Back, Under. Under looks up at the dish from below. You can keep dragging past the horizon to flip underneath.
- **Viscosity** — water through honey to tar. Heavier paint sits up; thinner paint slumps and mixes faster.
- **Scrape** — wipe the tray.

The fluid is a 3D particle pile colliding in the bowl. Each frame it is splatted into a height field so the surface reads as one wet body instead of a handful of grapes.

## Lighting

The paint shader is built to look like wet oil on a software GPU:

- Thickness-based **subsurface scattering** (chromatic; red travels farther)
- **GGX** specular plus a tight **clearcoat**
- World-space **ray-marched reflections** of neighboring mounds and the porcelain
- **Contact shadows** along the key light
- Studio **IBL** (softbox + window) so highlights move when you orbit

The default view is a 3/4 **macro** close-up. ACES tone mapping, shallow depth of field, gentle grain, chromatic aberration, and vignette grade the frame like an HD camera. SwiftShader drops DoF/SSR but keeps the filmic grade.
