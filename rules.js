import { VERSION, STEP, START_RESOURCES, RESOURCES, FACTIONS, UNITS, BUILDINGS, TECHS, TERRAIN, ENGINEERING, FOUND_COST, COMBAT_INTERVAL, CITY_INCOME } from './config.js';
import { createWorld, neighbors, distance, findPath, computeSupply, isWalkable, movementCost } from './world.js';

const supplyCache = new WeakMap();
const success = (extra = {}) => ({ ok: true, reason: '', ...extra });
const failure = reason => ({ ok: false, reason });
const itemConfig = item => Object.hasOwn(BUILDINGS, item) ? BUILDINGS[item] : Object.hasOwn(UNITS, item) ? UNITS[item] : null;

export function randomSeed() {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0];
}

export function createGame(seed = randomSeed(), playerFaction = 0) {
  if (![0, 1].includes(playerFaction)) throw new Error('未知阵营。');
  const world = createWorld(seed);
  const state = {
    version: VERSION, seed, width: world.width, height: world.height, tiles: world.tiles,
    time: 0, tick: 0, paused: true, speed: 1, outcome: null, nextId: 20, playerFaction,
    factions: [0, 1].map(id => ({ id, resources: { ...START_RESOURCES }, techs: [], research: null })),
    cities: world.citySites.map((site, index) => ({ ...site, id: index + 1, hp: site.owner === -1 ? 0 : 300, maxHp: 300, buildings: { farm: 0, factory: 0, lab: 0 }, production: null, cooldown: 0 })),
    units: [], events: [{ time: 0, text: `你指挥${FACTIONS[playerFaction].name}，北境战役开始。`, kind: 'info' }], effects: [],
    ai: { nextAt: 2, targets: {}, lastPositions: {} }, territoryVersion: 0, infrastructureVersion: 0,
  };
  for (const owner of [0, 1]) {
    const city = state.cities.find(c => c.capitalOf === owner);
    const land = neighbors(state, city.tile).filter(id => TERRAIN[state.tiles[id].terrain].walkable);
    ['infantry', 'infantry', 'artillery'].forEach((type, i) => spawnUnit(state, owner, type, land[i] ?? city.tile));
  }
  return state;
}

function spawnUnit(state, owner, type, tile) {
  const unit = { id: state.nextId++, owner, type, tile, hp: UNITS[type].hp, path: [], order: null, progress: 0, cooldown: 0, replanAt: 0, status: '待命', work: null };
  state.units.push(unit);
  return unit;
}

export function addEvent(state, text, kind = 'info') {
  state.events.push({ time: state.time, text, kind });
  if (state.events.length > 100) state.events.shift();
}

export function getSupply(state, owner) {
  const signature = `${state.territoryVersion}:${state.infrastructureVersion}:${state.factions.map(f => f.techs.join(',')).join('|')}`;
  let entry = supplyCache.get(state);
  if (!entry || entry.signature !== signature) {
    entry = { signature, sets: [computeSupply(state, 0), computeSupply(state, 1)] };
    supplyCache.set(state, entry);
  }
  return entry.sets[owner];
}

export function income(state, owner) {
  const result = { food: 0, industry: 0, science: 0, manpower: 0 };
  for (const c of state.cities) if (c.owner === owner) {
    result.food += CITY_INCOME.food + c.buildings.farm * BUILDINGS.farm.output;
    result.industry += CITY_INCOME.industry + c.buildings.factory * BUILDINGS.factory.output;
    result.science += CITY_INCOME.science + c.buildings.lab * BUILDINGS.lab.output;
    result.manpower += CITY_INCOME.manpower;
  }
  const techs = state.factions[owner].techs;
  if (techs.includes('agriculture')) result.food *= 1.3;
  if (techs.includes('irrigation')) result.food *= 1.2;
  if (techs.includes('industry')) result.industry *= 1.25;
  if (techs.includes('steel')) result.industry *= 1.2;
  if (techs.includes('chemistry')) result.science *= 1.25;
  if (techs.includes('hydraulics')) result.food *= 1.15;
  if (techs.includes('automation')) result.industry *= 1.15;
  return result;
}

