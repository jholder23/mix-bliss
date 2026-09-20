# Impasto

A 3D wet-paint mixer built in **Babylon.js**. The tray lives in a studio you can orbit from any direction. Paint is a viscous particle fluid with subsurface wrap lighting, a clear coat, and screen-space ray-marched reflections when the GPU allows it.

This is the ASMR swirl, not a studio tool.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (this project pins **43147**).

```bash
npm run build
npm run preview
```

## How to mix

- **Glop** — tap the dish to dump a 3D mound of the selected tube color. Drag to lay spaced beads. Holding still does not keep pumping.
- **Finger / Knife / Stick** — fold existing paint only. They never dump color.
- **Look** — drag to orbit. **Right-drag** (or middle-drag) always orbits, even while a mix tool is selected.
- **Camera angles** — Top, 3/4, Side, Low, Back, Under. Under looks up through the dish.
- **Viscosity** — water through honey to tar (the particle fluid gets heavier and glossier).
- **Scrape** — wipe the tray.

Scroll to zoom. The simulation is position-based (PBD-style) particles colliding in a porcelain bowl, rendered as instanced icospheres with a GGX coat and translucency.

WebGL2 is required.
