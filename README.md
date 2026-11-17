# Ashenvale Idle

A multiplayer idle RPG that runs in the browser. Create a hero, recruit companions, put together a balanced party, and set up exactly how every ability is used in combat. Combat then runs on its own. You can team up with other players for dungeons, elite hunts and world bosses.

- **Server-authoritative:** all combat, loot, XP and offline progress is calculated on the server, so client clocks and modified browsers can't cheat.
- **No build step:** plain ES modules. Run `npm install` and `npm start`, then open the game in a browser.
- **Bring your own art:** drop images into `public/assets/`. Anything missing shows a generated placeholder. See **[ASSETS.md](ASSETS.md)**.

---

## Quick start (local)

Requires **Node.js 20+**.

```bash
npm install
npm start            # http://localhost:8080
```

Create an account in the browser and choose a class. Your first companion is free.

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-restart when files change |
| `npm test` | End-to-end smoke test (accounts, actions, battles, groups, co-op, offline progress) |
| `npm run simulate -- 14 ashen_barrows 100 warrior,cleric,mage,rogue` | Balance simulator using the real combat engine |
| `npm run assets` | Regenerate `ASSETS.md`, the checklist of all image names |

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `SERVER_PORT` | `8080` | HTTP/WebSocket port (`SERVER_PORT` is set automatically by Pterodactyl) |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Folder of the SQLite database `ashenvale.db` (accounts, saves, auction house, settings) and its backups |
| `BACKUP_HOURS` | `24` | Automatic database backup interval into `data/backups/` (newest 7 kept); `0` turns it off |
| `ALLOW_REGISTRATION` | `true` | Initial value for registrations (can be toggled later on the Admin page) |
| `ADMIN_USERS` | | Comma-separated usernames with admin rights |
| `TRUST_PROXY` | `false` | Set to `true` behind nginx or Cloudflare so rate limiting sees real IPs |

---

## Adding images

Every visual looks up a **key** such as `enemies/wolf` and uses `public/assets/enemies/wolf.png` (or .webp/.jpg/.svg/...) if that file exists. You don't need to restart anything: refresh the browser, or use *Progression → Reload artwork*.

```
public/assets/
├── classes/        warrior.png, mage.png, rogue.png, cleric.png, ranger.png
├── portraits/      warrior_1.png, mage_female.png, …   (extra appearance choices per class)
├── abilities/      fireball.png, heal.png, execute.png, …
├── items/          sword.png, staff.png, plate_chest.png, … (+ optional sword_legendary.png)
├── enemies/        wolf.png, goblin_chieftain.png, …
├── statuses/       poison.png, shield_wall.png, …
├── skilltree/      keystone.png, notable.png, rank.png   (optional node icons)
├── zones/          whispering_woods.png, …              (combat backgrounds)
├── encounters/     ashen_crypt.png, ashen_colossus.png, …
├── achievements/   first_blood.png, …
├── buildings/      town_hall.png, inn.png, blacksmith.png, …
├── materials/      ore.png, arcane_dust.png, …
├── professions/    mining.png, alchemy.png, …
├── elixirs/        might.png, wisdom.png, …
├── expeditions/    copper_hills.png, ley_line_nexus.png, …  (destination art)
└── ui/             logo.png, background.png
```

**[ASSETS.md](ASSETS.md)** lists every file name, each with a ✅ or ⬜ to show whether it's present. To use a different file name, map it in `public/assets/manifest.json`.

---

## How the game works