function affordable(faction, cost) {
  const missing = Object.entries(cost).filter(([key, amount]) => faction.resources[key] + 1e-8 < amount);
  return missing.length ? failure(`资源不足：${missing.map(([key, amount]) => `${RESOURCES[key]}还需 ${Math.ceil(amount - faction.resources[key])}`).join('、')}`) : success();
}

function pay(faction, cost, ratio = 1) {
  for (const [key, value] of Object.entries(cost)) faction.resources[key] = Math.max(0, faction.resources[key] - value * ratio);
}

function hostileAt(state, owner, tile) {
  return state.units.find(u => u.owner !== owner && u.hp > 0 && u.tile === tile)
    ?? state.cities.find(c => c.owner >= 0 && c.owner !== owner && c.hp > 0 && c.tile === tile);
}

function route(state, unit, tile) {
  const hostile = hostileAt(state, unit.owner, tile);
  const range = hostile ? UNITS[unit.type].range : 0;
  if (distance(state, unit.tile, tile) <= range) return [];
  const direct = findPath(state, unit.tile, tile, { owner: unit.owner, allowGoalOccupied: Boolean(hostile) });
  if (direct !== null) {
    if (range) while (direct.length && distance(state, direct.at(-1), tile) < range) direct.pop();
    return direct;
  }
  if (!range) return null;
  let best = null, bestCost = Infinity;
  for (const candidate of state.tiles) {
    if (!TERRAIN[candidate.terrain].walkable || distance(state, candidate.id, tile) > range || hostileAt(state, unit.owner, candidate.id)) continue;
    const path = findPath(state, unit.tile, candidate.id, { owner: unit.owner });
    if (path === null) continue;
    const cost = path.reduce((sum, id) => sum + movementCost(state, id), 0);
    if (cost < bestCost) { best = path; bestCost = cost; }
  }
  return best;
}

function engineeringSpec(state, unit, action, target) {
  if (action === 'destroy') {
    if (!target.road || target.road.owner === unit.owner) return failure('只能拆除敌方建设的公路或桥梁。');
    if (target.road.kind === 'bridge' && state.units.some(other => other.hp > 0 && other.tile === target.id)) return failure('桥梁上有部队，暂时无法拆除。');
    return success({ duration: ENGINEERING.destroy.duration, reward: ENGINEERING.destroy.reward });
  }
  if (action !== 'build') return failure('未知工程指令。');
  if (target.road) return failure(target.road.owner === unit.owner ? '该地块已有己方道路。' : '请先拆除敌方道路，再进行建设。');
  if (state.cities.some(city => city.tile === target.id)) return failure('城市地块不能作为工程施工区域。');
  if (hostileAt(state, unit.owner, target.id)) return failure('施工区域有敌军，请先清除威胁。');
  if (state.units.some(other => other.owner === unit.owner && other.type === 'engineer' && other.id !== unit.id && other.work?.tile === target.id)) return failure('已有其他工兵在该地块作业。');
  const spec = ENGINEERING[target.terrain];
  if (!spec) return failure(target.terrain === 'mountain' ? '山地过于陡峭；可选择丘陵进行夷平。' : '该地形无法施工。');
  return success({ duration: spec.duration, reward: spec.reward });
}

function engineeringApproach(state, unit, target) {
  if (distance(state, unit.tile, target.id) <= 1) return unit.tile;
  if (isWalkable(target)) return target.id;
  return neighbors(state, target.id).find(id => isWalkable(state.tiles[id]) && !hostileAt(state, unit.owner, id));
}

