// Achievements. `stat` refers to a counter in player.stats; `goal` is the target value.
// Images: assets/achievements/<id>.png
export const ACHIEVEMENTS = {
  first_blood:   { name: 'First Blood',        description: 'Defeat your first enemy.',          stat: 'kills', goal: 1,     reward: { gold: 25 } },
  hunter:        { name: 'Hunter',             description: 'Defeat 100 enemies.',               stat: 'kills', goal: 100,   reward: { gold: 200 } },
  slayer:        { name: 'Slayer',             description: 'Defeat 1,000 enemies.',             stat: 'kills', goal: 1000,  reward: { gold: 1500 } },
  exterminator:  { name: 'Exterminator',       description: 'Defeat 10,000 enemies.',            stat: 'kills', goal: 10000, reward: { gold: 10000 } },
  boss_hunter:   { name: 'Boss Hunter',        description: 'Defeat a zone boss.',               stat: 'bossKills', goal: 1,  reward: { gold: 150 } },
  boss_master:   { name: 'Boss Master',        description: 'Defeat 25 bosses.',                 stat: 'bossKills', goal: 25, reward: { gold: 2500 } },
  level_10:      { name: 'Seasoned',           description: 'Reach level 10 with your hero.',    stat: 'heroLevel', goal: 10, reward: { gold: 300 } },
  level_25:      { name: 'Veteran',            description: 'Reach level 25 with your hero.',    stat: 'heroLevel', goal: 25, reward: { gold: 2000 } },
  level_40:      { name: 'Legend of Ashenvale', description: 'Reach level 40 with your hero.',   stat: 'heroLevel', goal: 40, reward: { gold: 8000 } },
  recruiter:     { name: 'Recruiter',          description: 'Recruit 3 companions.',             stat: 'recruited', goal: 3,  reward: { gold: 150 } },
  warband:       { name: 'Warband',            description: 'Recruit 10 companions.',            stat: 'recruited', goal: 10, reward: { gold: 1000 } },
  treasure:      { name: 'Treasure Hunter',    description: 'Find an Epic or better item.',      stat: 'epicFound', goal: 1,  reward: { gold: 300 } },
  legendary:     { name: 'The Stuff of Legends', description: 'Find a Legendary or better item.', stat: 'legendaryFound', goal: 1, reward: { gold: 2000 } },
  together:      { name: 'Stronger Together',  description: 'Win a co-op encounter.',            stat: 'coopWins', goal: 1,   reward: { gold: 400 } },
  raid_leader:   { name: 'Raid Veteran',       description: 'Win 20 co-op encounters.',          stat: 'coopWins', goal: 20,  reward: { gold: 4000 } },
  explorer:      { name: 'Explorer',           description: 'Unlock all zones.',                 stat: 'zonesUnlocked', goal: 5, reward: { gold: 5000 } },
};
for (const [id, a] of Object.entries(ACHIEVEMENTS)) a.id = id;