| System | Summary |
|---|---|
| **Hero** | Permanent main character: +8% attributes, an extra ability slot, a bonus skill tree point every 5 levels, +10% XP, a Leadership aura at level 10 and a hero-only class title at level 40. The hero can't be dismissed and is always in the party. |
| **Classes** | Warrior (tank), Mage, Rogue, Ranger (damage) and Cleric (healer). Each has its own attributes, attribute scaling, resource (Rage/Mana/Energy/Focus), 7 abilities and class titles. |
| **Passive skill tree** | A Path of Exile-style web for each class. You start at the Origin in the middle, which grants your first ability, and spend 1 point per level on any node connected to your tree. Four themed branches are linked by rings and bridges, so there are many routes. The tree holds every ability (7 per class), "Empowered" nodes that raise ability ranks, attribute nodes, branch masteries, notables and an outer keystone per branch. About 109 nodes per class, roughly 70 points at max level, so you have to choose. Hover a node to preview the path and click to allocate the whole path. Refund single nodes or reset the tree for gold. Companions can auto-allocate. |
| **Recruitment** | A rotating tavern of recruits with random classes and traits. The roster holds up to 12 companions. |
| **Party** | 3 saved presets with up to 4 members each. Position affects who enemies target first, and each member has a role (Tank, Healer, Damage, Support). A balanced party and class variety give synergy bonuses. |
| **Combat behaviour** | Every ability has its own rule: activation conditions (AND/OR, nested groups, NOT), a target selector and target requirements. Abilities are tried in priority order, and changes apply to the fight that's already running. |
| **Combat log & damage meter** | The log is split into categories you can toggle: ability hits, auto-attacks, DoT and HoT ticks, heals, buffs, status effects, dodges and key events. It also has presets and can be filtered by source or unit, crits only, a minimum amount and text search. Filters are remembered. The damage meter shows damage, healing, damage taken and casts for the current fight, the last fight or the session. Click any unit for a breakdown by ability and by target or source, with hits, crit %, average, max, DPS/HPS and overheal. |
| **Equipment** | 8 slots and 6 rarities, from Common to Mythic. Items have level requirements, random affixes and class restrictions. You can compare, lock, sell and auto-sell items. |
| **Enemies** | 5 zones, each with a boss. Bosses have phases (summons, defensive shells, enrage) and an enrage timer. Beating a zone's boss unlocks the next zone. |
| **Idle & offline** | The server runs your fights continuously while you're online. When you come back after being away (up to 8 h), the same combat engine fast-forwards those fights using server time. |
| **Multiplayer** | Groups of up to 4 players with invitations, leader controls and chat. Co-op encounters: a dungeon, an elite hunt, a challenge and a world boss. Enemies scale with group size and every player gets their own loot. |
| **Town & professions** | A garrison-style town you build up over time, with construction timers.<br>• **Town Hall:** caps building levels and allows more constructions at once.<br>• **Inn:** sets your roster size and how many recruits are offered.<br>• **Salvage Yard:** breaks items into materials (metal, leather, cloth, gems, plus arcane dust, essences, shards and void crystals from better items). Auto-loot can salvage instead of selling.<br>• **Expedition Camp:** sets how many expeditions can run at once, how many recruits each can take, and which destinations are unlocked.<br>• **Blacksmith, Leatherworker, Tailor, Jeweler:** craft gear up to Masterwork quality and reforge old gear to a higher item level.<br>• **Enchanter's Study:** adds a permanent bonus stat to any item.<br>• **Alchemy Lab:** brews timed party elixirs (damage, defense, XP, gold, all stats) that also apply offline.<br>Every recruit has one of 8 professions with its own skill level, and crafting buildings need a worker with the matching profession. **Workers live in town and don't fight.** |
| **Expeditions** | Send 1–3 recruits to one of 7 destinations for 15 min to 8 h. They bring back ore, herbs, gems, scraps and arcane materials, with occasional lucky finds. More recruits, higher levels and the matching profession (Mining, Herbalism, Jewelcrafting…) mean a bigger haul. Recruits on an expedition can't fight or work until they return. The server calculates the rewards when you claim them. |
| **Uniques & item sets** | 12 named unique items with special effects, such as ignite on hit, Renew on heal, damage reflection, cooldown reset on kill, cheaper abilities or bonus damage to bosses. There are also 5 four-piece sets with 2- and 4-piece bonuses. Both drop mainly from bosses and elites (bosses about 4% unique and 6% set piece) and are never auto-sold. Effects are data-driven "procs" in `shared/data/legendaries.js`. |
| **Auction house** | Players list items or material stacks for a fixed buyout price for 12, 24 or 48 h. You can browse with filters (slot, rarity, uniques & sets, usable by one of your characters, level, sorting) and see recent average sale prices. A listing fee and a sales tax act as gold sinks; both are adjustable. Proceeds, expired items, gifts and overflow loot arrive in the **mailbox**. |
| **Ashen Crystals 💠 (premium currency)** | Finishes a town construction or brings an expedition back instantly, with full rewards. The cost scales with the time remaining: by default 1 crystal per 10 minutes, so an 8 h expedition costs 48. The rate is adjustable on the Admin page. Crystals are only obtainable through admin gifts, delivered by mail. The server charges at most the price the player saw. |
| **Admin page** | Only visible to admins.<br>• **Dashboard:** players online, accounts, uptime, memory, auctions, and an announcement box.<br>• **Announcements:** pop up for everyone online and are kept on the server, so players who were offline see them as soon as they log in (shown for 1/3/7/30 days or until deleted). Players can re-read them via the 📢 button in the top bar; admins can delete them from the dashboard.<br>• **Live settings:** XP, gold and loot rates; offline cap; auction fee and tax; registrations on/off; message of the day.<br>• **Player management:** search, details, kick, timed or permanent bans, gifts of gold, Ashen Crystals, materials or items (including specific uniques and set pieces) by mail, password reset, account deletion.<br>• **Audit log** of every admin action. |
| **Rankings & inspect** | Leaderboards for hero level, party power, hero power, kills, bosses, co-op wins, achievements and world progress. You can filter by class and search. Inspect any player to see their current activity, group, stats and progress, plus the full hero build: attributes, gear, a skill tree preview, notables, and the loadout with behaviour rules. You can also see their party and invite them from there. Gold and inventory are never shown, and players can make their build private in Settings. |
| **Progression** | XP and levels up to 60, skill tree points, ability ranks, class titles, 16 achievements and statistics. |

