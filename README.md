# Road to Berlin '44

A WWII game in the browser where **the war runs itself and you lead a squad of Army Rangers inside it.**

1. **The front (AI-run, real time):** every 30 seconds the front advances one day. Allied and German AI commanders move armies, reinforce, fortify and attack across a dynamic Western Front map from Normandy to Berlin, and every battle in progress fights another round until one side breaks.
2. **Ranger operations (first person):** whenever you like, you pick a sector on or behind the front and an enemy asset as your primary objective, then go in on foot with your squad. The war keeps moving while you're in the field, and everything you destroy hits the war effort the moment it blows, whether or not it was your objective.

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

- The front runs in real time: one front update every 30 seconds, each one game day, starting 6 June 1944. It pauses in menus, and you can pause it on the map.
- Battles last several days: every update, each battle fights a round with casualties on both sides until the defenders break or the attack runs out of steam.
- Weekly: reinforcements and supplies, new enemy assets, weather (which follows the seasons and grounds air support), and random events.
- The **Allied AI** brings up reserves, reinforces the line and launches combined offensives. It keeps garrisons behind and buys artillery and air support.
- The **German AI** shifts reserves to threatened sectors, fortifies, and counterattacks weak spots. A winter counteroffensive comes in December 1944.
- Supply comes from England and captured ports; cut-off regions wither. The liberation of Paris and Antwerp changes the balance.
- Left alone, the front usually grinds to victory late in the campaign, and sometimes collapses. With Ranger operations, Berlin falls around week 40.

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
  - If a battle is under way in the sector, it plays out on one flank with dozens of soldiers. How it's going feeds into the strategic battle at every front update; if it's decided in front of you, that decides it.
  - Friendly patrols roam front-line sectors.
  - German guards and patrols start unaware. Gunfire, explosions and being spotted raise the alarm, and a reaction force then arrives to hunt the squad.
- **Your squad** is you plus four named Rangers. They hold fire while you're undetected, follow you or hold position on your order, and can be killed; replacements arrive the next week. If you go down, you take over a surviving Ranger.
- Plant demolition charges on assets, then extract at EXFIL. Sabotage takes effect immediately and lasts two weeks; front news reaches you in the field.
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
js/campaign/campaign.js    rules, supply, Allied and German AI, assets, missions
js/campaign/front.js       real-time front: daily battle rounds, operations, live sabotage effects
js/campaign/mapView.js     canvas map renderer
js/campaign/campaignUI.js  sector intel, squad roster, live battles, front clock
js/battle/world.js         procedural battlefield, collision, line of sight, navigation
js/battle/soldier.js       soldier models and bot AI
js/battle/player.js        first-person controller and view model
js/battle/battle.js        teams, flags, commanders, combat, support
js/battle/effects.js       particles, tracers, explosions, weather
js/battle/hud.js           HUD, minimap, kill feed, scoreboard
js/audio.js                synthesized sound
```
