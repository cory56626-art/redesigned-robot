# Realistic Deferred — Vibrant Visuals Shader

A **realistic** shader pack for **Minecraft: Bedrock Edition** built on the official
**Vibrant Visuals** deferred-rendering pipeline. Targeted at **Windows 10/11, high-end PC**.

> **About "v26.21":** Bedrock's public versioning is `1.21.x`. This pack targets the Vibrant
> Visuals engine baseline `min_engine_version 1.21.120` (the first stable build with the full
> deferred lighting/atmospherics/water/color-grading schemas). It works on that build and newer.

## What it does

| Feature | How it's delivered |
| --- | --- |
| **Soft directional shadows & lighting** | `lighting/global.json` — physically-based sun (keyframed ~108,000 lx noon → warm at dawn/dusk), soft blue moonlight, low ambient, full sky indirect intensity. |
| **Atmospheric realistic sky** | `atmospherics/atmospherics.json` — Rayleigh/Mie scattering keyframed across the day for blue mid-day skies and warm sunrise/sunset horizons. |
| **Reflective / refractive water + caustics** | `water/water.json` — clear blue ocean tuning, 28-octave waves, animated underwater caustics. (SSR + IBL reflections are automatic in the deferred pipeline.) |
| **Volumetric fog & god rays (light shafts)** | `fogs/default_fog_settings.json` — height-based volumetric air fog and tuned underwater media coefficients; light shafts are produced by the volumetric pass. |
| **Bloom & filmic tone mapping** | `color_grading/color_grading.json` — **ACES** filmic operator, subtle contrast/saturation, 6700K white balance. Bloom is driven automatically by HDR highlights + emissive light. |
| **Colored point lights w/ dynamic shadows** | `local_lighting/local_lighting.json` — torches, lanterns, end rods, lava, glowstone, sea lanterns. |
| **PBR fallbacks** | `pbr/global.json` — sensible metalness/roughness defaults so vanilla blocks/mobs look right without per-texture authoring. |

### A note on water reactivity
Bedrock's Vibrant Visuals water is a **flat, image-based animated surface** — the docs state
explicitly that waves *don't move the surface geometry and don't react to entities*. So true
physics-style ripples when a player jumps in (Blender/sim-app behavior) are **not possible** through
a resource pack; that needs an engine-level feature Bedrock doesn't expose. This pack instead uses
livelier wave motion (30 octaves, higher depth/speed) so the surface feels alive, and vanilla splash
particles still fire on entry.

### A note on shadow edges
Deep, grounded shadows are tuned here via low sky/ambient fill and shadow-range color grading.
However the **hard pixel/blocky edge** of shadows is the engine's shadow-map resolution, set by the
in-game **Settings → Video → Shadow Quality** slider — raise it to High for the softest edges. A
resource pack cannot override that resolution.

### A note on waving plants
Waving foliage in Bedrock is handled by the engine's built-in vertex animation; there is no
Vibrant Visuals JSON to toggle it independently, so it's not a separate config here. It's active
in-game when Vibrant Visuals is enabled. Full custom plant waving would require PBR texture-set
authoring per block (out of scope for this lighting-focused pack).

## Install

1. Double-click **`RealisticDeferred.mcpack`** — Minecraft imports it automatically.
2. In a world: **Settings → Video → Graphics Mode → check "Vibrant Visuals"**.
3. Apply the pack under **Settings → Resource Packs → My Packs** (activate, then create/enter the world).

Requires **Minecraft Bedrock 1.21.120+** on a device that supports Vibrant Visuals (Windows 10/11 PC recommended for high-end settings).

## Folder structure

```
RealisticDeferred/
├── manifest.json
├── pack_icon.png
├── lighting/global.json
├── atmospherics/atmospherics.json
├── water/water.json
├── color_grading/color_grading.json
├── fogs/default_fog_settings.json
├── local_lighting/local_lighting.json
└── pbr/global.json
```

## Tuning

Every numeric value is editable. Sky/lighting use **keyframe JSON** (keys are `0.0`–`1.0` time of
day; `0.0`/`1.0` = noon, `0.5` = midnight). Lower `color_grading` contrast/saturation for a flatter
look, or swap the tone-mapping `operator` to `hable`/`generic` for a different filmic curve.

Schemas: [Vibrant Visuals docs](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/vvresourcepacks).

## Changelog

### 1.1.0 — Realistic shadow & lighting pass
- **Deeper, contrastier shadows:** sky indirect intensity `1.0 → 0.38`, ambient `0.018 → 0.007`
  (cooler), plus dedicated shadow-range color grading (darkened + slightly desaturated darks).
- **Slightly dimmer / less washed:** midtone gain `1.0 → 0.96`, contrast `1.12 → 1.22`, highlights
  tamed so midday isn't blown out.
- **Longer raking shadows:** sun orbital offset `25° → 55°` so shadows stretch across the ground.
- **Neutral real-life daylight:** near-white noon sun, 6500K white balance (warm only at dawn/dusk).
- **Livelier water:** 30 octaves, higher wave depth/speed. (Surface is still non-reactive — engine
  limitation; see notes above.)
