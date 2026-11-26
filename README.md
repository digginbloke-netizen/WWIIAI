# Road to Berlin '44

A WWII game in the browser where **the war runs itself and you lead a squad of Army Rangers inside it.**

1. **The front (AI-run, real time):** every 5 seconds (adjustable to 15 or 30 on the title screen) the front advances one day. Allied and German AI commanders move armies, reinforce, fortify and attack across a dynamic Western Front map from Normandy to Berlin, and every battle in progress fights another round until one side breaks.
2. **Ranger operations (first person):** whenever you like, you pick a sector on or behind the front and an enemy asset as your primary objective, then go in on foot with your squad. The war keeps moving while you're in the field, and everything you destroy hits the war effort the moment it blows, whether or not it was your objective.

No build step. Rendering uses [three.js](https://threejs.org) (vendored in `vendor/`) with post-processing: ambient occlusion, bloom, and a film grade with grain and vignette. The sky has procedural clouds. Surfaces use public-domain (CC0) photo textures from [Poly Haven](https://polyhaven.com) in `assets/tex/` (see `assets/tex/CREDITS.txt`). Models, foliage and props are generated in code, and every texture has a code-generated fallback. All sound is synthesized with WebAudio. The **Graphics** setting on the title screen (High / Medium / Low) scales the post-processing for slower PCs.

## Running

**Windows (easiest):** download [`dist/RoadToBerlin44.exe`](dist/RoadToBerlin44.exe) and double-click it. It contains the whole game and opens it in your default browser. Keep its console window open while you play and close it to quit. Windows SmartScreen may warn about an unrecognized app: click *More info*, then *Run anyway*.

To rebuild the executables (Windows, macOS, Linux), run `./build.sh`; it needs Go 1.22+.

**From source:** ES modules must be served over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## The front

- The front runs in real time: one front update every 5 seconds by default (15 or 30 selectable), each one game day, starting 6 June 1944. At the default speed the whole war takes about 30–40 minutes, and a single mission spans months of fighting. It pauses in menus, and you can pause it on the map.
- Battles last several days: every update, each battle fights a round with casualties on both sides until the defenders break or the attack runs out of steam.
- Weekly: reinforcements and supplies, new enemy assets, weather (which follows the seasons and grounds air support), and random events.
- The **Allied AI** brings up reserves, reinforces the line and launches combined offensives. It keeps garrisons behind and buys artillery and air support.
- The **German AI** shifts reserves to threatened sectors, fortifies, and counterattacks weak spots. A winter counteroffensive comes in December 1944.
- Supply comes from England and captured ports; cut-off regions wither. The liberation of Paris and Antwerp changes the balance.
- Left alone, the front usually wins, though it sometimes stalls or collapses. Ranger operations tip the sectors you hit.

## Ranger operations

- **Mission board:** operations appear with deadlines and point rewards. They expire if you don't take them.

| Mission | Objective | Effect on the war |
|---|---|---|
| Sabotage | Destroy an artillery/flak battery, fuel or ammo dump, command post, truck park or panzer laager | Local battle effects (see below) |
| Strategic raid | Demolish three key points of a factory, rail yard or fuel plant up to three regions behind the lines | German production, reinforcement flow or attack capacity drops until it's repaired (28 days) |
| Reconnaissance | Observe three German positions from cover | Next Allied attack on the sector hits much harder; assets revealed |
| Convoy ambush | Stop a German convoy crossing the sector | Garrison and German stocks drop |
| Snatch & grab | Kill a staff officer and recover his documents | German attack plans exposed for a month |
| Rescue | Free captured airmen and bring them out | Allied manpower and morale |

- **Full-size sectors:** every operation generates a fresh 1 km × 1 km sector to match the region: villages and towns joined by roads, bocage or stone-walled fields, woods, telegraph lines, craters toward the front, and beach defences on the coast.
- **AI with hidden objectives:** German garrisons hold villages and sites, patrols walk the roads, and a reaction force comes when the alarm goes up. If the sector is being fought over, Allied platoons are trying to take German positions or a German counterattack is pushing for the Allied side. You aren't told their orders; what they achieve feeds the strategic battle at every front update.
- **The squad:** you plus four named Rangers who gain experience (Green → Regular → Veteran → Elite). They hold fire while undetected and follow or hold on command. The fallen are replaced weekly. If you go down, you take over a surviving Ranger.
- **Points and the Quartermaster:** scoped M1903A4 Springfield, M1A1 Bazooka, SCR-300 radio (artillery), extra demolitions, medical kit, veteran replacements, Ranger school training.
- **Career:** promotions from 2nd Lt. to Lt. Col., medals (Purple Heart, Bronze Star, Silver Star, Distinguished Service Cross, Presidential Unit Citation) and a logbook.
- **Time:** the front runs at the chosen speed on the map. During an operation it advances a day per minute, since a raid takes hours, not months.

### Controls

| Key | Action |
|---|---|
| WASD / Mouse | Move / look |
| LMB / RMB | Fire / aim down sights |
| Shift / C / Space | Sprint / crouch / jump |
| R / G | Reload / throw grenade |
| F | Plant a demolition charge (near an asset or truck) |
| E | Interact: documents, prisoners, extraction |
| Q | Squad: hold position / follow me |
| H | Medical kit (if issued) |
| B | Radio for artillery (if issued) |
| M | Full sector map |
| Esc | Pause / pull the squad out |

## Code layout

```
js/main.js                 app flow (title → campaign → battle → campaign)
js/campaign/data.js        map regions, terrain, weather
js/campaign/geo.js         Voronoi region grid + adjacency
js/campaign/campaign.js    rules, supply, Allied and German AI, assets, mission configs
js/campaign/front.js       real-time front: daily battle rounds, operations, live sabotage effects
js/campaign/mapView.js     canvas map renderer
js/campaign/campaignUI.js  sector intel, squad roster, live battles, front clock
js/battle/world.js         procedural battlefield, collision, line of sight, navigation
js/battle/soldier.js       soldier models and bot AI
js/battle/player.js        first-person controller and view model
js/battle/battle.js        teams, flags, commanders, combat, support
js/battle/effects.js       particles, tracers, explosions, weather
js/battle/hud.js           HUD, minimap, kill feed, scoreboard
js/battle/mission.js       Ranger operation: AI groups with hidden objectives, mission types, alarm, convoy, extraction
js/battle/sector.js        1 km sector generator: settlements, roads, fields, woods, mission sites
js/battle/nav.js           AI navigation: 1 m occupancy grid, flow fields, A* with path smoothing, local steering
js/battle/guns.js          weapon models with iron-sight geometry
js/battle/models.js        soldiers, foliage, props and enemy-asset models
js/campaign/ops.js         mission board, strategic economy, points, quartermaster, career
js/audio.js                synthesized sound
```
