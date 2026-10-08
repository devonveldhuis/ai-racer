# 008 – HUD and menus

Status: draft

## Goal
Make the game readable and pleasant to play: countdown overlay, timer, speed, inputs, finish screen.

## Requirements
- HTML/CSS overlay in `#ui` (no UI framework needed), driven by race events and per-frame state.
- Loading screen with progress while models load.
- Big centred countdown 3 / 2 / 1 / GO!
- During race: current time, best time on this seed (in-memory), checkpoint `k/n`, lap `l/L`, speed (km/h), current surface, and two small bars showing current `accelerator` and `steering` values (useful when an AI is driving), controller name.
- Paused overlay.
- Finish screen: total time, lap times, resets, off-track time, seed, buttons for *Restart (Enter)* and *New track (N)*.
- Small help line showing controls; toggle with `H`.
- Optional low-cost polish: wheel dust when on grass, simple minimap of the layout with the car dot.

## Acceptance criteria
- [ ] All elements above appear at the right moments and update live.
- [ ] HUD remains readable at 1280×720 and on a large monitor; no layout overlap.
- [ ] No noticeable frame rate drop from the HUD (DOM updates throttled or diffed).

## Out of scope
Sensor debug overlay (009).
