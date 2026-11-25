# Road to Berlin '44

A two-layer WWII game that runs in the browser:

1. **Strategic layer (turn-based)** – command the Allied campaign on a dynamic Western Front map from the Normandy landings to Berlin.
2. **Tactical layer (first person)** – personally lead any battle as a soldier, fighting alongside and against dozens of AI soldiers. The outcome is written back into the campaign.

No build step, no external assets: graphics are generated procedurally with [three.js](https://threejs.org) (vendored in `vendor/`), and all sounds are synthesized with WebAudio.

## Running

**Windows (easiest):** download [`dist/RoadToBerlin44.exe`](dist/RoadToBerlin44.exe) and double-click it. It contains the whole game and opens it in your default browser. Keep its console window open while you play and close it to quit. Windows SmartScreen may warn about an unrecognized app: click *More info*, then *Run anyway*.

To rebuild the executables (Windows, macOS, Linux), run `./build.sh`; it needs Go 1.22+.

**From source:** ES modules must be served over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Strategic layer

- Each turn is one week, starting on 6 June 1944. Weather changes with the season and grounds air support.
- **Offensives**: plan up to two attacks per week (three after Paris is liberated or you enter Germany). Troops can be pooled from every adjacent Allied region into one combined offensive. Buy artillery barrages, which also suppress fortifications, and air strikes with supplies.
- **Logistics**: Southern England and captured ports supply your armies. Regions cut off from supply lose 10% of their troops each week and can't be reinforced.
- **Reinforce, move and fortify** with manpower and supplies.
- **German AI**: it moves reserves toward threatened sectors, fortifies, and counterattacks weak Allied regions. A scripted winter counteroffensive hits in December 1944.
- **Events**: Resistance sabotage, convoys, storms, panzer reserves, and the liberation of Paris and Antwerp.
- **Victory**: capture Berlin, or reduce Germany to three regions. You are relieved of command if the war isn't won by summer 1945.

Every battle can be **led in first person** or **auto-resolved**.

## Tactical layer

- Campaign troop strength becomes tickets. Up to 48 soldiers per side are on the field at once (configurable), and reinforcements stream in as men fall.
- Flags A, B and C sit on a procedurally generated battlefield that matches the region's terrain: hedgerow bocage, towns, ruined cities, forests, hills, or a beach landing with hedgehogs and bunkers. Fortification level adds sandbags, strongpoints and bunkers. Rain, snow and fog effects follow the campaign weather.
- **Bot AI**: commanders assign squads to objectives. Soldiers path-find with flow fields, use fire-and-maneuver, take cover behind real obstacles, get suppressed, throw grenades, retreat when wounded and flee live grenades.
- **Player**: three kits per side (M1 Garand / Thompson / BAR vs Kar98k / MP40 / MG42), aim down sights, recoil, grenades, and artillery and air strikes from the support you bought on the campaign map.
- Holding most flags drains the enemy's tickets. The battle ends when a side runs out of tickets, when the attacker holds every flag for 45 seconds, or when the time limit expires.

### Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look |
| LMB / RMB | Fire / aim down sights |
| Shift / C / Space | Sprint / crouch / jump |
| R / G | Reload / throw grenade |
| B / V | Call artillery / air strike at crosshair |
| M / Tab | Large map / scoreboard |
| Esc | Pause (leave battle and let commanders finish it) |

## Code layout

```
js/main.js                 app flow (title → campaign → battle → campaign)
js/campaign/data.js        map regions, terrain, weather
js/campaign/geo.js         Voronoi region grid + adjacency
js/campaign/campaign.js    rules, supply, Axis AI, auto-resolve, turn flow
js/campaign/mapView.js     canvas map renderer
js/campaign/campaignUI.js  side panel, orders, battle list
js/battle/world.js         procedural battlefield, collision, line of sight, navigation
js/battle/soldier.js       soldier models and bot AI
js/battle/player.js        first-person controller and view model
js/battle/battle.js        teams, flags, commanders, combat, support
js/battle/effects.js       particles, tracers, explosions, weather
js/battle/hud.js           HUD, minimap, kill feed, scoreboard
js/audio.js                synthesized sound
```
