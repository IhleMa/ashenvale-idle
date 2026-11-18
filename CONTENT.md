# Game content (data-driven)

Everything that makes up the game world is **data** in `content/`. **Every ability, item, enemy, zone, unique, set, building, quest type, rift affix … is its own JSON file**, named after its id. The code is only the *engine* that interprets this data. The server and the browser both use the same assembled content; the browser loads it from `/api/content`.

- **Every id you can use** (abilities, statuses, stats, materials, enemies, conditions, target selectors, …) is listed in [CONTENT_REFERENCE.md](CONTENT_REFERENCE.md). Regenerate it with `npm run content:docs`.
- **New entry from a copy:** `npm run content:new -- <type> <newId> <copyFromId>`, e.g. `npm run content:new -- ability shadow_strike backstab`.
- **Check your changes:** `npm run content:check`, or type `content` in the server console. The server also checks everything on every start and **refuses to start** if something is wrong. The message names the file and the field, e.g. `content/zones/whispering_woods.json → enemies: unknown enemy "wolff"`.
- **Apply changes:** restart the server. Players reconnect automatically and their pages reload with the new content.

## Folder layout

```
content/
  config.json                         balance numbers (levels, XP, combat, rarities, …)
  bestiary.json                       mastery, targeting wording, "How to prepare" tip rules
  classes/warrior.json …              one file per class
  traits/brute.json …                 recruit traits
  abilities/<class>/<id>.json         abilities, sorted into a folder per class ("enemy" = enemy abilities, "minion" = minion abilities)
  minions/<id>.json                   minions that players summon (Summoner)
  statuses/burn.json …                buffs and debuffs
  items/_settings.json                slots, affix stats, naming, sell value, socket rules
  items/<slot>/<id>.json              item bases, sorted into a folder per slot
  enemies/_settings.json              enemy tuning and defaults
  enemies/<id>.json                   enemies and bosses
  zones/_settings.json + zones/<id>.json
  coop/<id>.json                      co-op encounters
  legendaries/_settings.json          drop chances
  legendaries/uniques/<id>.json       unique items
  legendaries/sets/<id>.json          item sets
  skilltree/_settings.json            tree generator settings and labels
  skilltree/<class>.json              one skill tree per class
  town/_settings.json                 tables per building level, formulas, enchanting, salvage
  town/materials|professions|buildings|qualities|elixirs/<id>.json
  expeditions/_settings.json + expeditions/<id>.json
  achievements/<id>.json
  quests/_settings.json + quests/<type>.json
  rifts/_settings.json + rifts/affixes/<id>.json
  gems/_settings.json + gems/<stat>.json
  lootfilter/_settings.json + lootfilter/<preset>.json
  bots/_settings.json + bots/<archetype>.json
```

Rules:
- **File name = id.** Use lowercase letters, digits and `_`. The id is what other files refer to, e.g. `"abilities": ["e_bite"]`.
- **Subfolders are only for tidiness.** You can move `abilities/mage/fireball.json` to any folder below `abilities/` and nothing changes. Ids must be unique within a type.
- **`_settings.json`** (files starting with `_`) hold the non-entry data of a system; they start with an `"_about"` text explaining them.
- **`"order"`** (optional) sets the position in lists and menus; lower comes first. Entries without it come last, sorted by id. Zones also use `order` for their progression order.

## Where to edit: `content/` vs. overrides

| | `content/` (in the repository) | `data/content/` (overrides) |
| --- | --- | --- |
| What | The complete base content | Only what you want to change |
| Survives `update` (git pull) | Only if you commit your changes, otherwise the pull conflicts | **Yes**: the folder is outside the repository |
| Best for | Developing the game, bigger additions | Server owners tweaking or adding content on Pterodactyl |

The easiest way to make overrides is the **in-game editor: Admin → 📦 Content** (see below). It writes exactly these files for you. You can also write them by hand: `data/content/` uses **the same layout**. On Pterodactyl it's `data/content/` in the File Manager; create the folders you need.