export function validateCommand(state, owner, command) {
  if (state.outcome) return failure('对局已结束，请开始新战役。');
  if (![0, 1].includes(owner) || !command || typeof command !== 'object') return failure('无效指令。');
  const faction = state.factions[owner];
  if (command.type === 'produce' || command.type === 'cancel') {
    const city = state.cities.find(c => c.id === command.cityId);
    if (!city || city.owner !== owner) return failure('只能操作己方城市。');
    if (command.type === 'cancel') return city.production ? success() : failure('生产槽为空。');
    const config = itemConfig(command.item);
    if (!config) return failure('未知生产项目。');
    if (city.production) return failure('生产槽已占用，请等待完成或取消。');
    if (config.requires && !faction.techs.includes(config.requires)) return failure(`需要科技：${TECHS[config.requires].name}`);
    if (Object.hasOwn(BUILDINGS, command.item) && city.buildings[command.item] >= config.max) return failure('建筑已达到最高等级。');
    return affordable(faction, config.cost);
  }
  if (command.type === 'research') {
    const tech = Object.hasOwn(TECHS, command.tech) && TECHS[command.tech];
    if (!tech) return failure('未知科技。');
    if (faction.techs.includes(command.tech)) return failure('科技已完成。');
    if (faction.research) return failure('研究槽已占用。');
    if (tech.requires && !faction.techs.includes(tech.requires)) return failure(`前置科技：${TECHS[tech.requires].name}`);
    return affordable(faction, tech.cost);
  }
  if (command.type === 'engineer') {
    const unit = state.units.find(u => u.id === command.unitId);
    if (!unit || unit.owner !== owner || unit.hp <= 0 || unit.type !== 'engineer') return failure('请选择己方工兵。');
    if (!['build', 'destroy'].includes(command.action)) return failure('未知工程指令。');
    if (!Number.isInteger(command.tile) || !state.tiles[command.tile]) return failure('施工目标超出地图。');
    const target = state.tiles[command.tile];
    const spec = engineeringSpec(state, unit, command.action, target);
    if (!spec.ok) return spec;
    const approach = engineeringApproach(state, unit, target);
    if (approach === undefined) return failure('工兵无法抵达施工区域。');
    if (approach === unit.tile) return success({ path: [], duration: spec.duration });
    const path = route(state, unit, approach);
    return path === null ? failure('通往施工区域的道路被阻断。') : success({ path, duration: spec.duration });
  }
  if (['order', 'hold', 'found'].includes(command.type)) {
    const unit = state.units.find(u => u.id === command.unitId);
    if (!unit || unit.owner !== owner || unit.hp <= 0) return failure('请选择己方部队。');
    if (command.type === 'hold') return success();
    if (command.type === 'found') {
      const tile = state.tiles[unit.tile];
      if (tile.terrain !== 'plain' || tile.owner !== owner) return failure('只能在己方平原上建立城市。');
      if (!getSupply(state, owner).has(tile.id)) return failure('该平原没有补给。');
      if (state.cities.some(c => distance(state, c.tile, tile.id) < 4)) return failure('新城须距所有城市至少四格。');
      if (unit.path.length || unit.progress > 0 || unit.work) return failure('请先让部队停止并驻留。');
      return affordable(faction, FOUND_COST);
    }
    if (!Number.isInteger(command.tile) || !state.tiles[command.tile]) return failure('目标超出地图。');
    if (!isWalkable(state.tiles[command.tile])) return failure('水域和山地不可通行；河流需先由工兵架桥。');
    const city = state.cities.find(c => c.tile === command.tile);
    if (city && city.owner !== owner && city.hp <= 0 && !UNITS[unit.type].canCapture) return failure('炮兵不能占领城市，请派遣步兵或装甲。');
    const path = route(state, unit, command.tile);
    return path === null ? failure('无法到达目标或射程位置；敌军、水域或山地阻断路线。') : success({ path });
  }
  return failure('未知指令。');
}

