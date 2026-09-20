# Impasto

A finger-first wet-paint mixer for the browser. Drag through glossy color, change how thick it feels, and ignore every practical painting instinct. This is the ASMR swirl, not a studio tool.

## Are there apps like this already?

Yes. None of them are quite “a palette you mash with your finger,” but these get close:

**Closest to the satisfying videos**

- **[Magic Fluids](https://magicfluids.net/)** — iPhone and Android. The usual recommendation: touch-reactive smoke, water, and paint-like swirls with viscosity-ish physics knobs, particles, and presets. Android can use it as a live wallpaper.
- **Fluid Magic: ASMR Antistress** — Android. Full-screen fluids with viscosity, density, and shine controls, plus sound.
- **[DabDab](https://apps.apple.com/us/app/dabdab/id6758517131)** — iPhone. Color dabs that ripple and merge. Built as a toy, not a drawing app.
- **SuperPaint: Fluid Art** — iPhone. Touch-driven fluid paint with gravity and mix controls.
- **Paint Splash: Splatter Art** — Android. Drips, flings, thickness, and spin art using the accelerometer.

**More like actual painting (thicker pigment, still tactile)**

- **FocalPaint** — iPhone. Serious thick-paint / pigment mixing, including a palette mixer. Closer to oil than to those folding-paint videos.
- **Oilbook** — iPhone. Fluid-mechanics oil simulation; you can loosen or tighten the paint.
- **Oleosa** — iOS and Android. Oil textures with a “fluid engine” that pulls paint toward your finger.

If you want the *video* feeling — a loaded finger, honey-thick color, no composition homework — Magic Fluids and this page are the right neighborhood. Impasto is the web version of that toy: open it on a phone, add it to the home screen, and stir.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (this project pins **43147**). On a phone, use the same Wi-Fi address, or deploy the `dist` folder anywhere static files are served.

```bash
npm run build
npm run preview
```

## How to mix

- **Drag** to stir. Highlights follow your finger.
- **Tap** to drop a blob of the selected tube.
- **Finger: loaded** lays color down as you drag. **Clean** only pushes what is already there.
- **Viscosity** runs from water (eddies, fast mixing) through cream and honey (slow, glossy folds) to tar (paste that barely moves unless you shove it).
- **Pour** dumps a fresh mess. **Scrape** wipes the linen.
- **Sound** is optional wet noise, tied to how fast you stir.

Works with mouse, trackpad, and multi-touch. WebGL2 is required.