- **Change an entry:** create a file with the same id that contains only what changes. It's merged into the original: objects key by key, while lists and values replace. The subfolder doesn't matter.
- **Add an entry:** create a new file with a new id, written in full.
- **Remove an entry:** create a file with the same id that contains just `null`.
- **Settings:** `data/content/config.json`, `data/content/items/_settings.json`, … are merged the same way. A whole-system file like `data/content/items.json` (`{ "bases": { … }, "naming": { … } }`) works too.
- **Setting a value to `null`:** since `null` means "remove this key", an object containing `"$replace": true` replaces the original object instead of being merged into it, e.g. `{ "$replace": true, "name": "Ring", "slot": "ring", "classes": null, … }`. The editor uses this automatically when needed.

```jsonc
// data/content/config.json — level 70 cap and a bigger inventory
{ "levelCap": 70, "inventory": { "limit": 160 } }

// data/content/abilities/fireball.json — Fireball hits harder, everything else stays
{ "effects": [{ "kind": "damage", "stat": "magPower", "power": 2.2, "school": "magical" }] }

// data/content/items/dagger.json — remove the dagger (the validator reports anything that still uses it)
null
```

## Editing in the admin panel (📦 Content)

Admins find a content editor under **Admin → 📦 Content**:

- **Left:** every kind of content (classes, abilities, items, uniques, sets, gems, enemies, zones, rift affixes, town, quests, achievements, bots …) plus **Settings & tables** (the `_settings.json` of each system and `config.json`). A yellow number shows how many entries are changed on this server.
- **Middle:** the entries, grouped by subfolder, with search and an "only changed" filter. Badges: **Modified** (changed on this server), **New** (added on this server), **Removed** (hidden on this server). No badge means unchanged.
- **Right:** the entry as a **form**: text, numbers, yes/no switches, lists (add, remove, reorder, duplicate), nested groups (collapse, add/remove fields) and suggestions for ids (statuses, enemies, item bases, abilities, zones, stats, rarities, …) and for values used elsewhere (`kind`, `target`, `school` …). **{ } JSON** edits the raw data. **Δ Changes** shows the unsaved changes, what differs from the original, and the override file that is stored.
- **💾 Save** (Ctrl+S) checks the whole content first. If the change would break something, nothing is saved and you see the problems (e.g. `zones/frostpeak.json → boss: unknown enemy "frost_queen"`). Otherwise it is **live right away**: the server switches to the new content and every open game page loads it without reloading.
- **+ New / ⧉ Duplicate** create an entry as a copy of another (or empty). Copying a **class** also copies its abilities (as `<newclass>_<ability>`) and its skill tree, so the class is playable at once.
- **🗑 Remove** hides an original entry (you can **↺ Restore** it) or deletes one you created. Removing a class also removes its abilities and skill tree. If player saves mention the id (items, characters, progress), you're warned first, because removing things players own can break their saves.
- **↺ Reset to original** throws away all changes to an entry.

Everything is stored as minimal override files in `data/content/` (an edited entry only stores the fields that differ), so `update` never touches your changes and the files stay readable if you want to copy them into `content/` later. Every change is in the admin audit log.

The console command `content` checks the files on disk; `content reload` also applies them to the running server (useful after editing override files by hand). A few low-level numbers that are read once at start (for example `combat.tickMs`) still need a restart.

## What's in each part

