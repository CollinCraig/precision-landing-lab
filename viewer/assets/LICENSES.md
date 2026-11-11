# Viewer assets and licenses

The 3D scene is **procedural**. The code in `viewer/world.js` makes all
geometry and all textures (facades, roofs, asphalt, pavers, pad markings,
safety net, light glows) at run time. This folder holds **no** binary assets.
Added asset size: **0 bytes**.

If you add an asset, use only CC0 sources (Poly Haven, ambientCG, Kenney).
Keep the total under 8 MB. Add one row to the table below for each file.

| File | Source URL | Author | License |
|---|---|---|---|
| (none) | | | |

## Libraries loaded from a CDN (not stored in this repository)

| Library | Exact version | URL | License |
|---|---|---|---|
| three.js core | 0.170.0 (r170) | https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js | MIT |
| three.js addons: `Sky`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`, `BufferGeometryUtils` | 0.170.0 | https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/ | MIT |
| IBM Plex Sans / Mono (page text) | Google Fonts | https://fonts.google.com/specimen/IBM+Plex+Sans | SIL OFL 1.1 |

The `Sky` addon uses the Preetham analytic sky model. It is code, not an image.
