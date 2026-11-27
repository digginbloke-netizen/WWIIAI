# Road to Berlin '44

A WWII game in the browser where **the war runs itself and you lead a squad of Army Rangers inside it.**

1. **The front (AI-run, real time):** every 5 seconds (adjustable to 15 or 30 on the title screen) the front advances one day. The map is divided into a lettered grid; each grid square of land is a battle sector, and the 34 provinces (Normandy, Caen, Paris, the Ruhr, Berlin…) are made up of several sectors each. Allied and German AI commanders move armies, reinforce, fortify and attack sector by sector from Normandy to Berlin, and every battle in progress fights another round until one side breaks.
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
- **News from the front:** you only hear about battles in the sector where your Ranger company is (the gold star on the map), plus anything that happens to a whole province: Allied troops breaking into it, the province liberated or lost, or its defenders cut off. The company moves to the sector of each operation you take, or you can move it to any Allied-held sector from the sector panel. Province names are on the map, and the top bar counts sectors and whole provinces held.
- Weekly: reinforcements and supplies, new enemy assets, weather (which follows the seasons and grounds air support), and random events.
- The **Allied AI** brings up reserves, reinforces the line and launches combined offensives. It keeps garrisons behind and buys artillery and air support.
- The **German AI** shifts reserves to threatened sectors, fortifies, and counterattacks weak spots. A winter counteroffensive comes in December 1944.
- Supply comes from England and captured ports; cut-off sectors wither. Liberating the whole Paris province, or taking the port of Antwerp, changes the balance.
- Left alone, the front usually wins, though it sometimes stalls or collapses. Ranger operations tip the sectors you hit.

## Ranger operations

- **Mission board:** operations appear with deadlines and point rewards. They expire if you don't take them. Whenever the Germans attack Allied ground, a Defense mission for that sector joins the board.

| Mission | Objective | Effect on the war |
|---|---|---|
| Sabotage | Destroy an artillery/flak battery, fuel or ammo dump, command post, truck park or panzer laager | Local battle effects (see below) |
| Strategic raid | Demolish three key points of a factory, rail yard or fuel plant up to five sectors behind the lines | German production, reinforcement flow or attack capacity drops until it's repaired (28 days) |
| Reconnaissance | Observe three German positions from cover | Next Allied attack on the sector hits much harder; assets revealed |
| Convoy ambush | Stop a German convoy crossing the sector | Garrison and German stocks drop |
| Snatch & grab | Kill a staff officer and recover his documents | German attack plans exposed for a month |
| Rescue | Free captured airmen and bring them out | Allied manpower and morale |
| Defense | Hold an Allied-held sector under German attack: dig in with the defenders and break several assault waves, each preceded by a barrage | Hold it and the German attack on the sector fails; lose the position and the sector falls |

