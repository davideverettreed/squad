# Squad

Real-time squad tactics in the browser. You command a 13-man Marine rifle squad
(squad leader and three four-man fire teams) against an enemy squad, using fire
and maneuver on a 3 × 3 km map (nine 1 km grid squares) seen straight down.

The battlefield is a printed 1:25,000-style map sheet on a planning table, in
the standard colors of US military topographic maps (FM 3-25.26): black for
man-made features and the grid, red-brown for contours (5 m, index every 25 m)
and elevations, blue for water, green for vegetation, red for the paved road.
It has a full collar: title, grid values, legend, graphic scale and
declination diagram. Each map is generated: rolling hills with 60–110 m of
relief, streams in gullies and ponds, fields with hedgerows and stone walls,
orchards, vineyards, woods, a paved road, dirt tracks, named villages and
farms. The sheet is drawn at three levels of detail as you zoom.

Zoomed out, each fire team (then the squad) is one square counter with the
standard unit symbol. Zoomed in, men are round game pieces printed with the billet symbols from the Marine rifle squad
organization figure: squad leader, fire team leader, automatic rifleman,
grenadier, rifleman. Status chits sit on the pieces (posture, suppressed or
pinned, wounded, no ammunition). Orders are drawn as overlay graphics in the
doctrinal colors: blue friendly, red enemy, black for targets.

## Play

Open `dist/index.html` in a browser. It is a single file with no install, and it
works with mouse or touch.

## Website and Android app

`docs/` is the website, built for GitHub Pages: the game at the root of the
site, installable as an app on Android and desktop, and playable offline after
the first visit. Hosting is not switched on yet. To switch it on:

1. On GitHub, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**,
   the branch to **main** and the folder to **/docs**, then **Save**.
3. After a minute or two the game is at
   `https://davideverettreed.github.io/squad/`.

To install on Android, open that address in Chrome and choose **Install app**
(or **Add to Home screen**) from the menu.

## What is modeled

- Selection at three levels: one Marine, a fire team, or the squad.
- Orders: walk, rush, crawl, bounding overwatch, assault, posture, fire control
  (fire at will, return fire, hold), area suppression, 40mm, hand grenades,
  take cover, fall back, halt, face. Five formations for teams and the squad.
- Loadout by billet: weapon, magazines, 40mm rounds, grenades, with load weight
  affecting speed.
- Line of sight over terrain height, walls, buildings, woods, orchards,
  vineyards and tall grass. Squads start about 1 km apart; time runs up to 16×.
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
web/            app manifest, service worker and icons for the website
tools/build.js  inlines everything into dist/ and builds the website in docs/
tools/make-icons.js  draws the app icons into web/icons
```

Build with `node tools/build.js`. Rebuild and commit `docs/` with every change
so the website stays current.
