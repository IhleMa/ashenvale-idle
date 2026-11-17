# Game content (data-driven)

Everything that makes up the game world is **data** in `content/*.json`. That covers classes, abilities, items, enemies, zones, uniques and sets, skill trees, the town, expeditions, quests, rifts, gems, the bestiary, loot filter presets, bots and the balance numbers. The code is only the *engine* that interprets this data. Both the server and the browser read the same files: the browser loads them from `/api/content`.

- **Every id you can use** (abilities, statuses, stats, materials, enemies, conditions, target selectors, …) is listed in [CONTENT_REFERENCE.md](CONTENT_REFERENCE.md). Regenerate it with `npm run content:docs`.
- **Check your changes:** `npm run content:check`, or type `content` in the server console. The server also checks the content on every start and **refuses to start** if something is wrong. It prints exactly what and where, e.g. `zones.whispering_woods.enemies: unknown enemy "wolff"`.
- **Apply changes:** restart the server. Players reconnect automatically and their pages reload with the new content.

## Where to edit: `content/` vs. overrides

| | `content/*.json` (in the repository) | `data/content/*.json` (overrides) |
| --- | --- | --- |
| What | The complete base content | Only the parts you want to change |
| Survives `update` (git pull) | Only if you commit your changes, otherwise the pull conflicts | **Yes**: the folder is outside the repository |
| Best for | Developing the game, bigger additions | Server owners tweaking balance on Pterodactyl |

Overrides use the same file names and structure, and are **merged** on top of the base content:

- objects are merged key by key, so you only write what changes;
- lists and single values replace the original;
- `null` removes something.

On Pterodactyl, the folder is `data/content/` in the File Manager. Create it if it doesn't exist.

```jsonc
// data/content/config.json — double the inventory and make level 70 the cap
{ "levelCap": 70, "inventory": { "limit": 160 } }

// data/content/abilities.json — make Fireball hit harder, nothing else changes
{ "abilities": { "fireball": { "effects": [{ "kind": "damage", "stat": "magPower", "power": 2.2, "school": "magical" }] } } }

// data/content/items.json — remove the dagger from the loot pool
{ "items": { "bases": { "dagger": null } } }
```

Each file starts with an `"_about"` text that explains it. JSON has no comments, so `_about` is ignored by the game.

## The files

| File | What's inside |
| --- | --- |
| `config.json` | Level cap, XP curve, party size, combat timing, armor formula, offline progress, recruitment, co-op scaling, **rarities** (weights, multipliers, affix counts), premium currency name |
| `classes.json` | Classes (role, resource, attributes, growth, how attributes become combat stats, basic attack, tiers) and recruit traits |
| `abilities.json` | All player and enemy abilities: cost, cooldown, target, `effects`, default behaviour rule, loadout priority |
| `statuses.json` | Buffs and debuffs: stat modifiers (`mods`), damage or heal per second (`tick`), stacking |
| `items.json` | Slots, item bases (`stats: [base, perLevel]`, `classes`, `material`), affixes, naming (level prefixes, suffixes), sell value, socket chances |
| `enemies.json` | Enemies and bosses: level-1 stats, growth, tags, abilities, boss `phases`, `enrageAfter` |
| `zones.json` | Zones (level range, enemies, boss, which zone unlocks it) and co-op encounters (waves) |
| `legendaries.json` | Unique items (fixed stats + procs/passives), item sets (piece names, bonuses at 2/4 pieces), drop chances |
| `skilltree.json` | Passive tree generator settings and one spec per class (4 branches: attributes, ability nodes, notables) |
| `town.json` | Materials, professions, buildings (costs, effects text), crafting qualities, enchanting, elixirs, salvage yields |
| `expeditions.json` | Destinations (yields per hour, rare finds, profession bonus), durations, camp limits |
| `achievements.json` | Goals on player counters (`kills`, `bossKills`, `heroLevel`, …) with gold rewards |
| `quests.json` | Daily/weekly quest settings, title templates, targets, weights and rewards |
| `rifts.json` | Rift scaling, time limit, wave composition, rewards, weekly rotation and **affixes** |
| `gems.json` | Gem names/colours per stat, tiers with cut/fuse costs, shard yield, socket drilling and removal costs |
| `bestiary.json` | Mastery tiers, wording for enemy targeting and the rules for "How to prepare" tips |
| `lootfilter.json` | Rule limit and the presets in the loot filter menu |
| `bots.json` | Bot name pool, chat lines and personality archetypes |

