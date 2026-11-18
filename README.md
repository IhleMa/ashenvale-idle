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
| `npm test` | Quick tests (content, editor, tutorial, saves, smoke test, HTTPS) — about a minute |
| `npm run test:full` | Everything, including the slow town/endgame simulations and 4 h of bot play |
| `npm run simulate -- 14 ashen_barrows 100 warrior,cleric,mage,rogue` | Balance simulator using the real combat engine |
| `npm run assets` | Regenerate `ASSETS.md`, the checklist of all image names |

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `SERVER_PORT` | `8080` | HTTP/WebSocket port (`SERVER_PORT` is set automatically by Pterodactyl) |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Folder of the SQLite database `ashenvale.db` (accounts, saves, auction house, settings) and its backups |
| `APP_NAME` | `Ashenvale Idle` | Name of the installed app (`APP_SHORT_NAME` for the label under the icon) |
| `BACKUP_HOURS` | `24` | Automatic database backup interval into `data/backups/` (newest 7 kept); `0` turns it off |
| `ALLOW_REGISTRATION` | `true` | Initial value for registrations (can be toggled later on the Admin page) |
| `ADMIN_USERS` | | Comma-separated usernames with admin rights |
| `TRUST_PROXY` | `false` | Set to `true` behind nginx or Cloudflare so rate limiting sees real IPs |
| `TLS_MODE` | `off` | HTTPS: `off`, `auto` (Let's Encrypt) or `files` (own certificate) — see "Own subdomain + HTTPS" |
| `DOMAIN` | | Domain for HTTPS (comma separated for several) |
| `ACME_CHALLENGE` | `dns-cloudflare` | `dns-cloudflare` (with `CLOUDFLARE_API_TOKEN`, optional `CLOUDFLARE_ZONE_ID`) or `http` (needs `HTTP_PORT` reachable as port 80) |
| `ACME_EMAIL` / `ACME_STAGING` | | Let's Encrypt e-mail; `1` = staging (test) certificates |
| `TLS_CERT` / `TLS_KEY` | `data/tls/fullchain.pem` / `data/tls/privkey.pem` | Certificate files for `TLS_MODE=files` |
| `HTTP_PORT` | | Optional second port: `http://` → `https://` redirects and Let's Encrypt http checks |

---

## Adding images

Every visual looks up a **key** such as `enemies/wolf` and uses `public/assets/enemies/wolf.png` (or .webp/.jpg/.svg/...) if that file exists. You don't need to restart anything: refresh the browser, or use *Progression → Reload artwork*.

```
public/assets/
├── classes/        warrior.png, mage.png, rogue.png, cleric.png, ranger.png
├── portraits/      warrior_1.png, mage_female.png, …   (extra appearance choices per class)
├── abilities/      fireball.png, heal.png, execute.png, …
├── minions/        skeleton.png, ember_imp.png, bone_golem.png, spirit_wisp.png
├── items/          sword.png, staff.png, plate_chest.png, … (+ optional sword_legendary.png)
├── gems/           ruby… one per stat: str.png, critChance.png, … (optional per tier: str_1.png … str_5.png)
├── enemies/        wolf.png, goblin_chieftain.png, …  (also shown in the Bestiary)
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
└── ui/             logo.png, background.png, app-icon-192.png + app-icon-512.png (installed-app icon)
```

**[ASSETS.md](ASSETS.md)** lists every file name, each with a ✅ or ⬜ to show whether it's present. To use a different file name, map it in `public/assets/manifest.json`.

---

## How the game works

| System | Summary |
|---|---|
| **Hero** | Permanent main character: +8% attributes, an extra ability slot, a bonus skill tree point every 5 levels, +10% XP, a Leadership aura at level 10 and a hero-only class title at level 40. The hero can't be dismissed and is always in the party. |
| **Classes** | Warrior (tank), Mage, Rogue, Ranger (damage), Cleric (healer) and Summoner. Each has its own attributes, attribute scaling, resource (Rage/Mana/Energy/Focus/Soul Energy), 7 abilities and class titles. The **Summoner** raises minions that fight beside the party — Skeleton Warriors, Ember Imps, a taunting Bone Golem and a healing Spirit Wisp — and has spells that work with them: Dark Pact empowers them, Soul Link heals, shields and extends them, Corpse Explosion detonates one for area damage. Its skill tree improves minion health, damage, duration and count. Minions appear as small cards under their summoner with a countdown, and share one row in the damage meter. |
| **Passive skill tree** | A Path of Exile-style web for each class. You start at the Origin in the middle, which grants your first ability, and spend 1 point per level on any node connected to your tree. Four themed branches are linked by rings and bridges, so there are many routes. The tree holds every ability (7 per class), "Empowered" nodes that raise ability ranks, attribute nodes, branch masteries, notables and an outer keystone per branch. About 109 nodes per class, roughly 70 points at max level, so you have to choose. Hover a node to preview the path and click to allocate the whole path. Refund single nodes or reset the tree for gold. Companions can auto-allocate. |
| **Recruitment** | A rotating tavern of recruits with random classes and traits. The roster holds up to 12 companions. |
| **Party** | 3 saved presets with up to 4 members each. Position affects who enemies target first, and each member has a role (Tank, Healer, Damage, Support). A balanced party and class variety give synergy bonuses. |
| **Combat behaviour** | Every ability has its own rule: activation conditions (AND/OR, nested groups, NOT), a target selector and target requirements. Abilities are tried in priority order, and changes apply to the fight that's already running. |
| **Combat log & damage meter** | The log is split into categories you can toggle: ability hits, auto-attacks, DoT and HoT ticks, heals, buffs, status effects, dodges and key events. It also has presets and can be filtered by source or unit, crits only, a minimum amount and text search. Filters are remembered. The damage meter shows damage, healing, damage taken and casts for the current fight, the last fight or the session. Click any unit for a breakdown by ability and by target or source, with hits, crit %, average, max, DPS/HPS and overheal. |
| **Equipment** | 8 slots and 6 rarities, from Common to Mythic. Items have level requirements, random affixes and class restrictions. You can compare, lock, sell and auto-sell items. |
| **Zones & enemies** | 12 zones spread over levels 1–60 (about 6 levels each): Whispering Woods, Ashen Barrows, Mirefen Marsh, Emberfall Caverns, Sunscorch Dunes, Sunken Temple, Frostpeak, Stormspire Heights, Crimson Keep, Shadowfell, Dragonbone Wastes and the Voidscar — each with its own enemies and a boss. Bosses have phases (summons, defensive shells, enrage) and an enrage timer. Beating a zone's boss unlocks the next zone. **Every zone has exclusive drops:** its own crafting material (~2% per kill, 3–5 from the boss) and 1–2 unique or set items that only drop there (rifts count as the zone they are themed on). The combat page shows what drops only in the current zone, so going back to a lower zone for a material or a unique is a real choice. |
| **Progression pace** | Reaching level 60 takes about 2 weeks for a daily player (≈ 175 hours of fighting, offline included; tune it in Admin → 📈 XP curve). Features open up along the way: Quests at hero level 4, Bestiary 6, Auction House trading 8 (the mailbox always works), Co-op 12 (dungeons at 12, 20, 30 and 45), Rifts 15, Gems 20 (`config.json` → `featureUnlocks`). Locked pages show 🔒 and the level in the menu; a hero that ascended once keeps everything unlocked. |
| **Idle & offline** | The server runs your fights continuously while you're online. When you come back after being away (up to 8 h), the same combat engine fast-forwards those fights using server time. |
| **Multiplayer** | Groups of up to 4 players with invitations, leader controls and chat. Co-op encounters: a dungeon, an elite hunt, a challenge and a world boss. Enemies scale with group size and every player gets their own loot. |
| **Town & professions** | A garrison-style town you build up over time, **up to level 10** per building. Construction takes from a minute (level 1) to hours (level 5) and days (level 10; Town Hall level 10 ≈ 3.75 days), and every level from 2 on needs **zone materials** (level 2: Sylvan Sap from the Whispering Woods … level 10: Dragonbone and Void Ichor). Some buildings open at a hero level (Blacksmith/Leatherworker/Tailor 5, Alchemy Lab 10, Enchanter 16, Jeweler 20). Superior and Masterwork crafts also need the material of the zone that fits the item level.<br>• **Town Hall:** caps building levels and allows more constructions at once.<br>• **Inn:** sets your roster size and how many recruits are offered.<br>• **Salvage Yard:** breaks items into materials (metal, leather, cloth, gems, plus arcane dust, essences, shards and void crystals from better items). Auto-loot can salvage instead of selling.<br>• **Expedition Camp:** sets how many expeditions can run at once, how many recruits each can take, and which destinations are unlocked.<br>• **Blacksmith, Leatherworker, Tailor, Jeweler:** craft gear up to Masterwork quality and reforge old gear to a higher item level.<br>• **Enchanter's Study:** adds a permanent bonus stat to any item.<br>• **Alchemy Lab:** brews timed party elixirs (damage, defense, XP, gold, all stats) that also apply offline.<br>Every recruit has one of 8 professions with its own skill level, and crafting buildings need a worker with the matching profession. **Workers live in town and don't fight.** |
| **Expeditions** | Send 1–3 recruits to one of 7 destinations for 15 min to 8 h. They bring back ore, herbs, gems, scraps and arcane materials, with occasional lucky finds. More recruits, higher levels and the matching profession (Mining, Herbalism, Jewelcrafting…) mean a bigger haul. Recruits on an expedition can't fight or work until they return. The server calculates the rewards when you claim them. |
| **Uniques & item sets** | 19 named unique items with special effects, such as ignite on hit, Renew on heal, damage reflection, cooldown reset on kill, cheaper abilities or bonus damage to bosses. There are also 5 four-piece sets with 2- and 4-piece bonuses. Both drop mainly from bosses and elites (bosses about 4% unique and 6% set piece) and are never auto-sold. Effects are data-driven "procs" in `content/legendaries.json`. |
| **Auction house** | Players list items or material stacks for a fixed buyout price for 12, 24 or 48 h. You can browse with filters (slot, rarity, uniques & sets, usable by one of your characters, level, sorting) and see recent average sale prices. A listing fee and a sales tax act as gold sinks; both are adjustable. Proceeds, expired items, gifts and overflow loot arrive in the **mailbox**. |
| **Ashen Crystals 💠 (premium currency)** | Finishes a town construction or brings an expedition back instantly, with full rewards. The cost scales with the time remaining: by default 1 crystal per 10 minutes, so an 8 h expedition costs 48. The rate is adjustable on the Admin page. Crystals are only obtainable through admin gifts, delivered by mail. The server charges at most the price the player saw. |
| **Loot filter** | Inventory → 🧹 Loot filter. An ordered list of rules; for each drop, the first matching rule decides whether it is kept, salvaged into materials or sold. Rules can check rarity, slot, item level (fixed, or "N+ levels below my hero"), "no class in my roster can use it", and "has any of / none of" these stats. Presets cover common cases, and **Keep** rules placed above act as exceptions. Uniques, set items and locked items are always kept. "Protect upgrades" never removes an item that would raise one of your characters' power. "Run on inventory now…" shows a preview and then cleans up your bag. Every filtered drop appears under 📜 Filtered loot with the rule that caught it. Auto-salvaged items count toward "Salvage N items" quests. |
| **Gems & sockets** | **Shards:** salvaging an item turns every stat on it into stat shards (e.g. *Strength Shard*); higher item level and rarity give more. This includes items the loot filter salvages. Shards are materials, so they can be traded on the Auction House. **Gems:** at the 💎 Gems page a jewelcrafter at the Jeweler cuts **50 shards** of one stat (+150g, 4 Gem Fragments) into a *Chipped* gem. Three gems fuse into the next tier: Chipped → Flawed → Polished → Flawless → Perfect, needing Jeweler level 1–5 and extra gold and materials. One gem type exists per stat (Ruby = Strength, Topaz = Crit Chance, …). A Perfect gem is worth about one full affix of a level-60 item. The jeweler's skill gives up to 20% chance of a bonus gem. **Sockets:** about 14% of drops have sockets; Legendary and better always have at least one. The maximum depends on slot and rarity (weapons/armor up to 3, helmet/off-hand 2, others 1). The Jeweler can drill missing sockets (socket #1 needs level 2, #2 level 3, #3 level 5). Socketing is free. Removing a gem keeps it, for a small gold fee. Selling or salvaging returns socketed gems to your pouch. Tune it in `content/gems.json`. |
| **Bot players** | Bots make the world feel alive while you test with friends. They are real accounts driven by a small AI that uses **exactly the same actions as players**: they create a hero, recruit a balanced party, auto-spend skill points, equip upgrades, farm zones and move up, challenge bosses, build their town and assign workers, send expeditions, set up a loot filter, cut and socket gems, run rifts, claim quests, sell spare gear and materials on the Auction House and buy upgrades. They also form co-op groups, accept your invites and chat a little. They log in and out on their own schedule, so they get offline progress too. **Personalities:** casual, grinder, trader, crafter, social, tryhard. Each one has its own skill (decision quality), activity (time online) and preferences, so bots progress at different speeds. **Control:** Admin → 🤖 Bots (add, remove, pause), or the console: `bots`, `bots add 5 [type]`, `bots remove <name|all>`, `bots on|off`. Bots get a 🤖 next to their name; you can turn that off in the server settings. Nobody can log in to a bot account. `node tools/bot-test.js 4` fast-forwards 4 hours of bot play and prints how far they got. |
| **Installable app** | The game can be installed like an app (PWA) on Android, iPhone/iPad and PC (Chrome/Edge): it gets its own icon and window, with no browser bars. It always loads the newest version because files come from the network first, with a cached copy only when offline. An 📲 button appears in the top bar when the browser offers installation; there are also instructions under Progression → Settings (iPhone: Safari → Share → Add to Home Screen). **Requires HTTPS** (see "Own subdomain + HTTPS" — built into the egg). To use your own icon, add `public/assets/ui/app-icon-192.png` and `app-icon-512.png`. |
| **Daily & weekly quests** | 3 daily quests and 2 weekly quests per player, drawn from things you can currently do: slay enemy types, defeat bosses, earn gold, complete rifts or expeditions, salvage, craft, trade. Progress counts automatically, including offline fights. Rewards are gold, XP, materials and **Ashen Crystals 💠** (2 per daily, a 5 💠 chest for finishing all dailies, 12 per weekly plus an epic item). One free daily-quest swap per day, then 2 💠 per swap. Reset: 03:00 UTC daily, Mondays for weeklies. Templates and rewards are in `content/quests.json`. |
| **Ascension (subclasses)** | Optional prestige for your hero. At the level cap the Character page offers **🌟 Ascend**: pick one of 2–3 subclasses of your class (e.g. Warrior → Juggernaut, Berserker or Warlord; Summoner → Lich, Demonologist or Spiritcaller — 18 in total). The hero starts again at level 1 as that subclass and keeps every class ability and the whole class skill tree; the tree gains a new **subclass branch** with 2 new abilities, 2 notables, a permanent passive bonus and 3 **ability mutators** (✦) that change how base-class abilities work — e.g. Berserker's Cleave makes enemies bleed, the Pyromancer's Meteor falls far more often, the Trickster's Shadow Flurry strikes 3 more times, the Juggernaut's Shield Wall also taunts — plus 10 extra skill points. The hero keeps its equipped gear — rarity, affixes, unique effects, set bonuses, enchantments and gems stay — but it is scaled down to item level 1; reforge it back up in town as you level (exact: the item remembers its original stats); gold, items, recruits and town stay. At the cap again you may switch to another subclass (from level 1 again). The subclass name and a 🌟 show in the top bar, in fights and in rankings (ascended heroes rank above non-ascended ones on the level board). While re-levelling, **level sync** applies: everyone in the hero's party fights at the hero's level + 3 — higher recruits use that level's stats, only the skill-tree points they'd have at that level (their earliest nodes) and gear scaled down to it (a synced level-60 recruit is about as strong as a fresh one of that level), shown as ⇩60 in fights. The party starts again in the first zone. Kill XP also counts enemies as at most 5 levels above the hero. Settings: `config.json` → `ascension` (`levelSync`: `enabled`, `levelGap`, `gearCurve`); subclasses are content (`content/subclasses/`, editable in Admin → 📦 Content). |
| **Rifts** | Timed, endless dungeons from hero level 15. Enemies don't scale with you: tier 1 has level-5 enemies, every tier adds a level plus a little extra health and damage, and past the level cap they simply keep growing — there is no top tier (about tier 50 for a level-60 party in rare gear; better gear goes further). A rift is themed after one of your unlocked zones: 3 waves, then a Rift Guardian (that zone's boss), with a 3:30 clock. Each tier adds enemy health and damage. Finish in time to unlock the next tier and earn a loot chest (rare+ from tier 5, epic+ from 12, legendary from 25), plus crystals for each new best tier. **Weekly affixes** (Fortified/Tyrannical, Bolstering, Sanguine, Raging, Volcanic, Necrotic, Arcane Ward, Ironhide, Quaking) switch on at tiers 2, 5 and 10. They're the same for everyone, so the **Highest rift** leaderboard is fair. "After a run" can repeat a tier or push higher automatically. Tune in `content/rifts.json` (affixes are data too); check the balance with `node tools/rift-sim.js <level> <zone>`. **XP and gold are paid once per tier**, the first time you clear it (in full, even over time); repeating a tier only gives loot and chests, so easy tiers can't be farmed for levels (`rewards.repeatXpGold` in `content/rifts/_settings.json` sets a share for repeats if you want one). |
| **Bestiary** | Every enemy with its stats at any level and every ability in plain words, with estimated damage, target, cooldown and when it's used. Bosses also list their phases and enrage timer, plus where the enemy appears and auto-generated "How to prepare" tips. Click any enemy in combat to look it up. **Mastery:** 25/150/500 kills (bosses 3/15/40) give ★/★★/★★★, which means +2/4/6% damage against that enemy. |
| **Tutorial** | New players get a short guided tutorial: welcome → win the first fights → recruit a companion → spend a skill point → upgrade the Town Hall → send an expedition → bring it back instantly with Ashen Crystals → claim it → put the companion back into the party. A guide card shows each step with progress, a "Go to …" button and glowing highlights on what to click; the game counts progress on the server and gives small rewards (including exactly the gold and materials needed for the Town Hall, and the crystals for the speed-up). Menu pages appear one by one as the tutorial introduces them (marked NEW), everything unlocks at the end. Players can minimize the card or skip the tutorial; existing players and bots never see it. Steps, texts, rewards and highlights are data in `content/tutorial.json` (also editable in Admin → 📦 Content → Settings & tables → Tutorial). |
| **Admin page** | Only visible to admins.<br>• **Dashboard:** players online, accounts, uptime, memory, auctions, and an announcement box.<br>• **Announcements:** pop up for everyone online and are kept on the server, so players who were offline see them as soon as they log in (shown for 1/3/7/30 days or until deleted). Players can re-read them via the 📢 button in the top bar; admins can delete them from the dashboard.<br>• **Live settings:** XP, gold and loot rates; offline cap; auction fee and tax; registrations on/off; message of the day.<br>• **Player management:** search, details, kick, timed or permanent bans, gifts of gold, Ashen Crystals, materials or items (including specific uniques and set pieces) by mail, **experience** (add XP, add levels or set an exact level — also lower — for the hero, the active party, all characters or one character; applied immediately, logged in the audit log), password reset, account deletion.<br>• **⚖ Live balance:** statistics from every real fight on the server (farming, bosses, rifts, co-op, offline progress), kept in hourly steps for 90 days, real players and bots separately. Shows each class's damage/healing per second, win rate, deaths and damage taken per level range — colored against the other classes of the same role — plus the real time heroes need per level, win rates and fight lengths per zone, boss and co-op encounter, rift clear rates per tier range, XP and gold per hour, and how often every ability is cast (never-used abilities stand out). Filter by 24 hours … 90 days and by activity.<br>• **📦 Content editor:** edit, create and remove any game content (classes, abilities, items, enemies, zones, rifts, town, quests, settings …) in a form or as JSON. Changes are checked before saving and go live immediately for everyone, without a restart; they're stored as overrides in `data/content/`, so updates never overwrite them (details in [CONTENT.md](CONTENT.md#editing-in-the-admin-panel--content)).<br>• **📈 XP curve:** shape how much XP each level needs by dragging points on a chart (smooth curve through them, log or linear view), start from presets (linear, gentle, steep, exponential …), scale everything, see totals per milestone, the change against the current curve and roughly how many kills each level takes. Saving is live, like the content editor. **⏱ Test with bots** plays one bot per play style (Casual → Tryhard) on a fast-forwarded clock with the curve — before or after saving — and charts how much play time each needed per level (3 hours to 1 week of play; about 5 s of real time per simulated hour, in a separate low-priority process on a throw-away copy, so real players and the running game aren't affected). Earlier runs stay as dashed lines for comparison.<br>• **Audit log** of every admin action. |
| **Rankings & inspect** | Leaderboards for hero level, party power, hero power, kills, bosses, co-op wins, achievements and world progress. You can filter by class and search. Inspect any player to see their current activity, group, stats and progress, plus the full hero build: attributes, gear, a skill tree preview, notables, and the loadout with behaviour rules. You can also see their party and invite them from there. Gold and inventory are never shown, and players can make their build private in Settings. |
| **Progression** | XP and levels up to 60, skill tree points, ability ranks, class titles, 16 achievements and statistics. |

---

## Project structure

```
content/           ← ALL game content as JSON — one file per ability, item, enemy, zone, unique, set, building,
                     quest, rift affix, … plus _settings.json per system (see CONTENT.md and CONTENT_REFERENCE.md)
shared/            Game engine, used by both the server and the browser
  content.js       loads the content (server: content/ + data/content overrides; browser: /api/content)
  data/            thin modules exposing the content (+ derived values) to the rest of the code
  skilltree.js     passive tree rules (allocation, refunds, paths, auto-allocate)
  rules.js         behaviour rule engine (conditions, target selectors, validation)
  combat.js        deterministic combat simulation (no DOM, seeded RNG)
  stats.js         stat calculation (single source of truth)
  character.js     levels, XP, abilities, auto-development
  party.js         party synergy
  encounters.js    encounter generation & rewards
  quests.js, rifts.js, bestiary.js, gems.js, lootfilter.js   engines for those systems
server/            Node.js server: HTTP, WebSocket, auth, persistence, battle loop, groups, bots
  content-check.js validates the content on every start
public/            Browser client (vanilla JS modules + CSS)
  assets/          ← put your images here
tools/             simulator, tests, content check/reference, asset checklist
pterodactyl/       Pterodactyl egg
```

### Adding and changing content

The game is **data-driven**: items, classes, abilities, enemies, zones, uniques, sets, skill trees, town, expeditions, quests, rifts and their affixes, gems, achievements, bestiary tips, loot filter presets, bots and all balance numbers are JSON in `content/`, **one file per entry** (e.g. `content/abilities/mage/fireball.json`, `content/items/weapon/sword.json`, `content/enemies/wolf.json`). **[CONTENT.md](CONTENT.md)** explains every file, with step-by-step examples (new item, ability, enemy, zone, unique, class, rift affix). **[CONTENT_REFERENCE.md](CONTENT_REFERENCE.md)** lists every id you can use.

- **Check your changes:** `npm run content:check`, or type `content` in the server console. The server validates the content on every start and refuses to start with clear error messages (e.g. `zones.whispering_woods.enemies: unknown enemy "wolff"`) instead of breaking at runtime.
- **New entry:** `npm run content:new -- <type> <newId> <copyFromId>`, e.g. `npm run content:new -- item war_scythe axe`.
- **Server owners:** the easiest way is **Admin → 📦 Content** in the game: changes are validated and applied live. Or put your changes in **`data/content/`** by hand, using the same layout. A file with an existing id only needs the fields you change (e.g. `data/content/abilities/fireball.json`); a new id adds an entry; a file containing `null` removes one; `data/content/config.json` tweaks balance numbers. Everything there survives `update`.
- **Apply:** changes made in the admin editor are live at once. For files edited by hand, type `content reload` in the console (or restart the server). Open game pages pick up the new content automatically.
- **Code is only needed for new kinds of behaviour:** a new effect kind, behaviour condition or target selector (`shared/rules.js`), quest type, rift mechanic or bestiary tip condition. The validator names anything unknown.
- **Balance:** check the result with `npm run simulate` and `node tools/rift-sim.js <level> <zone>`.

---

## Hosting on Pterodactyl

1. In the panel go to **Admin → Nests**, create a nest (e.g. "Games") or use an existing one, then **Import Egg** and upload `pterodactyl/egg-ashenvale-idle.json`.
2. **Create a server** with the *Ashenvale Idle* egg:
   - Docker image: *Node.js 22*
   - Memory: 512 MB is plenty for a small community; 1 GB for many players
   - Allocate one port. That's the game's web port.
   - **Git Repository** defaults to `https://github.com/IhleMa/ashenvale-idle`. If the repository is **private**, also fill in **Git Username** and **Git Access Token**. The token needs read access to the repository; for a fine-grained token, that's "Contents: Read-only".
3. Start the server. Once the console shows `listening on`, players can open **`http://<your-server-ip>:<port>`** in a browser. For **HTTPS** with your own domain, see [Own subdomain + HTTPS](#own-subdomain--https) — it's a few server variables.
4. **Updates without kicking players.** Type `update` in the server **console**. It pulls the newest version from GitHub and tells you what to do:
   - *"Client-only update applied live"*: only browser files changed (the UI in `public/`). Nothing restarts. Every open game page refreshes itself within a second or two and players keep fighting.
   - *"A RESTART is required"*: server or game-rule files changed (`server/`, `shared/`). Press **Restart** in the panel when it suits you. Players see a short "server is updating" banner, reconnect automatically when it's back (usually 5–15 s), and the page reloads to the new version. They don't need to log in again, their groups are kept, and no progress is lost.
   - New **images** never need either: just upload them and players see them after a refresh.

   With *Auto Update = 1*, every restart also runs `git pull`. Player data in `data/` is never touched.

   If `update` ever says *"Your local changes … would be overwritten"*, a file from the repository was edited on the server. Use **Settings → Reinstall Server** in the panel: it resets the game files to the newest version and keeps `data/` (saves, content overrides, certificates) and uploaded images. (`package-lock.json`, which `npm install` used to rewrite, is now handled automatically.)

   Other console commands: `players` (who is online), `say <message>` (announcement from "Server", e.g. `say Restarting in 2 minutes!`; players who are offline still see it on their next login within 24 h), `reload-clients` (refresh every open page), `content [reload]` (check the content files / apply them live), `tls [renew]` (HTTPS status / new certificate now), `admin add|remove|list <username>`, `bots [add <n> [type] | remove <name|all> | on | off]`, `backup` (database snapshot now), `db` (database size and counts), `help`.
7. **Admins:** set the server variable **Admin Users** (e.g. `alice,bob`) or type `admin add alice` in the console. Admins get an extra **🛡 Admin** page in the sidebar after refreshing.
5. **Images on the server:** commit them to `public/assets/` in the repo (recommended, so they arrive with updates), or upload them with the panel's File Manager into `public/assets/<folder>/`. Uploaded files sit outside git and survive updates. Don't upload a file with the same name as one that's also committed to the repo, or `git pull` will refuse to update.
6. **Saves & backups:** everything is stored in one SQLite database, `data/ashenvale.db`. The server keeps the game in memory and writes all changes every 5 seconds in a single transaction. Trades, mail, crystal speed-ups and admin actions are written immediately, so an item or gold can never be duplicated or lost half-way through a trade, even on a crash.
   - The server makes a consistent backup every 24 h into `data/backups/` (the newest 7 are kept); type `backup` in the console for one right now. The panel's Backups feature also works. Prefer the files in `data/backups/` if you restore by hand, because they are safe to copy while the server runs.
   - **Restore:** stop the server, replace `data/ashenvale.db` with a backup file (and delete `ashenvale.db-wal` / `ashenvale.db-shm` if present), start again.
   - **Upgrading from the old JSON saves:** nothing to do. On the first start the server imports `accounts.json`, `players/` and the other JSON files and moves them into `data/json-backup-<date>/`.
   - To look inside the database, download it and open it with [DB Browser for SQLite](https://sqlitebrowser.org/) (players are stored as JSON in the `players` table). Only edit a copy while the server is stopped.

### Own subdomain + HTTPS

There are two ways. **A** is built into the game server and egg (nothing to install on the machine); **B** puts a reverse proxy in front.

#### A) HTTPS built into the egg (recommended)

The game server gets a free **Let's Encrypt** certificate by itself, renews it automatically and switches to the new one without a restart. Players open **`https://play.example.com:<port>`**; `http://` on the same port redirects to `https://` automatically, and WebSockets use `wss://`. This also makes the installable app work.

1. **DNS (Cloudflare):** add an **A record**, e.g. name `play`, value = the public IP of the Wings machine, **Proxy status: DNS only** (grey cloud). *(No port in the address: set the record to **Proxied** (orange cloud) and add a Cloudflare **Origin Rule** — *Hostname equals play.example.com → Destination Port: rewrite to <your game port>* (free plan). Set SSL/TLS to **Full (strict)**, turn on **Always Use HTTPS** (SSL/TLS → Edge Certificates) and set the server variable **Trust Proxy** = `true`. Players then open `https://play.example.com`; this also works when another website already uses ports 80/443 on the same IP.)*
2. **API token:** Cloudflare → *My Profile → API Tokens → Create Token* → template **"Edit zone DNS"** → *Zone Resources: Include → Specific zone → example.com* → create, copy the token. It only allows editing DNS records of that one domain; the server uses it to add a temporary `_acme-challenge` TXT record that proves to Let's Encrypt that the domain is yours (so it works on any port — no port 80 needed).
3. **Server variables** (panel → *Startup*):
   - **HTTPS Mode** = `auto`
   - **Domain** = `play.example.com`
   - **Cloudflare API Token** = the token
   - **Let's Encrypt E-Mail** = your e-mail (optional)
   - Tip: set **Let's Encrypt Staging** = `1` for the very first try. That uses untrusted test certificates without Let's Encrypt's rate limits; once the console shows `got a certificate`, set it back to `0` and restart to get the real one.
4. **Restart.** The console shows `TLS: requesting a certificate…`, `got a certificate for play.example.com, valid until …` and `listening on https://play.example.com:<port>`. Certificates are kept in `data/tls/` (reused after restarts) and renewed 30 days before they expire.

If something is wrong (typo in the token, DNS not set up …) the console says what, the game still starts on plain HTTP, and it retries automatically — once a certificate arrives, the port switches to HTTPS and open pages reload. The console command **`tls`** shows the status (domain, expiry, last problem); **`tls renew`** gets a new certificate now. The Admin dashboard shows it too.

Other options:
- **Your own certificate** (e.g. a Cloudflare Origin Certificate): HTTPS Mode = `files`, upload the files into `data/tls/` as `fullchain.pem` and `privkey.pem` (or set **TLS Certificate** / **TLS Key**). Replaced files are picked up within 12 hours, or restart.
- **Without Cloudflare:** Certificate Check = `http` plus a second allocation that is reachable from the internet as **port 80**, set as **HTTP Redirect Port**. That port then also redirects `http://` to `https://`. Usually port 80 on a Wings machine is taken, so the Cloudflare check is the easier way.

#### B) Reverse proxy (nginx / Caddy)

Ready-made configs are in `deploy/` (`nginx-ashenvale.conf` and `Caddyfile`). Leave HTTPS Mode `off` for this.

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
