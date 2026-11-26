# Road to Berlin '44

A WWII game in the browser where **the war runs itself and you lead a squad of Army Rangers inside it.**

1. **The front (AI-run, turn-based):** Allied and German AI commanders move armies, reinforce, fortify and attack across a dynamic Western Front map from Normandy to Berlin. Every battle of the week is calculated at the same time.
2. **Ranger operations (first person):** each week you pick a sector on or behind the front and an enemy asset as your primary objective, then go in on foot with your squad. Everything you destroy in that area of operations feeds back into the war effort, whether or not it was your objective.

No build step and no external assets: graphics are generated procedurally with [three.js](https://threejs.org) (vendored in `vendor/`), and all sounds are synthesized with WebAudio.

## Running

**Windows (easiest):** download [`dist/RoadToBerlin44.exe`](dist/RoadToBerlin44.exe) and double-click it. It contains the whole game and opens it in your default browser. Keep its console window open while you play and close it to quit. Windows SmartScreen may warn about an unrecognized app: click *More info*, then *Run anyway*.

To rebuild the executables (Windows, macOS, Linux), run `./build.sh`; it needs Go 1.22+.

**From source:** ES modules must be served over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## The front

- Each turn is one week, starting 6 June 1944. Weather follows the seasons and grounds air support.
- The **Allied AI** brings up reserves, reinforces the line and launches combined offensives. It keeps garrisons behind and buys artillery and air support.
- The **German AI** shifts reserves to threatened sectors, fortifies, and counterattacks weak spots. A winter counteroffensive comes in December 1944.
- Supply comes from England and captured ports; cut-off regions wither. Random events and the liberation of Paris and Antwerp change the balance.
- Without Ranger operations the front often stalls. With them, Berlin can fall in about 30 weeks.

## Ranger operations

- Sectors bordering the Allied line, and one region deeper (behind enemy lines), hold **enemy assets**. Pick one as your primary objective:

| Asset | Effect on the war effort when destroyed |
|---|---|
| Artillery battery | Defender loses artillery support and a fortification level |
| Flak battery | Allied air power hits the sector hard this week |
| Fuel depot | No German counterattack from the sector; enemy supplies drop |
| Ammunition dump | Garrison strength −12 |
| Command post | Defense weakened, no counterattacks from the sector |
| Truck park | German manpower and supplies drop |
| Panzer laager | Garrison strength −15 |

- **The area of operations is alive:**
  - If a battle is happening in the sector that week, it plays out on one flank with dozens of soldiers, and the state you leave it in tips that battle's result.
  - Friendly patrols roam front-line sectors.
  - German guards and patrols start unaware. Gunfire, explosions and being spotted raise the alarm, and a reaction force then arrives to hunt the squad.
- **Your squad** is you plus four named Rangers. They hold fire while you're undetected, follow you or hold position on your order, and can be killed; replacements arrive the next week. If you go down, you take over a surviving Ranger.
- Plant demolition charges on assets, then extract at EXFIL. The week's battles are then resolved with everything you destroyed and killed factored in.
- A **skirmish** mode on the title screen keeps the classic three-flag battle on its own.

### Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look |
| LMB / RMB | Fire / aim down sights |
| Shift / C / Space | Sprint / crouch / jump |
| R / G | Reload / throw grenade |
| F | Plant a demolition charge (near an asset) |
| Q | Squad: hold position / follow me |
| E | Extract (at EXFIL) |
| B / V | Artillery / air strike (skirmish only) |
| M / Tab | Large map / scoreboard |
| Esc | Pause / pull the squad out |

## Code layout

```
js/main.js                 app flow (title → campaign → battle → campaign)
js/campaign/data.js        map regions, terrain, weather
js/campaign/geo.js         Voronoi region grid + adjacency
js/campaign/campaign.js    rules, supply, Allied and German AI, assets, missions, weekly resolution
js/campaign/mapView.js     canvas map renderer
js/campaign/campaignUI.js  sector intel, squad roster, operations, weekly report
js/battle/world.js         procedural battlefield, collision, line of sight, navigation
js/battle/soldier.js       soldier models and bot AI
js/battle/player.js        first-person controller and view model
js/battle/battle.js        teams, flags, commanders, combat, support
js/battle/effects.js       particles, tracers, explosions, weather
js/battle/hud.js           HUD, minimap, kill feed, scoreboard
js/audio.js                synthesized sound
```