---

## Project structure

```
shared/            Game rules, used by both the server and the browser
  config.js        ← all balance numbers in one place
  data/            classes, abilities, statuses, items, enemies, zones, achievements (data-driven)
  skilltree.js     passive tree rules (allocation, refunds, paths, auto-allocate)
  rules.js         behaviour rule engine (conditions, target selectors, validation)
  combat.js        deterministic combat simulation (no DOM, seeded RNG)
  stats.js         stat calculation (single source of truth)
  character.js     levels, XP, abilities, auto-development
  party.js         party synergy
  encounters.js    encounter generation & rewards
server/            Node.js server: HTTP, WebSocket, auth, persistence, battle loop, groups
public/            Browser client (vanilla JS modules + CSS)
  assets/          ← put your images here
tools/             simulator, smoke test, asset checklist
pterodactyl/       Pterodactyl egg
```

### Adding content

- **New ability:** add an entry to `shared/data/abilities.js` with `effects` and a `defaultRule`, then place it in the class's tree in `shared/data/skilltree.js` (`abilities: { ring: 'ability_id' }`). The combat engine, tree and behaviour editor pick it up automatically.
- **Skill tree:** each class tree is generated from a short spec in `shared/data/skilltree.js` (branches, attribute themes, ability rings, notables/keystones). Ring sizes, links and node values are in `TREE_CONFIG`. Changing the number of rings or branches changes node ids. Existing saves are cleaned up automatically, and points on removed nodes are refunded.
- **New class:** add an entry to `shared/data/classes.js` and give it abilities with `classId: '<your class>'`.
- **New enemy/zone/encounter:** add entries to `enemies.js` and `zones.js`.
- **Town:** buildings, materials, professions, elixirs and costs are in `shared/data/town.js`. Expedition destinations are in `shared/data/expeditions.js`. The formulas for salvage, crafting, enchanting and gathering are in `shared/town.js`.
- **New behaviour condition or target selector:** add it to the registries in `shared/rules.js`. The editor dropdowns update themselves.
- **Balance:** use `shared/config.js` and `ENEMY_TUNING` in `shared/data/enemies.js`, then check the result with `npm run simulate`.

---

## Hosting on Pterodactyl

1. In the panel go to **Admin → Nests**, create a nest (e.g. "Games") or use an existing one, then **Import Egg** and upload `pterodactyl/egg-ashenvale-idle.json`.
2. **Create a server** with the *Ashenvale Idle* egg:
   - Docker image: *Node.js 22*
   - Memory: 512 MB is plenty for a small community; 1 GB for many players
   - Allocate one port. That's the game's web port.
   - **Git Repository** defaults to `https://github.com/IhleMa/ashenvale-idle`. If the repository is **private**, also fill in **Git Username** and **Git Access Token**. The token needs read access to the repository; for a fine-grained token, that's "Contents: Read-only".
