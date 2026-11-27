import { createGame as createSeededGame, validateCommand, applyCommand, step, income, getSupply, getCombatTarget } from './rules.js';
import { STEP, WIDTH, HEIGHT, UNITS, BUILDINGS, TECHS, FOUND_COST, TERRAIN, COMBAT_INTERVAL, ENGINEERING, ROAD_MOVEMENT_MULTIPLIER } from './config.js';
import { serializeGame, deserializeGame, saveGame, loadGame, SAVE_KEY } from './storage.js';
import { createWorld, areCitiesConnected, neighbors, distance, findPath, computeSupply, isWalkable, movementCost } from './world.js';
import { updateAI } from './ai.js';

const createGame = (seed = 73129, playerFaction = 0) => createSeededGame(seed, playerFaction);
const tests = [];
const test = (name, run) => tests.push({ name, run });
const assert = (condition, message = '断言失败') => { if (!condition) throw new Error(message); };
const same = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const rotateTile = id => (HEIGHT - 1 - Math.floor(id / WIDTH)) * WIDTH + WIDTH - 1 - id % WIDTH;
const passageGroups = world => {
  const groups = [];
  for (let row = 0; row < HEIGHT; row++) {
    if (!isWalkable(world.tiles[row * WIDTH + 9]) || !isWalkable(world.tiles[row * WIDTH + 10])) continue;
    if (!groups.length || groups.at(-1).at(-1) !== row - 1) groups.push([]);
    groups.at(-1).push(row);
  }
  return groups;
};