export function applyCommand(state, owner, command) {
  const result = validateCommand(state, owner, command);
  if (!result.ok) return result;
  const faction = state.factions[owner];
  if (command.type === 'produce') {
    const city = state.cities.find(c => c.id === command.cityId), config = itemConfig(command.item);
    pay(faction, config.cost);
    city.production = { item: command.item, remaining: config.duration, duration: config.duration };
  } else if (command.type === 'cancel') {
    const city = state.cities.find(c => c.id === command.cityId);
    pay(faction, itemConfig(city.production.item).cost, -0.5);
    city.production = null;
  } else if (command.type === 'research') {
    const config = TECHS[command.tech];
    pay(faction, config.cost);
    faction.research = { tech: command.tech, remaining: config.duration, duration: config.duration };
  } else {
    const unit = state.units.find(u => u.id === command.unitId);
    if (command.type === 'order') {
      const target = state.units.find(u => u.owner !== owner && u.tile === command.tile);
      unit.order = { tile: command.tile, kind: hostileAt(state, owner, command.tile) ? 'attack' : 'move', targetId: target?.id ?? null };
      unit.path = result.path;
      unit.progress = 0;
      unit.work = null;
      unit.replanAt = state.time + 1;
      unit.status = unit.order.kind === 'attack' ? '进攻目标' : '行军';
    } else if (command.type === 'hold') {
      unit.order = null; unit.path = []; unit.progress = 0; unit.work = null; unit.status = '驻守';
    } else if (command.type === 'engineer') {
      const target = state.tiles[command.tile];
      const approach = engineeringApproach(state, unit, target);
      unit.work = { tile: target.id, action: command.action, remaining: result.duration, duration: result.duration };
      unit.path = result.path; unit.progress = 0;
      unit.order = approach === unit.tile ? null : { tile: approach, kind: 'move', targetId: null };
      unit.replanAt = state.time + 1;
      unit.status = approach === unit.tile ? '工程作业' : '前往作业区';
    } else if (command.type === 'found') {
      pay(faction, FOUND_COST);
      const city = { id: state.nextId++, name: `${owner === 0 ? '岚' : '铁'}境新城 ${state.cities.length + 1}`, owner, tile: unit.tile, capitalOf: null, kind: 'city', hp: 300, maxHp: 300, buildings: { farm: 0, factory: 0, lab: 0 }, production: null, cooldown: 0 };
      state.cities.push(city); state.territoryVersion++;
      addEvent(state, `${city.name}建立，新的补给枢纽投入运作。`, owner === state.playerFaction ? 'success' : 'info');
    }
  }
  return success();
}

function advanceEconomy(state) {
  for (const faction of state.factions) {
    const rate = income(state, faction.id);
    for (const key of Object.keys(RESOURCES)) faction.resources[key] += rate[key] * STEP;
    const research = faction.research;
    if (research) {
      research.remaining = Math.max(0, research.remaining - STEP);
      if (research.remaining < 1e-8) {
        faction.techs.push(research.tech); faction.research = null;
        addEvent(state, `${FACTIONS[faction.id].name}完成研究：${TECHS[research.tech].name}。`, faction.id === state.playerFaction ? 'success' : 'info');
      }
    }
  }
  for (const city of state.cities) if (city.production) {
    const production = city.production;
    production.remaining = Math.max(0, production.remaining - STEP * (state.factions[city.owner].techs.includes('massProduction') ? 1.25 : 1));
    if (production.remaining < 1e-8) {
      production.remaining = 0;
      if (Object.hasOwn(BUILDINGS, production.item)) city.buildings[production.item]++;
      else {
        if (state.units.some(u => u.owner !== city.owner && u.hp > 0 && u.tile === city.tile)) continue;
        spawnUnit(state, city.owner, production.item, city.tile);
      }
      city.production = null;
      addEvent(state, `${city.name}完成${itemConfig(production.item).name}。`, city.owner === state.playerFaction ? 'success' : 'info');
    }
  }
}

function paveRoadOnMarch(state, unit) {
  const tile = state.tiles[unit.tile];
  if (tile.terrain !== 'plain' || tile.road || state.cities.some(city => city.tile === tile.id)
    || hostileAt(state, unit.owner, tile.id)
    || state.units.some(other => other.id !== unit.id && other.work?.tile === tile.id)) return;
  finishEngineering(state, unit, { tile: tile.id, action: 'autoRoad', remaining: 0, duration: ENGINEERING.plain.duration }, tile);
}

