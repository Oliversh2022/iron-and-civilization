export const WIDTH = 26;
export const HEIGHT = 18;
export const STEP = 0.1;
export const VERSION = 3;
export const FACTIONS = [
  { id: 0, name: '苍岚联盟', short: '联盟', color: '#68acc9', dark: '#244b5a', mark: 'Ⅰ' },
  { id: 1, name: '赤铁帝国', short: '帝国', color: '#c96b61', dark: '#623c37', mark: 'Ⅱ' },
];
export const RESOURCES = { food: '粮食', industry: '工业', science: '科研', manpower: '人力' };
export const TERRAIN = {
  plain: { name: '平原', cost: 1, defense: 0, color: '#666f59', walkable: true },
  forest: { name: '森林', cost: 1.5, defense: 0.2, color: '#455947', walkable: true },
  hill: { name: '丘陵', cost: 1.7, defense: 0.3, color: '#7a7359', walkable: true },
  mountain: { name: '山地', cost: Infinity, defense: 0, color: '#6b6e63', walkable: false },
  water: { name: '水域', cost: Infinity, defense: 0, color: '#2e515b', walkable: false },
};
export const COMBAT_INTERVAL = 3;
export const ROAD_MOVEMENT_MULTIPLIER = 0.62;
export const ENGINEERING = {
  plain: { duration: 30, reward: {} },
  forest: { duration: 30, reward: { science: 20 } },
  hill: { duration: 60, reward: { industry: 30 } },
  water: { duration: 120, reward: {} },
  destroy: { duration: 30, reward: {} },
};
export const ENGINEERING_ACTIONS = {
  build: '建设 / 改造',
  destroy: '拆除道路',
  autoRoad: '自动铺路',
};
export const CITY_INCOME = { food: 0.45, industry: 0.4, science: 0.24, manpower: 0.27 };
export const BUILDINGS = {
  farm: { name: '农场', icon: 'food', description: '每级粮食产出 +0.8 /秒', output: 0.8, cost: { industry: 55, manpower: 12 }, duration: 27, max: 3 },
  factory: { name: '工厂', icon: 'industry', description: '每级工业产出 +0.67 /秒', output: 0.67, cost: { industry: 75, food: 25 }, duration: 36, max: 3 },
  lab: { name: '研究所', icon: 'science', description: '每级科研产出 +0.47 /秒', output: 0.47, cost: { industry: 65, manpower: 15 }, duration: 33, max: 3 },
};
export const UNITS = {
  infantry: { name: '步兵团', short: '步', description: '可靠的主力部队，可占领领土与城市。', hp: 120, damage: 14, range: 1, moveTime: 4.5, cost: { food: 30, industry: 35, manpower: 22 }, duration: 30, canCapture: true },
  artillery: { name: '炮兵营', short: '炮', description: '射程两格的远程火力，需要主力掩护。', hp: 80, damage: 24, range: 2, moveTime: 6, cost: { food: 20, industry: 65, manpower: 14 }, duration: 42, canCapture: false },
  tank: { name: '装甲师', short: '甲', description: '高生命与高机动，可突破防线并占领城市。', hp: 210, damage: 27, range: 1, moveTime: 3, cost: { food: 45, industry: 115, manpower: 25 }, duration: 54, canCapture: true, requires: 'armor' },
  engineer: { name: '工兵队', short: '工', icon: 'engineer', description: '无战斗力的工程部队，可占领区块、行军自动铺路、修路架桥与清理地形，不会被俘虏。', hp: 90, damage: 0, range: 0, moveTime: 4, cost: { food: 25, industry: 55, manpower: 18 }, duration: 36, canCapture: true },
};
export const TECHS = {
  agriculture: { name: '农业机械化', icon: 'food', description: '粮食产出提高 30%', cost: { science: 65 }, duration: 45, tier: 0 },
  industry: { name: '工业标准化', icon: 'industry', description: '工业产出提高 25%，开启装甲研究', cost: { science: 85 }, duration: 57, tier: 0 },
  logistics: { name: '战地后勤', icon: 'supply', description: '城市补给范围由 8 格增至 10 格', cost: { science: 90 }, duration: 53, tier: 0 },
  irrigation: { name: '轮作与灌溉', icon: 'food', description: '粮食产出再提高 20%', cost: { science: 105 }, duration: 58, requires: 'agriculture', tier: 1 },
  steel: { name: '平炉炼钢', icon: 'industry', description: '工业产出再提高 20%', cost: { science: 120 }, duration: 64, requires: 'industry', tier: 1 },
  armor: { name: '装甲作战', icon: 'tank', description: '解锁装甲师生产', cost: { science: 150 }, duration: 72, requires: 'industry', tier: 1 },
  radio: { name: '野战通讯', icon: 'science', description: '所有部队火力提高 10%', cost: { science: 115 }, duration: 60, requires: 'logistics', tier: 1 },
  chemistry: { name: '应用化学', icon: 'science', description: '科研产出提高 25%', cost: { science: 140 }, duration: 66, requires: 'irrigation', tier: 2 },
  mobility: { name: '机械化行军', icon: 'tank', description: '所有部队行军时间缩短 15%', cost: { science: 180 }, duration: 78, requires: 'armor', tier: 2 },
  massProduction: { name: '流水线生产', icon: 'industry', description: '城市生产速度提高 25%', cost: { science: 175 }, duration: 76, requires: 'steel', tier: 2 },
  combined: { name: '步坦协同', icon: 'infantry', description: '步兵与装甲部队火力提高 15%', cost: { science: 170 }, duration: 74, requires: 'radio', tier: 2 },
  ballistics: { name: '弹道测算', icon: 'artillery', description: '炮兵部队火力提高 20%', cost: { science: 185 }, duration: 76, requires: 'radio', tier: 2 },
  hydraulics: { name: '水利工程', icon: 'food', description: '粮食产出再提高 15%', cost: { science: 220 }, duration: 84, requires: 'chemistry', tier: 3 },
  automation: { name: '自动化生产', icon: 'industry', description: '工业产出再提高 15%', cost: { science: 230 }, duration: 86, requires: 'massProduction', tier: 3 },
  advancedLogistics: { name: '战略运输网', icon: 'supply', description: '城市补给范围由 10 格增至 12 格', cost: { science: 235 }, duration: 88, requires: 'logistics', tier: 3 },
  jointOperations: { name: '联合兵种司令部', icon: 'artillery', description: '所有部队火力再提高 10%', cost: { science: 240 }, duration: 92, requires: 'combined', tier: 3 },
};
export const FOUND_COST = { industry: 180, food: 100, manpower: 50 };
export const START_RESOURCES = { food: 180, industry: 210, science: 90, manpower: 140 };
export const ASSETS = {
  forest: 'assets/terrain/forest.png', mountain: 'assets/terrain/mountain.png',
  town: 'assets/cities/town.png', capital: 'assets/cities/capital.png',
  infantry: 'assets/units/infantry.png', artillery: 'assets/units/artillery.png', tank: 'assets/units/tank.png',
};