| Part | What's inside |
| --- | --- |
| `config.json` | Level cap, XP curve, party size, combat timing, armor formula, offline progress, recruitment, co-op scaling, **rarities** (weights, multipliers, affix counts), premium currency name |
| `classes/`, `traits/` | Classes (role, resource, attributes, growth, how attributes become combat stats, basic attack, tiers) and recruit traits |
| `abilities/` | All player and enemy abilities: cost, cooldown, target, `effects`, default behaviour rule, loadout priority |
| `statuses/` | Buffs and debuffs: stat modifiers (`mods`), damage or heal per second (`tick`), stacking |
| `items/` | Slots, item bases (`stats: [base, perLevel]`, `classes`, `material`), affixes, naming (level prefixes, suffixes), sell value, socket chances |
| `enemies/` | Enemies and bosses: level-1 stats, growth, tags, abilities, boss `phases`, `enrageAfter` |
| `zones/`, `coop/` | Zones (level range, enemies, boss, which zone unlocks it) and co-op encounters (waves) |
| `legendaries/` | Unique items (fixed stats + procs/passives), item sets (piece names, bonuses at 2/4 pieces), drop chances |
| `skilltree/` | Passive tree generator settings and one tree per class (4 branches: attributes, ability nodes, notables) |
| `subclasses/` | Ascension subclasses (2–3 per class): extra skill-tree branch(es) with subclass abilities and notables, a permanent passive `bonus`, glyph/color/title |
| `town/` | Materials, professions, buildings (costs, effects text), crafting qualities, enchanting, elixirs, salvage yields |
| `expeditions/` | Destinations (yields per hour, rare finds, profession bonus), durations, camp limits |
| `achievements/` | Goals on player counters (`kills`, `bossKills`, `heroLevel`, …) with gold rewards |
| `quests/` | Daily/weekly quest settings, title templates, targets, weights and rewards |
| `rifts/` | Rift scaling, time limit, wave composition, rewards, weekly rotation and **affixes** |
| `gems/` | Gem names/colours per stat, tiers with cut/fuse costs, shard yield, socket drilling and removal costs |
| `bestiary.json` | Mastery tiers, wording for enemy targeting and the rules for "How to prepare" tips |
| `lootfilter/` | Rule limit and the presets in the loot filter menu |
| `bots/` | Bot name pool, chat lines and personality archetypes |

Numbers like `{ "base": 120, "perLevel": 45 }` scale with the hero level. `{ "base": 5, "perLevels": 3 }` means +1 every 3 levels.

## How to …

### Add an item base
`content/items/weapon/war_scythe.json` (or `npm run content:new -- item war_scythe axe`):
```json
{ "name": "War Scythe", "slot": "weapon", "material": "metal", "classes": ["warrior", "rogue"],
  "stats": { "physPower": [4, 1.3], "critDamage": [0.05, 0.002] } }
```
It starts dropping right away at every rarity. For a picture, add `public/assets/items/war_scythe.png`.

### Add an ability to a class
1. `content/abilities/<class>/<id>.json`: give it `classId`, `unlockLevel`, `cost`, `cooldown`, `target` (`enemy`/`ally`/`self`), `effects` and a `defaultRule`. Copy a similar ability as a starting point.
2. `content/skilltree/<class>.json → branches[n].abilities`: put it on a ring, e.g. `"5": "war_cry"`, so players can learn it.

### Add an enemy and a zone
1. `content/enemies/<id>.json`: stats, `tags` (e.g. `["beast"]`), `abilities` (enemy abilities in `content/abilities/enemy/` with `"classId": "enemy"`). Bosses get `"boss": true`, plus `phases` and `enrageAfter` if you like.
2. `content/zones/<id>.json`: `levelRange`, `enemies`, `boss`, `order`, and `"unlock": "<previous zone>"`.

The bestiary picks the new enemy up automatically, including its tips.

### Add a unique item
`content/legendaries/uniques/<id>.json`: `baseId`, `minLevel`, `stats` (`[base, perLevel]`), a `description`, and `procs` or `passive`.
```json
{ "name": "Stormcaller", "baseId": "wand", "minLevel": 20, "description": "Crits call lightning.",
  "stats": { "int": [4, 0.8] },
  "procs": [{ "name": "Stormcaller", "trigger": "crit", "chance": 0.25, "target": "target",
              "effect": { "kind": "damage", "stat": "magPower", "power": 1.5, "school": "magical" } }] }
```