function advanceMovement(state) {
  const proposals = [];
  for (const unit of state.units) {
    if (!unit.order) continue;
    const order = unit.order;
    let targetMoved = false;
    if (order.targetId !== null) {
      const target = state.units.find(u => u.id === order.targetId);
      if (target) { targetMoved = order.tile !== target.tile; order.tile = target.tile; }
      else order.targetId = null;
    }
    const hostile = hostileAt(state, unit.owner, order.tile);
    if (hostile && distance(state, unit.tile, order.tile) <= UNITS[unit.type].range) {
      unit.path = []; unit.progress = 0; unit.status = '交战'; continue;
    }
    if (!hostile && unit.tile === order.tile) {
      unit.order = null; unit.path = []; unit.progress = 0; unit.status = '抵达'; continue;
    }
    const city = state.cities.find(c => c.tile === order.tile && c.owner !== unit.owner);
    if (!hostile && city && !UNITS[unit.type].canCapture) {
      unit.order = null; unit.path = []; unit.progress = 0; unit.status = '守备已摧毁，等待占领部队'; continue;
    }
    const blocked = unit.path.length && hostileAt(state, unit.owner, unit.path[0]);
    if (targetMoved || ((!unit.path.length || blocked) && state.time + 1e-8 >= unit.replanAt)) {
      const path = route(state, unit, order.tile);
      if (!path?.length || path[0] !== unit.path[0]) unit.progress = 0;
      unit.path = path ?? []; unit.replanAt = state.time + 2;
      unit.status = path === null ? '路线被阻断，等待通路' : '行军';
    }
    if (!unit.path.length || hostileAt(state, unit.owner, unit.path[0])) continue;
    if (unit.type === 'engineer' && !unit.work) paveRoadOnMarch(state, unit);
    const next = unit.path[0];
    const supplied = getSupply(state, unit.owner).has(unit.tile);
    const duration = UNITS[unit.type].moveTime * movementCost(state, next) / (supplied ? 1 : 0.6)
      * (state.factions[unit.owner].techs.includes('mobility') ? .85 : 1);
    unit.progress += STEP;
    if (unit.progress + 1e-8 >= duration) proposals.push({ unit, next });
  }
  const arrivals = new Map();
  for (const p of proposals) {
    if (!arrivals.has(p.next)) arrivals.set(p.next, new Set());
    arrivals.get(p.next).add(p.unit.owner);
  }
  for (const { unit, next } of proposals) {
    // Tick/tile parity breaks deadlocks without giving array order initiative.
    if (arrivals.get(next).size > 1 && unit.owner !== (state.tick + next) % 2) { unit.progress = 0; unit.status = '敌军争夺通路'; continue; }
    unit.tile = next; unit.path.shift(); unit.progress = 0;
    if (unit.type === 'engineer' && !unit.work) paveRoadOnMarch(state, unit);
    if (unit.tile === unit.order.tile && !hostileAt(state, unit.owner, unit.tile)) {
      unit.order = null; unit.status = '抵达';
    }
  }
}

export function getCombatTarget(state, unit) {
  const range = UNITS[unit.type].range;
  const enemies = state.units.filter(other => other.owner !== unit.owner && distance(state, unit.tile, other.tile) <= range);
  enemies.sort((a, b) => Number(b.id === unit.order?.targetId) - Number(a.id === unit.order?.targetId) || distance(state, unit.tile, a.tile) - distance(state, unit.tile, b.tile) || a.id - b.id);
  return enemies[0] || state.cities.filter(c => c.owner >= 0 && c.owner !== unit.owner && c.hp > 0 && distance(state, unit.tile, c.tile) <= range)
    .sort((a, b) => Number(b.tile === unit.order?.tile) - Number(a.tile === unit.order?.tile) || a.id - b.id)[0] || null;
}

