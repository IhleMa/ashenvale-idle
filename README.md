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
| `DATA_DIR` | `./data` | Where accounts and player saves are stored (JSON files) |
| `ALLOW_REGISTRATION` | `true` | Set to `false` to block new accounts |
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
├── zones/          whispering_woods.png, …              (combat backgrounds)
├── encounters/     ashen_crypt.png, ashen_colossus.png, …
├── achievements/   first_blood.png, …
└── ui/             logo.png, background.png
```

**[ASSETS.md](ASSETS.md)** lists all 176 file names, each with a ✅ or ⬜ to show whether it's present. To use a different file name, map it in `public/assets/manifest.json`.

---

## How the game works

| System | Summary |
|---|---|
| **Hero** | Permanent main character: +8% attributes, an extra ability slot, +1 attribute point per level, a bonus ability point every 5 levels, +10% XP, a Leadership aura at level 10 and a hero-only class title at level 40. The hero can't be dismissed and is always in the party. |
| **Classes** | Warrior (tank), Mage, Rogue, Ranger (damage) and Cleric (healer). Each has its own attributes, attribute scaling, resource (Rage/Mana/Energy/Focus), 7 abilities and class titles. |
| **Recruitment** | A rotating tavern of recruits with random classes and traits. The roster holds up to 12 companions. |
| **Party** | 3 saved presets with up to 4 members each. Position affects who enemies target first, and each member has a role (Tank, Healer, Damage, Support). A balanced party and class variety give synergy bonuses. |
| **Combat behaviour** | Every ability has its own rule: activation conditions (AND/OR, nested groups, NOT), a target selector and target requirements. Abilities are tried in priority order, and changes apply to the fight that's already running. |
| **Equipment** | 8 slots and 6 rarities, from Common to Mythic. Items have level requirements, random affixes and class restrictions. You can compare, lock, sell and auto-sell items. |
| **Enemies** | 5 zones, each with a boss. Bosses have phases (summons, defensive shells, enrage) and an enrage timer. Beating a zone's boss unlocks the next zone. |
| **Idle & offline** | The server runs your fights continuously while you're online. When you come back after being away (up to 8 h), the same combat engine fast-forwards those fights using server time. |
| **Multiplayer** | Groups of up to 4 players with invitations, leader controls and chat. Co-op encounters: a dungeon, an elite hunt, a challenge and a world boss. Enemies scale with group size and every player gets their own loot. |
| **Progression** | XP and levels up to 60, attribute points, ability ranks, class titles, 16 achievements and statistics. |

---

## Project structure

```
shared/            Game rules, used by both the server and the browser
  config.js        ← all balance numbers in one place
  data/            classes, abilities, statuses, items, enemies, zones, achievements (data-driven)
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

- **New ability:** add an entry to `shared/data/abilities.js` with `effects` and a `defaultRule`. The combat engine and the behaviour editor pick it up automatically.
- **New class:** add an entry to `shared/data/classes.js` and give it abilities with `classId: '<your class>'`.
- **New enemy/zone/encounter:** add entries to `enemies.js` and `zones.js`.
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
4. **Updates:** with *Auto Update = 1*, every restart runs `git pull` to fetch the latest code. Player data in `data/` is never touched.
5. **Images on the server:** commit them to `public/assets/` in the repo (recommended, so they arrive with updates), or upload them with the panel's File Manager into `public/assets/<folder>/`. Uploaded files sit outside git and survive updates. Don't upload a file with the same name as one that's also committed to the repo, or `git pull` will refuse to update.
6. **Backups:** back up the `data/` folder, which holds all accounts and saves. The panel's Backups feature works for this.

**HTTPS / domain (optional):** put nginx, Caddy or Cloudflare in front of the port and proxy both HTTP and WebSocket (`/ws`) traffic. Set *Trust Proxy* to `true`.