### Add a class
1. `npm run content:new -- class paladin warrior`, then edit `content/classes/paladin.json`. `role` must be one of the roles in `config.json`.
2. Abilities with `"classId": "<new class>"`.
3. A skill tree `content/skilltree/<class>.json` with exactly 4 branches (`npm run content:new -- skilltree paladin warrior`). The `start` ability is learned at level 1.

The validator tells you if a piece is missing.

### Add or change a subclass (ascension)
At the level cap a hero can **ascend** into a subclass of its class (optional): back to level 1, the old gear goes to the mailbox, and the skill tree gets the subclass branch on top of the 4 class branches. Later, at the cap again, the hero may switch to another subclass of the same class (again from level 1). Only the hero ascends, not recruits.

`content/subclasses/<id>.json`:

| field | meaning |
| --- | --- |
| `classId` | the class it belongs to |
| `name`, `glyph`, `color`, `description`, `title`, `order` | how it's shown (the name replaces the class name in the top bar, combat and rankings; `title` is the hero title at the cap) |
| `bonus` | permanent passive with skill-tree stat keys, e.g. `{ "hpPct": 0.08, "defensePct": 0.1 }` |
| `branches` | 1–2 extra branches: `{ "name", "attrs": [a, b], "abilities": { "2": id, "5": id }, "notables": { "4": { "name", "stats" }, "8": { … } } }` — keys are ring numbers, like the class trees |
| `branches[].mutators` | **Ability mutators** (✦ nodes) that change a *base* class ability while allocated: `{ "3": { "name", "ability", "description", "changes": { … } } }` (key = ring) |

Mutator `changes` (any combination): `power` (+0.3 = every damage/heal/shield/over-time effect of the ability 30 % stronger), `cost` and `cooldown` (added, e.g. `-5`), `hits` (extra hits on damage), `duration` (seconds added to its statuses, shields and taunts), `bonusCrit`, `executeBelow` (sets the execute threshold, e.g. `0.45`), and `effects` — extra effects in the normal ability-effect format. In extra effects, `"self": true` puts a status/heal/shield/resource on the caster and `"once": true` applies it only once even if the ability hits several targets. Example:

```json
"mutators": {
  "3": { "name": "Bloody Cleave", "ability": "cleave", "description": "Cleave makes every enemy it hits bleed.",
         "changes": { "effects": [{ "kind": "status", "status": "bleed", "duration": 6, "stat": "physPower", "power": 0.15 }] } }
}
```

Subclass abilities live in `content/abilities/<class>/` with `"classId": "<class>"` **and** `"subclass": "<id>"`; only heroes of that subclass see them. Settings in `config.json` → `ascension`: `enabled`, `bonusSkillPoints` (extra points for ascended heroes, default 10) `xpLevelGap` (while re-levelling, kill XP counts enemies as at most this many levels above the hero) and `levelSync` — while the ascended hero is below the cap, every character in its party fights at hero level + `levelGap` (default 3): stats of that level, only the skill points of that level (the earliest allocated nodes are kept) and gear scaled by `(gearCurve + level) / (gearCurve + item level)` (default `gearCurve` 4 ≈ how item stats grow). Set `enabled: false` to turn it off.

### Add or change a minion (Summoner)
`content/minions/<id>.json` — minions are temporary allies built from their summoner's stats:

| field | meaning |
| --- | --- |
| `hp`, `power`, `defense` | fractions of the summoner's max health, Magic Power and defense (`0.45` = 45 %) |
| `attack` | basic attack `{ "name", "power", "school" }` |
| `abilities` | extra abilities from `content/abilities/minion/` (`"classId": "minion"`), used with their `defaultRule` |
| `duration` | seconds until it fades (`0` = until the fight ends) · `threat` — how strongly enemies go for it at first · `role` — `tank` minions stand in front |
| `glyph`, `color`, `description` | how it looks; an image `public/assets/minions/<id>.png` replaces the glyph |

