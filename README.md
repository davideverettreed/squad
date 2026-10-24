# Squad

Real-time squad tactics in the browser. You command a 13-man Marine rifle squad
(squad leader and three four-man fire teams) against an enemy squad, using fire
and maneuver on a 240 × 180 m map seen straight down, drawn as a military
topographic map.

Units are drawn with the billet symbols from the Marine rifle squad organization
figure: squad leader, fire team leader, automatic rifleman, grenadier, rifleman.
Blue is friendly, red is enemy.

## Play

Open `dist/index.html` in a browser. It is a single file with no install, and it
works with mouse or touch.

## What is modeled

- Selection at three levels: one Marine, a fire team, or the squad.
- Orders: walk, rush, crawl, bounding overwatch, assault, posture, fire control
  (fire at will, return fire, hold), area suppression, 40mm, hand grenades,
  take cover, fall back, halt, face. Five formations for teams and the squad.
- Loadout by billet: weapon, magazines, 40mm rounds, grenades, with load weight
  affecting speed.
- Line of sight over terrain height, walls, buildings, woods and tall grass.
- Spotting with fog of war and last-known enemy positions.
- Suppression: suppressed men shoot worse; pinned men go prone and will not
  move except by crawling.
- Wounds, casualties, team morale, broken teams falling back and rallying.
- Enemy AI: base of fire, flanking maneuver, assault, withdrawal after losses.
- Enemy organization is random for now. Specific foreign squad organizations
  come later.

Weapon and hit figures are game abstractions, tuned for play.

## Project layout

```
index.html      page and interface markup
css/style.css   interface styles
src/            game code (plain JavaScript, loaded in order)
  util.js       random numbers, math
  data.js       terrain, postures, weapons, billets, formations
  map.js        map generation, line of sight, pathfinding, cover search
  units.js      soldiers, fire teams, squads
  combat.js     spotting, fire, suppression, explosives, wounds
  orders.js     orders and movement
  ai.js         enemy AI
  symbols.js    billet symbols
  render.js     topographic map and unit drawing
  ui.js         panels, roster, briefing, debrief
  input.js      mouse, touch, keyboard
  main.js       mission setup and main loop
tools/build.js  inlines everything into dist/
```

Build with `node tools/build.js`.