function combat(state) {
  const unitDamage = new Map(), cityDamage = new Map();
  const addDamage = (map, target, amount) => map.set(target.id, (map.get(target.id) ?? 0) + amount);
  const effect = (from, to, type) => state.effects.push({ time: state.time, from, to, type });
  for (const unit of state.units) {
    unit.cooldown = Math.max(0, unit.cooldown - STEP);
    if (unit.cooldown > 1e-8) continue;
    const spec = UNITS[unit.type];
    if (spec.damage <= 0 || spec.range <= 0) continue;
    const target = getCombatTarget(state, unit);
    if (!target) continue;
    const isUnit = Object.hasOwn(target, 'type');
    let damage = spec.damage * (getSupply(state, unit.owner).has(unit.tile) ? 1 : 0.6);
    const techs = state.factions[unit.owner].techs;
    if (techs.includes('radio')) damage *= 1.1;
    if (techs.includes('combined') && unit.type !== 'artillery') damage *= 1.15;
    if (techs.includes('ballistics') && unit.type === 'artillery') damage *= 1.2;
    if (techs.includes('jointOperations')) damage *= 1.1;
    if (isUnit) damage *= 1 - TERRAIN[state.tiles[target.tile].terrain].defense;
    addDamage(isUnit ? unitDamage : cityDamage, target, damage);
    effect(unit.tile, target.tile, unit.type);
    unit.cooldown = COMBAT_INTERVAL;
  }
  for (const city of state.cities) {
    city.cooldown = Math.max(0, city.cooldown - STEP);
    if (city.owner < 0 || city.hp <= 0 || city.cooldown > 1e-8) continue;
    const enemy = state.units.filter(u => u.owner !== city.owner && distance(state, city.tile, u.tile) <= 1).sort((a, b) => a.id - b.id)[0];
    if (enemy) {
      addDamage(unitDamage, enemy, 10 * (1 - TERRAIN[state.tiles[enemy.tile].terrain].defense));
      effect(city.tile, enemy.tile, 'garrison'); city.cooldown = COMBAT_INTERVAL;
    }
  }
  for (const u of state.units) u.hp = Math.max(0, u.hp - (unitDamage.get(u.id) ?? 0));
  for (const c of state.cities) {
    const previous = c.hp; c.hp = Math.max(0, c.hp - (cityDamage.get(c.id) ?? 0));
    if (previous > 0 && c.hp === 0) addEvent(state, `${c.name}守备被击破，步兵、装甲或工兵可进驻占领。`, c.owner === state.playerFaction ? 'danger' : 'info');
  }
  for (const u of state.units) if (u.hp <= 0) addEvent(state, `${FACTIONS[u.owner].name}${UNITS[u.type].name} #${u.id} 被歼灭。`, u.owner === state.playerFaction ? 'danger' : 'info');
  state.units = state.units.filter(u => u.hp > 0);
}

function engineeringDescription(tile, action) {
  if (action === 'destroy') return '拆除敌方道路';
  if (action === 'autoRoad') return '自动铺路';
  return { plain: '铺设公路', forest: '清理森林', hill: '夷平丘陵', water: '架设桥梁' }[tile.terrain] || '工程施工';
}

function finishEngineering(state, unit, work, tile) {
  const owner = unit.owner;
  if (work.action === 'destroy') {
    if (!tile.road || tile.road.owner === owner) return false;
    if (tile.road.kind === 'bridge' && state.units.some(other => other.hp > 0 && other.tile === tile.id)) return false;
    tile.road = null;
    addEvent(state, `${FACTIONS[owner].name}工兵 #${unit.id} 拆除了地块 ${tile.id} 的${tile.terrain === 'water' ? '桥梁' : '公路'}。`, owner === state.playerFaction ? 'success' : 'info');
  } else {
    if (tile.road || state.cities.some(city => city.tile === tile.id)) return false;
    const spec = ENGINEERING[tile.terrain];
    if (!spec) return false;
    const description = engineeringDescription(tile, work.action);
    if (tile.terrain === 'forest') tile.terrain = 'plain';
    else if (tile.terrain === 'hill') { tile.terrain = 'plain'; tile.road = { owner, kind: 'road' }; }
    else if (tile.terrain === 'water') tile.road = { owner, kind: 'bridge' };
    else if (tile.terrain === 'plain') tile.road = { owner, kind: 'road' };
    for (const [key, amount] of Object.entries(spec.reward)) state.factions[owner].resources[key] += amount;
    const reward = Object.entries(spec.reward).map(([key, amount]) => `${RESOURCES[key]} +${amount}`).join('、');
    addEvent(state, `${FACTIONS[owner].name}工兵 #${unit.id} 完成地块 ${tile.id} 的${description}${reward ? `，获得${reward}` : ''}。`, owner === state.playerFaction ? 'success' : 'info');
  }
  state.infrastructureVersion++;
  return true;
}