Ability effects for summoners: `{ "kind": "summon", "minion": "skeleton", "count": 1, "max": 3 }` (at the limit the oldest one is renewed instead), `{ "kind": "sacrifice", "count": 1, "power": 1.2, "school": "magical" }` (the minion closest to fading explodes for `power` × its max health to every enemy), `{ "kind": "extend", "seconds": 10 }` (on minion targets). Targets `own_minions` / `own_minion_lowest_hp` and the condition `own_minions` (optionally of one kind) work in every rule. Skill-tree stats: `minionDamagePct`, `minionHpPct`, `minionDurationPct`, `minionMax` (+N of each kind). Minions fade when their summoner falls, and a party with only minions left loses.

### Add a rift affix
`content/rifts/affixes/<id>.json` with `name`, `icon`, `description` and a list of `mechanics`:

| mechanic | fields | effect |
| --- | --- | --- |
| `enemyStats` | `who` (all/boss/nonBoss), `hpPct`, `damagePct` | stronger enemies when they spawn |
| `enemyDamageTaken` | `school` (physical/magical/any), `mult` | enemies take less (or more) damage |
| `onEnemyDeath` | `action: "bolster"` + `status`, `maxHpPct`, `message` · `action: "healAllies"` + `pctMaxHp` | when an enemy dies |
| `enemyLowHealth` | `who`, `below` (0–1), `status`, `message` (`{name}` = enemy) | once per enemy |
| `onEnemyHit` | `status`, `duration`, `basicAttacksOnly` | enemy hits apply a status |
| `periodic` | `every` (s), `target` (randomHero/allHeroes), `status`+`duration`+`pctMaxHp` and/or `damagePctMaxHp`+`school`, `message` | timed effects |

### Change the XP needed per level

Easiest: **Admin → 📈 XP curve** (drag the points, save — live). In the file it is `content/config.json → xp`: without `curve`, a level needs `base × level^exponent` XP. With `"curve": [[1, 80], [10, 5600], [30, 37000], [59, 151000]]` (pairs of level and XP needed for the next level) the game draws a smooth, rising curve through those points (straight lines in a log-log sense, so two points already give a classic power curve). Changing it never changes anyone's level, only how much the following levels need.

### Change the tutorial

`content/tutorial.json` lists the steps in order. Each step has a `title`, a `text` (`**bold**` works, `{count}` is the goal count), the page it happens on (`view`), the pages it makes visible (`unlocks`; `"*"` = everything — used by the last step), what to click, in order (`highlight`: CSS selectors, or `{ "el": selector, "done": selector }` to move on to the next entry once `done` matches — only the first unfinished one glows and gets a "Click here" arrow), a `goal` and an optional `reward`.

- Goals: `{ "type": "ack" }` shows a button (`"button"` sets its label). `{ "metric": "kills", "count": 5 }` counts from the start of the step; add `"absolute": true` to count the total instead. `{ "any": [ … ] }` completes when one of several goals is met. Metrics: `kills`, `fights`, `recruited`, `heroLevel`, `heroNodes`, `buildingUpgrades`, `expeditionsSent`, `expeditionSpeedups`, `expeditionsReady`, `expeditionsClaimed`, `partySize`.
- Rewards: `gold`, `premium`, `xp` (hero), `materials` `{ "ore": 5 }`, and `coverUpgrade: "<building>"`, which gives exactly what is still missing to upgrade that building. `rewardText` overrides how the reward is described.
- `"enabled": false` turns the tutorial off for new players; `alwaysVisible` lists pages that are never hidden.

### Change building texts
`content/town/buildings/<id>.json → effects` is a list of templates such as `"Roster: {innRoster} companions"` or `{ "minLevel": 3, "text": "…" }`. The available values are listed in CONTENT_REFERENCE.md.

## What stays in code
- How things *work*: the combat engine, rule conditions and target selectors, formulas that combine the numbers, and saving.
- The **quest types** (what the game tracks for "kill N", "salvage N", …).
- The **rift mechanics** vocabulary and the **bestiary tip conditions**.

The data chooses and combines these freely, but brand-new kinds of behaviour need a small code addition. The validator reports any unknown kind instead of failing silently.