test('固定种子地图可复现，含五类地形、三至五座要塞和额外中立城市', () => {
  const a = createWorld(), b = createWorld(); same(a, b);
  assert(a.tiles.length === 468); assert(a.citySites.length >= 14 && a.citySites.length <= 16);
  assert(new Set(a.tiles.map(t => t.terrain)).size === 5);
  const fortresses = a.citySites.filter(city => city.kind === 'fortress');
  assert(fortresses.length >= 3 && fortresses.length <= 5 && fortresses.every(city => city.owner === -1));
  assert(a.citySites.filter(city => city.owner === -1 && city.kind === 'city').length === 6 + fortresses.length % 2);
});
test('100 个种子均有三至五条实际通道，每条通道一座要塞且城市全部连通', () => {
  for (let i = 0; i < 100; i++) {
    const world = createWorld(73100 + i), seed = 73100 + i;
    const groups = passageGroups(world);
    const fortresses = world.citySites.filter(city => city.kind === 'fortress');
    assert(groups.length === fortresses.length, `种子 ${seed} 通道数 ${groups.length} 与要塞数 ${fortresses.length} 不符`);
    assert(groups.length >= 3 && groups.length <= 5, `种子 ${seed} 通道数越界`);
    assert(areCitiesConnected(world), `种子 ${seed} 不连通`);
    const state = { ...world, units: [] };
    for (const fortress of fortresses) {
      assert(groups.some(group => group.includes(Math.floor(fortress.tile / WIDTH))), `种子 ${seed} 要塞不在通道`);
      for (const capital of world.citySites.filter(city => city.capitalOf !== null)) {
        const path = findPath(state, capital.tile, fortress.tile);
        const group = groups.find(rows => rows.includes(Math.floor(fortress.tile / WIDTH)));
        assert(path && path.some(id => id % WIDTH >= 10 && id % WIDTH <= 15
          && group.includes(Math.floor(id / WIDTH))), `种子 ${seed} 要塞无法从首都到达`);
      }
    }
  }
});
test('地形、领地与中立城市对双方旋转对称，同距领地保持中立', () => {
  for (let i = 0; i < 60; i++) {
    const world = createWorld(81200 + i), seed = 81200 + i;
    for (const tile of world.tiles) {
      const mirror = world.tiles[rotateTile(tile.id)];
      assert(tile.terrain === mirror.terrain, `种子 ${seed} 地形不对称`);
      assert(mirror.owner === (tile.owner === -1 ? -1 : 1 - tile.owner), `种子 ${seed} 领地不对称`);
    }
    const neutral = world.citySites.filter(city => city.owner === -1);
    const totals = [0, 1].map(owner => neutral.reduce((sum, city) =>
      sum + world.citySites.filter(other => other.owner === owner)
        .reduce((distanceSum, other) => distanceSum + distance(world, city.tile, other.tile), 0), 0));
    assert(totals[0] === totals[1], `种子 ${seed} 中立城市偏向一方：${totals}`);
  }
});
test('地图边缘邻居合法，六邻接对称且轴距离为一', () => {
  const w = createWorld();
  for (const t of w.tiles) for (const id of neighbors(w, t.id)) { assert(w.tiles[id]); assert(neighbors(w, id).includes(t.id)); assert(distance(w, t.id, id) === 1); }
});
test('寻路绕过水域和山地，并正确返回不可达', () => {
  const s = createGame(); const from = s.cities[0].tile, to = s.cities[2].tile;
  const path = findPath(s, from, to); assert(path && path.length); assert(path.at(-1) === to);
  for (const id of path) assert(!['water', 'mountain'].includes(s.tiles[id].terrain));
  for (const id of neighbors(s, from)) s.tiles[id].terrain = 'mountain';
  assert(findPath(s, from, to) === null); same(findPath(s, from, from), []);
});
test('开局双方各两城、两步兵和一炮兵，库存完全相同', () => {
  const s = createGame(); for (const owner of [0, 1]) {
    assert(s.cities.filter(c => c.owner === owner).length === 2);
    assert(s.units.filter(u => u.owner === owner && u.type === 'infantry').length === 2);
    assert(s.units.filter(u => u.owner === owner && u.type === 'artillery').length === 1);
    assert(s.cities.some(c => c.capitalOf === owner));
  }
  same(s.factions[0].resources, s.factions[1].resources);
});
test('补给只扩散至己方陆地', () => {
  const s = createGame(); for (const owner of [0, 1]) {
    const supply = computeSupply(s, owner); assert(supply.size > 0);
    for (const id of supply) assert(s.tiles[id].owner === owner && !['water', 'mountain'].includes(s.tiles[id].terrain));
    for (const c of s.cities.filter(c => c.owner === owner)) assert(supply.has(c.tile));
  }
});
test('真实开局使用随机地图，并可选择玩家阵营', () => {
  const a = createSeededGame(), b = createSeededGame();
  assert(a.seed !== b.seed);
  assert(JSON.stringify(a.tiles) !== JSON.stringify(b.tiles));
  const empire = createSeededGame(73129, 1);
  assert(empire.playerFaction === 1);
  assert(empire.events[0].text.includes('赤铁帝国'));
  command(empire, { type: 'research', tech: 'agriculture' }, 1);
  assert(empire.factions[1].research?.tech === 'agriculture');
});
test('工兵可以生产，无战斗力且能够占领区块', () => {
  assert(UNITS.engineer.damage === 0 && UNITS.engineer.range === 0 && UNITS.engineer.canCapture);
  const s = flatGame(); const city = s.cities[0]; city.owner = 0;
  command(s, { type: 'produce', cityId: city.id, item: 'engineer' }, 0);
  advance(s, UNITS.engineer.duration);
  const engineer = s.units.find(u => u.type === 'engineer' && u.owner === 0);
  assert(engineer);
  engineer.hp = UNITS.engineer.hp; engineer.tile = 1; s.tiles[1].owner = 1;
  const enemyHp = troop(s, 1, 2).hp;
  advance(s, 5);
  assert(s.tiles[1].owner === 0);
  assert(s.units.find(u => u.owner === 1).hp === enemyHp);
});
test('工兵在平原手动铺路需要30秒', () => {
  const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].owner = 0;
  const engineer = troop(s, 0, 0, 'engineer');
  command(s, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'build' });
  assert(engineer.work?.duration === ENGINEERING.plain.duration);
  advance(s, ENGINEERING.plain.duration - STEP);
  assert(s.tiles[1].road === null);
  advance(s, STEP);
  same(s.tiles[1].road, { owner: 0, kind: 'road' });
});
test('清理森林30秒并获得科研指数，不自动顺带铺路', () => {
  const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].terrain = 'forest'; s.tiles[1].owner = 0;
  const engineer = troop(s, 0, 0, 'engineer'); const before = s.factions[0].resources.science;
  const rate = income(s, 0).science;
  command(s, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'build' });
  advance(s, ENGINEERING.forest.duration);
  assert(s.tiles[1].terrain === 'plain' && s.tiles[1].road === null);
  close(s.factions[0].resources.science, before + ENGINEERING.forest.reward.science + rate * ENGINEERING.forest.duration);
});
test('夷平丘陵60秒获得工业指数并形成公路', () => {
  const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].terrain = 'hill'; s.tiles[1].owner = 0;
  const engineer = troop(s, 0, 0, 'engineer'); const before = s.factions[0].resources.industry;
  const rate = income(s, 0).industry;
  command(s, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'build' });
  advance(s, ENGINEERING.hill.duration - STEP);
  assert(s.tiles[1].terrain === 'hill' && s.tiles[1].road === null);
  advance(s, STEP);
  assert(s.tiles[1].terrain === 'plain');
  same(s.tiles[1].road, { owner: 0, kind: 'road' });
  close(s.factions[0].resources.industry, before + ENGINEERING.hill.reward.industry + rate * ENGINEERING.hill.duration);
});
test('河流架桥需要120秒，并开放寻路和补给通行', () => {
  const s = flatGame(); s.cities[0].owner = 0; s.cities[0].tile = 0;
  s.tiles[0].owner = 0; s.tiles[1].terrain = 'water'; s.tiles[1].owner = 0;
  const engineer = troop(s, 0, 0, 'engineer');
  assert(!isWalkable(s.tiles[1]) && findPath(s, 0, 1) === null);
  command(s, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'build' });
  advance(s, ENGINEERING.water.duration - STEP);
  assert(!isWalkable(s.tiles[1]));
  advance(s, STEP);
  same(s.tiles[1].road, { owner: 0, kind: 'bridge' });
  same(findPath(s, 0, 1), [1]);
  assert(getSupply(s, 0).has(1));
});
test('工兵可拆除敌方道路和桥梁，不能拆除己方道路', () => {
  for (const [terrain, kind] of [['plain', 'road'], ['water', 'bridge']]) {
    const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].terrain = terrain;
    s.tiles[1].road = { owner: 1, kind }; const engineer = troop(s, 0, 0, 'engineer');
    assert(!applyCommand(s, 0, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'build' }).ok);
    command(s, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'destroy' });
    advance(s, ENGINEERING.destroy.duration);
    assert(s.tiles[1].road === null);
  }
  const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].road = { owner: 0, kind: 'road' };
  const engineer = troop(s, 0, 0, 'engineer');
  assert(!applyCommand(s, 0, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'destroy' }).ok);
});
test('拆除期间桥梁被部队占用时取消拆除并保留桥梁', () => {
  const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].terrain = 'water';
  s.tiles[1].road = { owner: 1, kind: 'bridge' }; const engineer = troop(s, 0, 0, 'engineer');
  command(s, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'destroy' });
  advance(s, ENGINEERING.destroy.duration - STEP);
  troop(s, 0, 1);
  advance(s, STEP);
  same(s.tiles[1].road, { owner: 1, kind: 'bridge' });
  assert(engineer.work === null && engineer.status === '作业目标已变化');
  deserializeGame(serializeGame(s));
});
test('公路和桥梁缩短其他兵种移动耗时', () => {
  const walk = road => {
    const s = flatGame(); s.cities[0].owner = 0; s.cities[0].tile = 0;
    s.tiles[0].owner = 0; s.tiles[1].owner = 0;
    s.tiles[1].road = road; const unit = troop(s, 0, 0);
    command(s, { type: 'order', unitId: unit.id, tile: 1 });
    const duration = UNITS.infantry.moveTime * movementCost(s, 1);
    advance(s, duration - STEP); assert(unit.tile === 0);
    advance(s, STEP); assert(unit.tile === 1);
    return duration;
  };
  const plain = walk(null);
  const road = walk({ owner: 0, kind: 'road' });
  const bridgeState = flatGame(); bridgeState.tiles[1].terrain = 'water'; bridgeState.tiles[1].road = { owner: 0, kind: 'bridge' };
  assert(road < plain && road === UNITS.infantry.moveTime * ROAD_MOVEMENT_MULTIPLIER);
  assert(movementCost(bridgeState, 1) < 1);
});
test('工兵行军经过无公路平原自动铺路且不中断', () => {
  const s = flatGame(); s.cities[0].tile = 3; s.cities[0].owner = 0;
  for (const id of [0, 1, 2, 3]) s.tiles[id].owner = 0;
  const engineer = troop(s, 0, 0, 'engineer');
  command(s, { type: 'order', unitId: engineer.id, tile: 2 });
  advance(s, STEP);
  same(s.tiles[0].road, { owner: 0, kind: 'road' });
  assert(engineer.tile === 0 && engineer.order && engineer.work === null);
  advance(s, UNITS.engineer.moveTime - STEP);
  same(s.tiles[1].road, { owner: 0, kind: 'road' });
  assert(engineer.tile === 1 && engineer.order && engineer.work === null);
  advance(s, UNITS.engineer.moveTime + STEP);
  same(s.tiles[2].road, { owner: 0, kind: 'road' });
  assert(engineer.tile === 2 && engineer.order === null && engineer.work === null);
  assert(s.infrastructureVersion === 3);
  const version = s.infrastructureVersion;
  advance(s, ENGINEERING.plain.duration);
  assert(s.infrastructureVersion === version && engineer.work === null);
});
test('工兵行军跳过已有公路、森林、丘陵和城市', () => {
  const cases = [
    { name: '己方公路', prepare: s => { s.tiles[1].road = { owner: 0, kind: 'road' }; }, road: { owner: 0, kind: 'road' } },
    { name: '敌方公路', prepare: s => { s.tiles[1].road = { owner: 1, kind: 'road' }; }, road: { owner: 1, kind: 'road' } },
    { name: '森林', prepare: s => { s.tiles[1].terrain = 'forest'; }, road: null },
    { name: '丘陵', prepare: s => { s.tiles[1].terrain = 'hill'; }, road: null },
    { name: '城市', prepare: s => { const city = s.cities.find(c => c.capitalOf === null); city.tile = 1; city.owner = 0; }, road: null },
  ];
  for (const entry of cases) {
    const s = flatGame(); s.tiles[0].owner = 0; entry.prepare(s);
    const engineer = troop(s, 0, 0, 'engineer');
    command(s, { type: 'order', unitId: engineer.id, tile: 1 });
    advance(s, 15);
    assert(engineer.tile === 1, entry.name);
    assert(JSON.stringify(s.tiles[1].road) === JSON.stringify(entry.road), entry.name);
  }
});
test('工兵行军可在无敌军占领的异属平原自动铺路', () => {
  const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].owner = 1;
  const engineer = troop(s, 0, 0, 'engineer');
  command(s, { type: 'order', unitId: engineer.id, tile: 1 });
  advance(s, 10);
  same(s.tiles[1].road, { owner: 0, kind: 'road' });
  assert(s.tiles[1].owner === 0);
});
test('空闲工兵不再自动铺路', () => {
  const s = flatGame(); s.tiles[0].owner = 0;
  const engineer = troop(s, 0, 0, 'engineer');
  advance(s, ENGINEERING.plain.duration);
  assert(s.tiles[0].road === null && engineer.work === null);
});
test('道路和工程作业可严格存档读档', () => {
  const s = flatGame(); s.tiles[0].owner = 0; s.tiles[1].terrain = 'water'; s.tiles[1].owner = 0;
  s.tiles[2].road = { owner: 1, kind: 'road' }; const engineer = troop(s, 0, 0, 'engineer');
  command(s, { type: 'engineer', unitId: engineer.id, tile: 1, action: 'build' });
  const restored = deserializeGame(serializeGame(s));
  assert(restored.playerFaction === s.playerFaction);
  assert(restored.infrastructureVersion === s.infrastructureVersion);
  same(restored.tiles[2].road, { owner: 1, kind: 'road' });
  same(restored.units[0].work, engineer.work);
});