3. Start the server. Once the console shows `listening on`, players can open **`http://<your-server-ip>:<port>`** in a browser.
4. **Updates without kicking players.** Type `update` in the server **console**. It pulls the newest version from GitHub and tells you what to do:
   - *"Client-only update applied live"*: only browser files changed (the UI in `public/`). Nothing restarts. Every open game page refreshes itself within a second or two and players keep fighting.
   - *"A RESTART is required"*: server or game-rule files changed (`server/`, `shared/`). Press **Restart** in the panel when it suits you. Players see a short "server is updating" banner, reconnect automatically when it's back (usually 5–15 s), and the page reloads to the new version. They don't need to log in again, their groups are kept, and no progress is lost.
   - New **images** never need either: just upload them and players see them after a refresh.

   With *Auto Update = 1*, every restart also runs `git pull`. Player data in `data/` is never touched.

   Other console commands: `players` (who is online), `say <message>` (announcement from "Server", e.g. `say Restarting in 2 minutes!`; players who are offline still see it on their next login within 24 h), `reload-clients` (refresh every open page), `admin add|remove|list <username>`, `backup` (database snapshot now), `db` (database size and counts), `help`.
7. **Admins:** set the server variable **Admin Users** (e.g. `alice,bob`) or type `admin add alice` in the console. Admins get an extra **🛡 Admin** page in the sidebar after refreshing.
5. **Images on the server:** commit them to `public/assets/` in the repo (recommended, so they arrive with updates), or upload them with the panel's File Manager into `public/assets/<folder>/`. Uploaded files sit outside git and survive updates. Don't upload a file with the same name as one that's also committed to the repo, or `git pull` will refuse to update.
6. **Saves & backups:** everything is stored in one SQLite database, `data/ashenvale.db`. The server keeps the game in memory and writes all changes every 5 seconds in a single transaction. Trades, mail, crystal speed-ups and admin actions are written immediately, so an item or gold can never be duplicated or lost half-way through a trade, even on a crash.
   - The server makes a consistent backup every 24 h into `data/backups/` (the newest 7 are kept); type `backup` in the console for one right now. The panel's Backups feature also works. Prefer the files in `data/backups/` if you restore by hand, because they are safe to copy while the server runs.
   - **Restore:** stop the server, replace `data/ashenvale.db` with a backup file (and delete `ashenvale.db-wal` / `ashenvale.db-shm` if present), start again.
   - **Upgrading from the old JSON saves:** nothing to do. On the first start the server imports `accounts.json`, `players/` and the other JSON files and moves them into `data/json-backup-<date>/`.
   - To look inside the database, download it and open it with [DB Browser for SQLite](https://sqlitebrowser.org/) (players are stored as JSON in the `players` table). Only edit a copy while the server is stopped.

### Own subdomain + HTTPS

Ready-made configs are in `deploy/` (`nginx-ashenvale.conf` and `Caddyfile`).

1. **DNS:** at your domain provider, add an **A record**: name `play` (or whatever subdomain you want), value = the public IP of the machine running Wings / the game server. (If you use Cloudflare, set it to *DNS only* / grey cloud while getting the certificate.)
2. **Reverse proxy on that machine** (nginx is usually already installed there if the Panel runs on it too):
   ```bash
   sudo cp deploy/nginx-ashenvale.conf /etc/nginx/sites-available/ashenvale.conf
   sudo nano /etc/nginx/sites-available/ashenvale.conf      # set your subdomain + allocation port
   sudo ln -s /etc/nginx/sites-available/ashenvale.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo apt install -y certbot python3-certbot-nginx         # if not installed yet
   sudo certbot --nginx -d play.example.com                  # free HTTPS certificate, auto-renews
   ```
3. In the Pterodactyl panel set the server variable **Trust Proxy** to `true` and restart.
4. Players open **https://play.example.com**. WebSockets automatically switch to `wss://`.

Ports 80 and 443 must be open in your firewall (`sudo ufw allow 80,443/tcp`).