function advanceEngineering(state) {
  for (const unit of state.units) {
    if (unit.type !== 'engineer' || unit.hp <= 0) continue;
    const work = unit.work;
    if (!work) continue;
    const target = state.tiles[work.tile];
    if (!target) { unit.work = null; unit.status = '作业取消'; continue; }
    if (distance(state, unit.tile, work.tile) > 1) {
      unit.status = unit.order ? '前往作业区' : '无法抵达作业区';
      continue;
    }
    unit.order = null; unit.path = []; unit.progress = 0;
    if (work.action !== 'destroy' && hostileAt(state, unit.owner, work.tile)) {
      unit.status = '作业区受威胁';
      continue;
    }
    unit.status = engineeringDescription(target, work.action);
    work.remaining = Math.max(0, work.remaining - STEP);
    if (work.remaining >= 1e-8) continue;
    if (finishEngineering(state, unit, work, target)) unit.status = '作业完成';
    else { unit.status = '作业目标已变化'; addEvent(state, `工兵 #${unit.id} 的作业目标已变化，工程取消。`, 'info'); }
    unit.work = null;
  }
}

function capture(state) {
  for (const unit of state.units) {
    if (!UNITS[unit.type].canCapture) continue;
    if (state.units.some(other => other.owner !== unit.owner && other.tile === unit.tile)) continue;
    const tile = state.tiles[unit.tile], city = state.cities.find(c => c.tile === unit.tile);
    if (city && city.owner !== unit.owner) {
      if (city.hp > 0) continue;
      const previous = city.owner;
      city.owner = unit.owner; city.hp = city.maxHp * 0.6; city.cooldown = COMBAT_INTERVAL; city.production = null;
      state.territoryVersion++;
      addEvent(state, `${FACTIONS[unit.owner].name}占领${city.name}${previous < 0 ? '，中立城市加入战役' : ''}。`, unit.owner === state.playerFaction ? 'success' : 'danger');
    }
    if (tile.owner !== unit.owner) { tile.owner = unit.owner; state.territoryVersion++; }
  }
  const fallen = [0, 1].map(owner => state.cities.find(c => c.capitalOf === owner).owner !== owner);
  const player = state.playerFaction, enemy = 1 - player;
  if (fallen[player] || fallen[enemy]) {
    state.outcome = fallen[player] && fallen[enemy] ? 'draw' : fallen[enemy] ? 'victory' : 'defeat';
    state.paused = true;
    addEvent(state, state.outcome === 'draw' ? '双方首都同时失守，战役以平局结束。' : state.outcome === 'victory' ? `${FACTIONS[enemy].name}首都升起${FACTIONS[player].name}旗帜，北境战役胜利！` : `${FACTIONS[player].name}首都失守，北境战役结束。`, state.outcome === 'victory' ? 'success' : 'danger');
  }
}

export function step(state) {
  if (state.paused || state.outcome) return;
  state.tick++; state.time = state.tick * STEP;
  advanceEconomy(state);
  advanceMovement(state);
  advanceEngineering(state);
  combat(state);
  capture(state);
  state.effects = state.effects.filter(effect => state.time - effect.time < 0.7).slice(-120);
}
