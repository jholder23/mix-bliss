# Impasto

Top-down oil on a porcelain tray. Glop a still bead, then fold it with a palette knife. No orbit camera, no extra tools.

It is meant to read like an overhead #paintmixing macro: thick wet oil, sitting still until you scrape it.

## Run it

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:43147**. The project pins that port. WebGL2 with floating-point color buffers is required.

```bash
npm run build
npm run preview
```

## How to mix

- **Glop** — tap the tray to lay a still bead of the selected tube. Drag to space more beads. Holding still does not keep pumping.
- **Scraper** — a palette knife. Drag to strain and fold existing paint. It never dumps color.
- **Blank tray** — wipe everything off.
- **Viscosity** — soft oil through impasto to tar. Thicker paint resists and marbles longer.
- **Size** — bead radius and knife width.

Paint stays in the tray. At rest the surface is frozen (zero velocity). Only the knife wakes it.

## Solver

This is not Houdini, and it is not the old Babylon particle-blob look.

- **MLS-MPM** (Hu, Fang, Ge, Qu, Zhu, Pradhana, Jiang, SIGGRAPH 2018) on a 2D tray grid, with quadratic B-splines and APIC affine transfers. Implementation follows Hu’s 88-line solver and nialltl’s MLS-MPM notes.
- **Newtonian fluid stress** from nialltl: Tait-style pressure from gathered density, plus a weak explicit viscous term from the velocity gradient **C**.
- **Implicit viscosity** on the grid after P2G (Batty & Bridson 2008 idea, cheap decoupled Jacobi — not a full variational Stokes solve). That is what makes oil sit instead of splash.
- **No in-plane gravity.** A level tray does not crawl.
- **Sleep:** when speeds fall below a threshold and the knife is up, velocity and **C** are zeroed and the solver skips.

Pigments are Kubelka–Munk **K/S** spectra from `src/km.ts`, carried as mass on particles. Overlapping cells mix by mass, so two tubes fold and marble instead of RGB-lerping to brown. Homogenization is slow on purpose.

Rendering is a high-resolution Gaussian film of mass + K + S, shaded as an opaque wet layer with a simple dielectric glint. No IBL, SSR, DoF, or grain this pass.

## Tests

```bash
npm run test:unit
```

Covers KM mixing only (blue+yellow → green, and so on).

## Limits

Interactive MLS-MPM on a modest grid, not a studio solver. Extreme folds can homogenize faster than real impasto. Lighting is a stand-in for a copy-stand key, not measured oil BRDF. If WebGL2 float targets are missing, the page says so and stops.