- **Full-size sectors:** every operation generates a fresh 1 km × 1 km sector to match the sector: villages and towns joined by roads, bocage or stone-walled fields, woods, telegraph lines, craters toward the front, and beach defences on the coast.
- **Fortified front lines:** sectors on the front (or heavily fortified ones) get a German trench line across the whole sector: earth parapets in zigzag bays with sandbagged crests and timber revetments, wire belts, concrete bunkers, MG nests and dugouts, with passages through the line and shell holes in no man's land. Garrisons man the firing steps facing the Allied side, and Allied platoons can be ordered to take sections of the line.
- **Artillery with its own fire missions:** a German battery (on the map if the sector has one, otherwise off-map) shells the squad's last known position once spotters raise the alarm, drops defensive fire on Allied troops it can see, and harasses the roads. When the Allies are attacking the sector, their guns fire preparation barrages before platoon assaults, counter-battery fire on German guns that give themselves away, and fire on German counterattacks. You get an *INCOMING!* warning, and soldiers near the blasts go to ground. Destroying the battery silences it; if an earlier sabotage cut the sector's artillery, there is no off-map battery.
- **Houses you can enter:** every house has a real front door (often a back door too), open window frames with shutters and stone sills, a plank floor, and a ceiling. Two-storey houses have a staircase to the first floor. Bullets stop at the walls and pass through the windows and doors. Ruins are roofless shells with broken walls and a rubble heap inside, so they work as strongpoints too. Floors above the first are closed off.
- **Soldiers in period uniform:** GIs and Rangers wear the M1941 field jacket, olive-drab trousers, canvas leggings and the M1 helmet (some with netting, Rangers with the orange diamond), with the M1923 cartridge belt, suspenders, canteen, haversack and shovel. German soldiers wear the field-grey tunic with stand collar, collar tabs and four pockets, marching boots and the M35 Stahlhelm (or the M43 field cap), with black leather Y-straps, three-cell or MP40 pouches, bread bag, canteen, spade, bayonet and the fluted gas-mask canister.
- **Animation:** soldiers carry their rifles low on patrol and across the body at the run, crouch-run between cover, kneel to fire, go flat under shellfire, kick with recoil, work the action or change magazines with the weapon canted down, wind up and throw grenades, flinch when hit and shuffle when turning. Idle sentries look around. Deaths vary: knees buckle, men fall forward, backward or sideways, and explosions throw them away from the blast.
- **Battle chatter:** subtitled shouts, Americans in English and Germans in German ("Contact front!", "Reloading!", "Fire in the hole!", "Man down!", "Wer da?", "Alarm! Alarm!", "Granate!", "Sanitäter!"). A suspicious sentry calling out is your cue to freeze. The Battle chatter setting turns it off.
- **AI with hidden objectives:** German garrisons hold villages and sites, patrols walk the roads, and a reaction force comes when the alarm goes up. On top of that, an operations director keeps launching squads with their own orders for both sides throughout the mission. You aren't told what they are; you find out by running into them, from the field radio, and in the debrief.
  - *Allied:* platoon assaults on German positions (with artillery preparation), holding positions they've taken, engineer teams that blow up German depots and gun sites (which hurts the war effort just like your own demolitions), recon patrols to the German line, forward observers who speed up the Allied guns, and defensive posts when the Germans are the ones attacking. Behind the lines, the occasional OSS-style team goes after an asset.
  - *German:* reinforcement columns that refill bled garrisons, counterattacks to retake lost positions or break into the Allied side, Stosstrupp trench raids, forward observers who direct the German battery onto Allied troops, security patrols and supply parties.
  - *Houses:* both sides send squads to garrison houses near their positions. The men go in through the door, climb the stairs, and each takes a window facing the enemy, where they stay and fight instead of running for cover. Garrisons and defenders holding a position also take nearby windows. For a bigger attack, two platoons coming in from different parts of the line link up at a house first, then go in together.
  - Positions change hands. Fresh companies arrive every five minutes, and the **Soldiers per side** setting caps how many mobile troops each side has in the field at once (on top of the garrisons). Everything they win or lose moves the strategic battle.
- **The squad:** you plus four named Rangers who gain experience (Green → Regular → Veteran → Elite). They hold fire while undetected and follow or hold on command. They follow you into buildings and up the stairs, and if you give the hold order inside a house, each one takes a window. The fallen are replaced weekly. If you go down, you take over a surviving Ranger.
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
js/campaign/data.js        provinces, the sector grid built from them, terrain, weather
js/campaign/geo.js         sector adjacency and sea lanes
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
js/battle/chatter.js       battle chatter: English/German shouted lines as subtitles
js/battle/director.js      operations director: AI squads with their own objectives for both sides
js/battle/mission.js       Ranger operation: AI groups with hidden objectives, artillery batteries, mission types, alarm, convoy, extraction
js/battle/sector.js        1 km sector generator: settlements, roads, fields, woods, trench lines, mission sites
js/battle/nav.js           AI navigation: 1 m occupancy grid, flow fields, A* with path smoothing, local steering, building doors and firing posts
js/battle/guns.js          weapon models with iron-sight geometry
js/battle/models.js        soldiers, foliage, props and enemy-asset models
js/campaign/ops.js         mission board, strategic economy, points, quartermaster, career
js/audio.js                synthesized sound
```