const close = (a, b) => assert(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const advance = (s, seconds) => { for (let i = 0; i < Math.round(seconds / STEP); i++) step(s); };
function flatGame() {
  const s = createGame(); s.units = []; s.paused = false;
  for (const t of s.tiles) { t.terrain = 'plain'; t.owner = -1; }
  for (const c of s.cities) s.tiles[c.tile].owner = c.owner;
  return s;
}
function troop(s, owner, tile, type = 'infantry') {
  const u = { id: s.nextId++, owner, tile, type, hp: UNITS[type].hp, path: [], order: null, progress: 0, cooldown: 0, replanAt: 0, status: '待命', work: null };
  s.units.push(u); return u;
}
const command = (s, c, owner = 0) => { const r = applyCommand(s, owner, c); assert(r.ok, r.reason); };
function occupiedProduction(item) {
  const s = createGame(); s.units = []; s.paused = false;
  const city = s.cities.find(c => c.tile === 357); city.hp = 0;
  const blocker = troop(s, 0, 358, 'artillery');
  command(s, { type: 'produce', cityId: city.id, item }, city.owner);
  command(s, { type: 'order', unitId: blocker.id, tile: 356 });
  same(blocker.path, [357, 356]);
  for (let i = 0; i < 200 && blocker.tile !== city.tile; i++) step(s);
  assert(blocker.tile === city.tile && city.owner === 1);
  command(s, { type: 'hold', unitId: blocker.id });
  return { s, city, blocker };
}

test('拒绝资源不足、非法归属、未知指令时完全不改变状态', () => {
  const s = createGame(); s.factions[0].resources.industry = 0;
  for (const c of [{ type: 'produce', cityId: 1, item: 'farm' }, { type: 'produce', cityId: 3, item: 'infantry' }, { type: 'wat' }, { type: 'produce', cityId: 1, item: '__proto__' }]) {
    const before = JSON.stringify(s); assert(!applyCommand(s, 0, c).ok); assert(JSON.stringify(s) === before);
  }
});
test('建造开工扣费、占槽、取消退款50%，不能重复退款', () => {
  const s = createGame(), before = { ...s.factions[0].resources };
  command(s, { type: 'produce', cityId: 1, item: 'factory' });
  close(s.factions[0].resources.industry, before.industry - BUILDINGS.factory.cost.industry);
  assert(!validateCommand(s, 0, { type: 'produce', cityId: 1, item: 'infantry' }).ok);
  command(s, { type: 'cancel', cityId: 1 });
  close(s.factions[0].resources.industry, before.industry - BUILDINGS.factory.cost.industry / 2);
  assert(!applyCommand(s, 0, { type: 'cancel', cityId: 1 }).ok);
});
test('敌炮兵合法穿越破城时征兵完成留槽归零，清空后仅部署一次且不重复收费或刷战报', () => {
  const { s, city, blocker } = occupiedProduction('infantry');
  const production = city.production, before = { ...s.factions[1].resources }, rate = income(s, 1);
  const startedAt = s.time, nextId = s.nextId, events = structuredClone(s.events);
  advance(s, UNITS.infantry.duration - s.time);
  assert(city.production === production && production.remaining === 0);
  advance(s, 3);
  assert(s.units.length === 1 && s.nextId === nextId && city.owner === 1);
  same(s.events, events);
  assert(!applyCommand(s, 1, { type: 'produce', cityId: city.id, item: 'infantry' }).ok);
  for (const key of Object.keys(before)) close(s.factions[1].resources[key], before[key] + rate[key] * (s.time - startedAt));
  same(deserializeGame(serializeGame(s)).cities.find(c => c.id === city.id).production, production);
  command(s, { type: 'order', unitId: blocker.id, tile: 356 });
  for (let i = 0; i < 200 && blocker.tile === city.tile; i++) {
    step(s);
    assert(s.units.length === 1 && city.production === production && production.remaining === 0);
  }
  assert(blocker.tile === 356);
  step(s);
  const deployed = s.units.find(u => u.owner === city.owner);
  assert(city.production === null && deployed?.type === 'infantry' && deployed.tile === city.tile);
  advance(s, 1);
  assert(s.units.length === 2 && s.nextId === nextId + 1 && s.events.length === events.length + 1);
  for (const key of Object.keys(before)) close(s.factions[1].resources[key], before[key] + rate[key] * (s.time - startedAt));
});
test('部署受阻的完成征兵可取消并仅退还一次50%费用', () => {
  const { s, city } = occupiedProduction('infantry');
  advance(s, UNITS.infantry.duration + 1 - s.time);
  assert(city.production?.remaining === 0);
  const before = { ...s.factions[1].resources }, events = structuredClone(s.events);
  command(s, { type: 'cancel', cityId: city.id }, city.owner);
  assert(city.production === null);
  for (const key of Object.keys(before)) close(s.factions[1].resources[key], before[key] + (UNITS.infantry.cost[key] || 0) / 2);
  const cancelled = JSON.stringify(s);
  assert(!applyCommand(s, city.owner, { type: 'cancel', cityId: city.id }).ok);
  assert(JSON.stringify(s) === cancelled);
  advance(s, 1);
  assert(s.units.length === 1 && city.production === null);
  same(s.events, events);
});
test('步兵实际进驻夺取受阻征兵城市时清空完成槽且不退款', () => {
  const { s, city } = occupiedProduction('infantry');
  advance(s, UNITS.infantry.duration + 1 - s.time);
  assert(city.production?.remaining === 0);
  const capturer = troop(s, 0, 358);
  command(s, { type: 'order', unitId: capturer.id, tile: city.tile });
  same(capturer.path, [city.tile]);
  const before = { ...s.factions[1].resources }, rate = income(s, 1), startedAt = s.time;
  const nextId = s.nextId, eventCount = s.events.length;
  for (let i = 0; i < 200 && city.owner === 1; i++) {
    step(s);
    assert(s.units.every(u => u.owner === 0));
  }
  assert(capturer.tile === city.tile && city.owner === 0 && city.production === null);
  assert(s.tiles[city.tile].owner === 0 && s.events.length === eventCount + 1);
  for (const key of Object.keys(before)) close(s.factions[1].resources[key], before[key] + rate[key] * (s.time - startedAt));
  advance(s, 1);
  assert(s.units.length === 2 && s.nextId === nextId && city.production === null);
});
test('敌炮兵停留在破城地块不阻止建筑正常完成', () => {
  const { s, city, blocker } = occupiedProduction('factory'), eventCount = s.events.length;
  advance(s, BUILDINGS.factory.duration - s.time);
  assert(blocker.tile === city.tile && city.owner === 1);
  assert(city.production === null && city.buildings.factory === 1);
  assert(s.units.length === 1 && s.events.length === eventCount + 1);
});
test('基础收入恢复零资源，建筑完成后准确提高产出', () => {
  const s = createGame(); s.units = []; s.paused = false;
  command(s, { type: 'produce', cityId: 1, item: 'farm' }); const old = income(s, 0).food;
  advance(s, BUILDINGS.farm.duration); assert(s.cities[0].buildings.farm === 1); assert(s.cities[0].production === null); close(income(s, 0).food, old + BUILDINGS.farm.output);
  for (const key of Object.keys(s.factions[0].resources)) s.factions[0].resources[key] = 0;
  advance(s, 1); for (const n of Object.values(s.factions[0].resources)) assert(n > 0);
});
test('工业是装甲前置，研究与生产独立，装甲完成才可征兵', () => {
  const s = createGame(); s.units = []; s.paused = false; s.factions[0].resources.science = 1000;
  assert(!validateCommand(s, 0, { type: 'research', tech: 'armor' }).ok);
  assert(!validateCommand(s, 0, { type: 'produce', cityId: 1, item: 'tank' }).ok);
  command(s, { type: 'research', tech: 'industry' }); command(s, { type: 'produce', cityId: 1, item: 'infantry' });
  advance(s, TECHS.industry.duration); assert(s.factions[0].techs.includes('industry')); assert(s.units.length === 1);
  command(s, { type: 'research', tech: 'armor' }); advance(s, TECHS.armor.duration);
  command(s, { type: 'produce', cityId: 1, item: 'tank' }); advance(s, UNITS.tank.duration); assert(s.units.some(u => u.type === 'tank'));
});
test('新增科技遵守前置并提高经济与补给范围', () => {
  const s = createGame(); s.units = []; const faction = s.factions[0];
  faction.resources.science = 1000;
  assert(!validateCommand(s, 0, { type: 'research', tech: 'advancedLogistics' }).ok);
  faction.techs = ['agriculture', 'irrigation', 'chemistry', 'industry', 'steel', 'massProduction', 'logistics'];
  const base = income(s, 0);
  faction.techs.push('hydraulics', 'automation', 'advancedLogistics');
  close(income(s, 0).food, base.food * 1.15); close(income(s, 0).industry, base.industry * 1.15);
  deserializeGame(serializeGame(s));
  for (const tile of s.tiles) if (TERRAIN[tile.terrain].walkable) tile.owner = 0;
  faction.techs = ['logistics'];
  const baseSupply = computeSupply(s, 0);
  faction.techs.push('advancedLogistics');
  assert(computeSupply(s, 0).size > baseSupply.size);
  faction.techs = ['logistics', 'radio'];
  assert(validateCommand(s, 0, { type: 'research', tech: 'ballistics' }).ok);
});
test('弹道科技按比例提高炮兵伤害', () => {
  const damage = enabled => {
    const s = flatGame(); s.factions[0].techs = enabled ? ['ballistics'] : [];
    s.tiles[239].owner = 0; s.tiles[240].owner = 1;
    troop(s, 0, 239, 'artillery'); const target = troop(s, 1, 240);
    step(s); return UNITS.infantry.hp - target.hp;
  };
  close(damage(true) - damage(false), UNITS.artillery.damage * .2);
});
test('暂停冻结经济、生产、研究、移动、战斗和计时', () => {
  const s = createGame(); command(s, { type: 'research', tech: 'industry' }); command(s, { type: 'produce', cityId: 1, item: 'infantry' });
  command(s, { type: 'order', unitId: s.units[0].id, tile: s.cities[0].tile });
  const before = JSON.stringify(s); advance(s, 20); assert(JSON.stringify(s) === before);
});
test('1/2/4倍以同样模拟步数运行得到完全相同状态', () => {
  const results = [1, 2, 4].map(speed => {
    const s = createGame(); s.paused = false; s.speed = speed;
    command(s, { type: 'produce', cityId: 1, item: 'infantry' });
    for (let frame = 0; frame < 400 / speed; frame++) for (let i = 0; i < speed; i++) step(s);
    s.speed = 1; return s;
  }); same(results[0], results[1]); same(results[0], results[2]);
});
test('水山、地图外与被敌人完全封锁的路径给出失败原因', () => {
  const s = flatGame(), u = troop(s, 0, 0); for (const t of s.tiles) t.terrain = 'mountain';
  for (let i = 0; i <= 4; i++) s.tiles[i].terrain = 'plain'; troop(s, 1, 2);
  for (const tile of [4, 26, -1, 468]) assert(!validateCommand(s, 0, { type: 'order', unitId: u.id, tile }).ok);
  const attack = validateCommand(s, 0, { type: 'order', unitId: u.id, tile: 2 }); assert(attack.ok); same(attack.path, [1]);
});
test('友军同格不阻路，步兵行军后占领经过的地块', () => {
  const s = flatGame(), a = troop(s, 0, 0), b = troop(s, 0, 1);
  command(s, { type: 'order', unitId: a.id, tile: 1 }); advance(s, UNITS.infantry.moveTime / 0.6);
  assert(a.tile === b.tile); assert(s.tiles[1].owner === 0); assert(a.order === null);
});
test('敌军同时进入空格按时刻与地块决定先手，反转数组结果不变', () => {
  for (const middle of [1, 2]) for (const tick of [0, 1]) {
    const results = [false, true].map(reverse => {
      const s = flatGame(), a = troop(s, 0, middle - 1), b = troop(s, 1, middle + 1);
      s.tick = tick; s.time = tick * STEP;
      for (const u of s.units) command(s, { type: 'order', unitId: u.id, tile: middle }, u.owner);
      if (reverse) s.units.reverse();
      advance(s, UNITS.infantry.moveTime / 0.6 - STEP);
      same([a.tile, b.tile], [middle - 1, middle + 1]);
      step(s);
      const arrived = s.units.filter(u => u.tile === middle);
      assert(arrived.length === 1, '对向行军应有且仅有一方抵达空格');
      assert(arrived[0].owner === (s.tick + middle) % 2);
      assert(distance(s, a.tile, b.tile) === 1);
      for (const u of [a, b]) close(u.hp, UNITS.infantry.hp - UNITS.infantry.damage * 0.6);
      return [...s.units].sort((a, b) => a.id - b.id);
    });
    same(results[0], results[1]);
  }
});
test('空格争夺不会永久僵持，双方相邻交战并同时阵亡且从不敌我同格', () => {
  const s = flatGame(); troop(s, 0, 0); troop(s, 1, 2);
  for (const u of s.units) command(s, { type: 'order', unitId: u.id, tile: 1 }, u.owner);
  const duration = UNITS.infantry.moveTime / 0.6 + Math.ceil(UNITS.infantry.hp / (UNITS.infantry.damage * 0.6)) * COMBAT_INTERVAL;
  for (let i = 0; i < Math.ceil(duration / STEP); i++) {
    step(s);
    assert(!s.units.some(a => s.units.some(b => a.owner !== b.owner && a.tile === b.tile)), '敌我不能同格');
  }
  assert(s.units.length === 0, '争夺应进入同步战斗，而非永远等待通路');
});
test('争夺空格仅阻止败方阵营，胜方友军仍可同时叠放', () => {
  for (const tick of [0, 1]) for (const reverse of [false, true]) {
    const s = flatGame(); s.tick = tick; s.time = tick * STEP;
    for (const owner of [0, 1]) { troop(s, owner, owner * 2); troop(s, owner, owner * 2); }
    for (const u of s.units) command(s, { type: 'order', unitId: u.id, tile: 1 }, u.owner);
    if (reverse) s.units.reverse();
    advance(s, UNITS.infantry.moveTime / 0.6);
    const winner = (s.tick + 1) % 2;
    assert(s.units.filter(u => u.tile === 1).length === 2, '胜方友军应同时抵达');
    for (const u of s.units) assert(u.tile === (u.owner === winner ? 1 : u.owner * 2));
  }
});
test('森林移动耗时与断供速度惩罚生效，不额外扣血', () => {
  const make = supplied => { const s = flatGame(); if (supplied) { s.cities[0].tile = 0; s.tiles[0].owner = 0; } s.tiles[1].terrain = 'forest'; const u = troop(s, 0, 0); command(s, { type: 'order', unitId: u.id, tile: 1 }); return { s, u }; };
  const a = make(true), b = make(false), duration = UNITS.infantry.moveTime * TERRAIN.forest.cost;
  advance(a.s, (Math.ceil(duration / STEP) - 1) * STEP); assert(a.u.tile === 0); step(a.s); assert(a.u.tile === 1);
  advance(b.s, (Math.ceil(duration / 0.6 / STEP) - 1) * STEP); assert(b.u.tile === 0); step(b.s); assert(b.u.tile === 1); assert(b.u.hp === UNITS.infantry.hp);
});
test('追击更快的移动目标时相同下一格保留进度，慢速部队持续前进', () => {
  const s = flatGame(), chaser = troop(s, 0, 0), target = troop(s, 1, 4, 'tank');
  command(s, { type: 'order', unitId: chaser.id, tile: target.tile });
  command(s, { type: 'order', unitId: target.id, tile: 20 }, target.owner);
  advance(s, Math.ceil(UNITS.tank.moveTime / 0.6 / STEP) * STEP);
  assert(target.tile === 5 && chaser.tile === 0);
  const progress = chaser.progress, next = chaser.path[0];
  assert(progress > STEP && next === 1);
  step(s);
  assert(chaser.order.targetId === target.id && chaser.order.tile === target.tile);
  assert(chaser.path[0] === next);
  close(chaser.progress, progress + STEP);
  advance(s, 3 * UNITS.infantry.moveTime / 0.6 - s.time);
  assert(chaser.tile === 3, '目标持续移动时追击者仍应完成三段行军');
  assert(target.tile > 5 && target.path.length > 0);
});
test('追击目标改向导致下一格改变时重置原路段进度', () => {
  const s = flatGame(), chaser = troop(s, 0, 0), target = troop(s, 1, 4);
  command(s, { type: 'order', unitId: chaser.id, tile: target.tile });
  advance(s, 1);
  const next = chaser.path[0]; close(chaser.progress, 1);
  target.tile = s.width * 4;
  step(s);
  assert(chaser.order.tile === target.tile && chaser.path.length > 0 && chaser.path[0] !== next);
  close(chaser.progress, STEP);
  assert(chaser.tile === 0);
});
test('同时致死伤害不会因单位数组顺序产生先手优势', () => {
  for (const reverse of [false, true]) { const s = flatGame(); const a = troop(s, 0, 0), b = troop(s, 1, 1); a.hp = b.hp = 14 * 0.6; if (reverse) s.units.reverse(); step(s); assert(s.units.length === 0); }
});
test('自动交战目标与战斗一致，冷却期间可读且不会改变指令', () => {
  const s = flatGame(), a = troop(s, 0, 0, 'artillery'), b = troop(s, 1, 2);
  const before = JSON.stringify(s);
  assert(getCombatTarget(s, a) === b && a.order === null);
  assert(JSON.stringify(s) === before);
  step(s); assert(b.hp < UNITS.infantry.hp && a.cooldown === COMBAT_INTERVAL);
  assert(getCombatTarget(s, a) === b && a.order === null);
  b.tile = 10; assert(getCombatTarget(s, a) === null);
  const city = s.cities.find(c => c.owner === 1); city.tile = 1;
  assert(getCombatTarget(s, a) === city);
  city.hp = 0; assert(getCombatTarget(s, a) === null);
  b.tile = 2; city.hp = 300; assert(getCombatTarget(s, a) === b);
});
test('炮兵可在两格外开火，地形减伤与断供伤害准确', () => {
  const s = flatGame(); troop(s, 0, 0, 'artillery'); const target = troop(s, 1, 2); s.tiles[2].terrain = 'hill';
  step(s); close(target.hp, 120 - 24 * 0.6 * 0.7); assert(s.units[0].hp === 80); assert(s.effects.length === 1);
});
test('中立城无需攻击守备，炮兵不能占城，步兵可占城', () => {
  const s = flatGame(), c = s.cities.find(c => c.owner === -1), a = troop(s, 0, c.tile, 'artillery');
  step(s); assert(c.owner === -1); a.type = 'infantry'; a.hp = 120; step(s); assert(c.owner === 0); assert(s.tiles[c.tile].owner === 0); assert(getSupply(s, 0).has(c.tile));
});
test('守备未破不能占城；破城后敌军未清也不能占领', () => {
  const s = flatGame(), city = s.cities[3], a = troop(s, 0, city.tile); step(s); assert(city.owner === 1);
  city.hp = 0; troop(s, 1, city.tile); step(s); assert(city.owner === 1); assert(a.hp > 0);
});
test('城市失守取消生产且不退款，驻留夺取领土并重建补给', () => {
  const s = flatGame(), c = s.cities[3]; command(s, { type: 'produce', cityId: c.id, item: 'factory' }, 1); const before = s.factions[1].resources.industry, rate = income(s, 1).industry;
  c.hp = 0; troop(s, 0, c.tile); step(s); assert(c.owner === 0); assert(c.production === null); close(s.factions[1].resources.industry, before + rate * STEP); assert(getSupply(s, 0).has(c.tile));
});
test('补给断路/恢复与后勤8→10格覆盖', () => {
  const s = flatGame(); s.cities[0].tile = 0; for (let i = 0; i <= 11; i++) s.tiles[i].owner = 0;
  assert(getSupply(s, 0).has(8)); assert(!getSupply(s, 0).has(9));
  s.tiles[4].owner = 1; s.territoryVersion++; assert(!getSupply(s, 0).has(8));
  s.tiles[4].owner = 0; s.territoryVersion++; assert(getSupply(s, 0).has(8));
  s.factions[0].techs.push('logistics'); assert(getSupply(s, 0).has(10)); assert(!getSupply(s, 0).has(11));
});
test('建城验证己方平原、补给、驻留、间距和费用', () => {
  const s = flatGame(); s.cities[0].tile = 0; for (let i = 0; i <= 8; i++) s.tiles[i].owner = 0;
  const u = troop(s, 0, 3); assert(!validateCommand(s, 0, { type: 'found', unitId: u.id }).ok);
  const cityCount = s.cities.length;
  u.tile = 4; const before = s.factions[0].resources.industry; command(s, { type: 'found', unitId: u.id });
  assert(s.cities.length === cityCount + 1); close(s.factions[0].resources.industry, before - FOUND_COST.industry); assert(!validateCommand(s, 0, { type: 'found', unitId: u.id }).ok);
});
test('攻城指令抵达射程、击破守备后自动进城并获胜', () => {
  const s = flatGame(), capital = s.cities[2]; capital.hp = 1;
  const u = troop(s, 0, neighbors(s, capital.tile)[0]); command(s, { type: 'order', unitId: u.id, tile: capital.tile });
  advance(s, 10); assert(s.outcome === 'victory'); assert(capital.owner === 0); assert(u.tile === capital.tile);
});
test('首都失守判负，同步互占判平，终局后完全停止', () => {
  for (const outcome of ['defeat', 'draw']) {
    const s = flatGame(); const home = s.cities[0]; home.hp = 0; troop(s, 1, home.tile);
    if (outcome === 'draw') { const away = s.cities[2]; away.hp = 0; troop(s, 0, away.tile); }
    step(s); assert(s.outcome === outcome); assert(s.paused); const before = JSON.stringify(s); advance(s, 10); assert(JSON.stringify(s) === before);
  }
});
test('玩家选择帝国时胜负和AI均相对该阵营', () => {
  const s = createGame(73129, 1); s.units = []; s.paused = false;
  const enemyCapital = s.cities.find(c => c.capitalOf === 0); enemyCapital.hp = 0;
  troop(s, 1, enemyCapital.tile); step(s); assert(s.outcome === 'victory');
  const ai = createGame(73129, 1); ai.paused = false; ai.ai.nextAt = 0;
  ai.factions[0].resources = { food: 0, industry: 0, science: 0, manpower: 0 };
  const playerResources = { ...ai.factions[1].resources };
  updateAI(ai);
  same(ai.factions[0].resources, { food: 0, industry: 0, science: 0, manpower: 0 });
  same(ai.factions[1].resources, playerResources);
});

test('存档往返保留生产、研究、移动与AI计时，加载暂停且不改原状态', () => {
  const s = createGame(); s.paused = false;
  command(s, { type: 'produce', cityId: 1, item: 'farm' }); command(s, { type: 'research', tech: 'industry' });
  command(s, { type: 'order', unitId: s.units[0].id, tile: s.cities[0].tile }); advance(s, 0.7);
  const before = JSON.stringify(s), restored = deserializeGame(serializeGame(s));
  assert(JSON.stringify(s) === before); assert(restored !== s && restored.paused); assert(restored.units[0].progress > 0);
  const expected = structuredClone(s); expected.paused = true; same(restored, expected);
  restored.paused = false; advance(restored, 10); advance(s, 10); same(restored, s);
});
test('损坏JSON、错误版本、非有限资源、非法路径与伪造终局被拒绝', () => {
  const original = createGame(), bad = [];
  for (const mutate of [s => s.version++, s => s.factions[0].resources.food = -1, s => s.tiles[0].q++, s => s.units[0].type = 'aircraft', s => s.units[0].path = [467], s => s.outcome = 'victory', s => s.cities[0].owner = 1, s => s.cities[0].kind = 'city', s => s.units.push({ ...s.units[0] }), s => s.ai.targets = { '__proto__': { bad: true } }]) {
    const s = structuredClone(original); mutate(s); bad.push(s);
  }
  for (const s of bad) { let threw = false; try { serializeGame(s); } catch { threw = true; } assert(threw); }
  for (const text of ['{oops', 'null', '[]', '{"__proto__":{"polluted":true}}']) { let threw = false; try { deserializeGame(text); } catch { threw = true; } assert(threw); }
  assert({}.polluted === undefined);
});
test('加载拒绝巨大、越界未来和负值的AI及重新寻路时间戳', () => {
  const original = createGame(); original.paused = false; advance(original, 10);
  const unit = original.units.find(u => u.owner === 1);
  original.ai.targets[unit.id] = { tile: unit.tile, at: original.time };
  original.ai.lastPositions[unit.id] = { tile: unit.tile, since: original.time };
  for (const [label, lead, setTimer] of [
    ['ai.nextAt', 2, (s, value) => s.ai.nextAt = value],
    ['ai.targets.at', 0, (s, value) => s.ai.targets[unit.id].at = value],
    ['ai.lastPositions.since', 0, (s, value) => s.ai.lastPositions[unit.id].since = value],
    ['unit.replanAt', 2, (s, value) => s.units[0].replanAt = value],
  ]) {
    for (const value of [-STEP, original.time + lead + 2e-8, original.time + lead + 1, Number.MAX_VALUE]) {
      const s = structuredClone(original); setTimer(s, value);
      const result = loadGame({ getItem: () => JSON.stringify(s) });
      assert(!result.ok && result.reason.includes('存档无效'), `${label}=${value} 应被拒绝`);
    }
  }
});
test('存档接受当前、过期、零值及含容差边界的AI与重新寻路时间戳', () => {
  for (const seconds of [0, 10]) {
    const original = createGame(); original.paused = false; advance(original, seconds);
    assert(deserializeGame(serializeGame(original)).ai.nextAt === 2);
    for (const [scheduled, remembered] of [
      [0, 0], [original.time / 2, original.time / 2], [original.time, original.time],
      [original.time + 1, original.time], [original.time + 2, original.time],
      [original.time + 2 + 1e-8, original.time + 1e-8],
    ]) {
      const s = structuredClone(original), unit = s.units.find(u => u.owner === 1);
      s.ai.nextAt = scheduled; s.units[0].replanAt = scheduled;
      s.ai.targets[unit.id] = { tile: unit.tile, at: remembered };
      s.ai.lastPositions[unit.id] = { tile: unit.tile, since: remembered };
      const restored = deserializeGame(serializeGame(s)), expected = structuredClone(s); expected.paused = true;
      same(restored, expected);
    }
  }
});
test('本地单槽存读档、空间/访问错误和空存档均有结果且不覆盖好存档', () => {
  let saved = null; const memory = { getItem: key => { assert(key === SAVE_KEY); return saved; }, setItem: (key, value) => { assert(key === SAVE_KEY); saved = value; } };
  assert(!loadGame(memory).ok); const s = createGame(); assert(saveGame(s, memory).ok); assert(loadGame(memory).ok);
  const before = saved; s.units[0].hp = Infinity; assert(!saveGame(s, memory).ok); assert(saved === before);
  const unavailable = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert(!loadGame(unavailable).ok); assert(!saveGame(createGame(), unavailable).ok);
});

test('容量内的万支部队存档可往返，超出容量时保留已有存档', () => {
  const s = createGame(), unit = s.units[0];
  s.units = Array.from({ length: 10001 }, (_, i) => ({ ...unit, id: 20 + i, path: [], order: null }));
  s.nextId = 20 + s.units.length;
  const source = serializeGame(s), restored = deserializeGame(source);
  assert(restored.units.length === 10001 && restored.nextId === s.nextId);
  same(restored.units[10000], s.units[10000]);
  let saved = source;
  const storage = { getItem: () => saved, setItem: (_, value) => saved = value };
  for (let i = 0; i < 10001; i++) s.units.push({ ...unit, id: s.nextId++, path: [], order: null });
  const result = saveGame(s, storage);
  assert(!result.ok && result.reason.includes('2MB'));
  assert(saved === source && loadGame(storage).state.units.length === 10001);
});

test('AI暂停/终局不动，每两模拟秒决策且相同行军目标不重置进度', () => {
  const s = createGame(), initial = JSON.stringify(s);
  for (let i = 0; i < 50; i++) { step(s); updateAI(s); } assert(JSON.stringify(s) === initial);
  s.paused = false; advance(s, 1.9); const before = JSON.stringify(s); updateAI(s); assert(JSON.stringify(s) === before);
  step(s); updateAI(s); close(s.ai.nextAt, 4);
  const moving = s.units.find(u => u.owner === 1 && u.path.length); assert(moving);
  advance(s, 0.5); const progress = moving.progress; updateAI(s); close(moving.progress, progress);
  const frozen = structuredClone(s); frozen.outcome = 'defeat'; const text = JSON.stringify(frozen); updateAI(frozen); assert(JSON.stringify(frozen) === text);
});
test('AI零军队优先征兵，预算不足不偷资源且可以恢复兵力', () => {
  const s = createGame(); s.paused = false; s.units = s.units.filter(u => u.owner === 0);
  s.factions[1].resources = { food: 0, industry: 0, science: 0, manpower: 0 };
  for (let i = 0; i < 1200; i++) { step(s); updateAI(s); }
  assert(s.units.some(u => u.owner === 1));
  assert(s.cities.filter(c => c.owner === 1).every(c => Object.values(c.buildings).every(n => n === 0)));
  assert(Object.values(s.factions[1].resources).every(n => Number.isFinite(n) && n >= 0));
});
test('长时AI收支逐次守恒、无额外战力、推进并确定性结束被动对手战役', () => {
  for (const seed of [73129, 73130]) {
    const a = createGame(seed), b = createGame(seed); a.paused = false; b.paused = false;
    let decisions = 0, captured = false;
    for (let i = 0; i < 10000 && !a.outcome; i++) {
      step(a); step(b);
      if (!a.outcome && a.time + 1e-8 >= a.ai.nextAt) {
        const resources = { ...a.factions[1].resources }, oldCities = structuredClone(a.cities);
        const oldResearch = a.factions[1].research, unitStats = a.units.map(u => [u.id, u.owner, u.type, u.tile, u.hp]);
        const cost = { food: 0, industry: 0, science: 0, manpower: 0 };
        const charge = item => { for (const [key, amount] of Object.entries(item)) cost[key] += amount; };
        updateAI(a); decisions++;
        for (const city of a.cities) {
          const old = oldCities.find(c => c.id === city.id);
          if (!old) charge(FOUND_COST);
          else {
            assert(city.owner === old.owner && city.hp === old.hp); same(city.buildings, old.buildings);
            if (!old.production && city.production) charge((BUILDINGS[city.production.item] || UNITS[city.production.item]).cost);
          }
        }
        if (!oldResearch && a.factions[1].research) charge(TECHS[a.factions[1].research.tech].cost);
        for (const key of Object.keys(cost)) close(a.factions[1].resources[key], resources[key] - cost[key]);
        same(a.units.map(u => [u.id, u.owner, u.type, u.tile, u.hp]), unitStats);
        deserializeGame(serializeGame(a));
      } else updateAI(a);
      updateAI(b);
      if (i % 100 === 0) same(a, b);
      captured ||= a.cities.filter(c => c.owner === 1).length > 2;
      for (const faction of a.factions) assert(Object.values(faction.resources).every(n => Number.isFinite(n) && n >= 0));
    }
    same(a, b); assert(decisions > 20 && captured && a.outcome === 'defeat');
  }
});
test('含AI对局在1/2/4倍分组和存读档继续后保持确定性', () => {
  const runs = [1, 2, 4].map(speed => {
    let s = createGame(); s.paused = false;
    for (let i = 0; i < 1200 / speed; i++) for (let j = 0; j < speed; j++) {
      step(s); updateAI(s);
      if (s.tick === 501) { s = deserializeGame(serializeGame(s)); s.paused = false; }
    }
    return s;
  }); same(runs[0], runs[1]); same(runs[1], runs[2]);
});

export async function runTests() {
  const results = [], start = performance.now();
  for (const t of tests) { try { await t.run(); results.push({ name: t.name, pass: true }); } catch (error) { results.push({ name: t.name, pass: false, error: error.stack }); } }
  window.testResults = { results, passed: results.filter(r => r.pass).length, total: results.length, milliseconds: performance.now() - start };
  document.getElementById('summary').textContent = `${window.testResults.passed} / ${results.length} 通过 · ${Math.round(window.testResults.milliseconds)} ms`;
  const root = document.getElementById('results'); root.replaceChildren();
  for (const r of results) { const row = document.createElement('div'); row.className = `result ${r.pass ? 'pass' : 'fail'}`; row.textContent = `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`; root.append(row); }
  document.getElementById('details').textContent = results.filter(r => !r.pass).map(r => r.error).join('\n\n');
  return window.testResults;
}
document.getElementById('run').onclick = runTests;
runTests();