Numbers like `{ "base": 120, "perLevel": 45 }` scale with the hero level. `{ "base": 5, "perLevels": 3 }` means +1 every 3 levels.

## How to …

### Add an item base
`items.json → bases`:
```json
"war_scythe": { "name": "War Scythe", "slot": "weapon", "material": "metal", "classes": ["warrior", "rogue"],
                "stats": { "physPower": [4, 1.3], "critDamage": [0.05, 0.002] } }
```
It starts dropping right away at every rarity. For a picture, add `public/assets/items/war_scythe.png`.

### Add an ability to a class
1. `abilities.json → abilities`: give it `classId`, `unlockLevel`, `cost`, `cooldown`, `target` (`enemy`/`ally`/`self`), `effects` and a `defaultRule`. Copy a similar ability as a starting point.
2. `skilltree.json → specs.<class>.branches[n].abilities`: put it on a ring, e.g. `"5": "war_cry"`, so players can learn it.

### Add an enemy and a zone
1. `enemies.json → enemies`: stats, `tags` (e.g. `["beast"]`), `abilities` (enemy abilities in `abilities.json` with `"classId": "enemy"`). Bosses get `"boss": true`, plus `phases` and `enrageAfter` if you like.
2. `zones.json → zones`: `levelRange`, `enemies`, `boss`, `order`, and `"unlock": "<previous zone>"`.

The bestiary picks the new enemy up automatically, including its tips.

### Add a unique item
`legendaries.json → uniques`: `baseId`, `minLevel`, `stats` (`[base, perLevel]`), a `description`, and `procs` or `passive`.
```json
"stormcaller": { "name": "Stormcaller", "baseId": "wand", "minLevel": 20, "description": "Crits call lightning.",
  "stats": { "int": [4, 0.8] },
  "procs": [{ "name": "Stormcaller", "trigger": "crit", "chance": 0.25, "target": "target",
              "effect": { "kind": "damage", "stat": "magPower", "power": 1.5, "school": "magical" } }] }
```

### Add a class
1. `classes.json → classes`: copy an existing class and change it. `role` must be one of the roles in `config.json`.
2. Abilities with `"classId": "<new class>"`.
3. A skill tree spec in `skilltree.json → specs` with exactly 4 branches. The `start` ability is learned at level 1.

The validator tells you if a piece is missing.

### Add a rift affix
`rifts.json → affixes`. Combine one or more mechanics:

| mechanic | fields | effect |
| --- | --- | --- |
| `enemyStats` | `who` (all/boss/nonBoss), `hpPct`, `damagePct` | stronger enemies when they spawn |
| `enemyDamageTaken` | `school` (physical/magical/any), `mult` | enemies take less (or more) damage |
| `onEnemyDeath` | `action: "bolster"` + `status`, `maxHpPct`, `message` · `action: "healAllies"` + `pctMaxHp` | when an enemy dies |
| `enemyLowHealth` | `who`, `below` (0–1), `status`, `message` (`{name}` = enemy) | once per enemy |
| `onEnemyHit` | `status`, `duration`, `basicAttacksOnly` | enemy hits apply a status |
| `periodic` | `every` (s), `target` (randomHero/allHeroes), `status`+`duration`+`pctMaxHp` and/or `damagePctMaxHp`+`school`, `message` | timed effects |

### Change building texts
`town.json → buildings.<id>.effects` is a list of templates such as `"Roster: {innRoster} companions"` or `{ "minLevel": 3, "text": "…" }`. The available values are listed in CONTENT_REFERENCE.md.

## What stays in code
- How things *work*: the combat engine, rule conditions and target selectors, formulas that combine the numbers, and saving.
- The **quest types** (what the game tracks for "kill N", "salvage N", …).
- The **rift mechanics** vocabulary and the **bestiary tip conditions**.

The data chooses and combines these freely, but brand-new kinds of behaviour need a small code addition. The validator reports any unknown kind instead of failing silently.
