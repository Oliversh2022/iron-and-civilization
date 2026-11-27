import { VERSION, WIDTH, HEIGHT, STEP, RESOURCES, TERRAIN, BUILDINGS, UNITS, TECHS, ENGINEERING, COMBAT_INTERVAL } from './config.js';
import { neighbors, isWalkable, movementCost } from './world.js';

export const SAVE_KEY = 'iron-civilization.v1';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = MAX_BYTES;
const EPSILON = 1e-8;
const TILE_COUNT = WIDTH * HEIGHT;
const CAPITALS = [{ id: 1, tile: 9 * WIDTH + 4 }, { id: 3, tile: 8 * WIDTH + 21 }];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

class InvalidSaveError extends Error {}

function requireValid(condition, message) {
  if (!condition) throw new InvalidSaveError(`存档无效：${message}。`);
}

function number(value, label, min = 0, max = Number.MAX_VALUE) {
  requireValid(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    `${label}必须是 ${min} 至 ${max} 范围内的有限数值`);
}

function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireValid(Number.isSafeInteger(value) && value >= min && value <= max, `${label}不是合法整数`);
}

function text(value, label, max = 128) {
  requireValid(typeof value === 'string' && value.length > 0 && value.length <= max, `${label}文本为空、类型错误或过长`);
}

function choice(value, choices, label) {
  requireValid(choices.includes(value), `${label}不受支持`);
}

function record(value, keys, label) {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}必须是对象`);
  const actual = Object.keys(value);
  requireValid(actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label}字段缺失或含未知字段`);
}

function list(value, label, max, min = 0) {
  requireValid(Array.isArray(value) && value.length >= min && value.length <= max, `${label}数量或类型不合法`);
}

// Reject accessors and custom prototypes before copying untrusted save data.
function copyData(source) {
  let count = 0;
  const active = new WeakSet();
  function copy(value, depth) {
    requireValid(++count <= MAX_BYTES && depth <= 12, '数据过多或嵌套过深');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      requireValid(Number.isFinite(value), '包含非有限数值');
      return value;
    }
    if (typeof value === 'string') {
      requireValid(value.length <= 2048, '文本字段过长');
      return value;
    }
    requireValid(typeof value === 'object', '包含不能保存的数据类型');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    requireValid(array ? proto === Array.prototype : proto === Object.prototype || proto === null, '包含不安全的对象原型');
    requireValid(!active.has(value), '包含循环引用');
    const keys = Reflect.ownKeys(value);
    requireValid(keys.length <= MAX_ITEMS + 1, '对象字段或数组数量过多');
    const result = array ? [] : {};
    if (array) {
      requireValid(value.length <= MAX_ITEMS && keys.length === value.length + 1, '数组稀疏或含额外字段');
    }
    active.add(value);
    for (const key of keys) {
      requireValid(typeof key === 'string' && key.length <= 128 && !FORBIDDEN_KEYS.has(key), '包含不安全的属性名');
      if (array && key === 'length') continue;
      if (array) requireValid(/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length, '数组含非法索引');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireValid(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, '包含访问器或隐藏字段');
      result[key] = copy(descriptor.value, depth + 1);
    }
    active.delete(value);
    return result;
  }
  return copy(source, 0);
}

function checkTextSize(value) {
  requireValid(typeof value === 'string', '存档内容必须是 JSON 文本');
  requireValid(value.length <= MAX_BYTES && new TextEncoder().encode(value).length <= MAX_BYTES, '存档大小不能超过 2MB');
}

function validate(state) {
  record(state, ['version', 'seed', 'width', 'height', 'tiles', 'time', 'tick', 'paused', 'speed', 'outcome', 'nextId', 'playerFaction',
    'factions', 'cities', 'units', 'events', 'effects', 'ai', 'territoryVersion', 'infrastructureVersion'], '对局');
  requireValid(state.version === VERSION, '存档版本不兼容');
  number(state.seed, '地图种子', -Number.MAX_VALUE);
  requireValid(state.width === WIDTH && state.height === HEIGHT, '地图必须为 26×18');
  choice(state.playerFaction, [0, 1], '玩家阵营');
  integer(state.tick, '模拟步数');
  number(state.time, '模拟时间');
  const expectedTime = state.tick * STEP;
  requireValid(Math.abs(state.time - expectedTime) <= Math.max(EPSILON, expectedTime * Number.EPSILON * 4), '模拟时间与步数不一致');
  requireValid(typeof state.paused === 'boolean', '暂停标记必须为布尔值');
  choice(state.speed, [1, 2, 4], '游戏速度');
  choice(state.outcome, [null, 'victory', 'defeat', 'draw'], '战役结果');
  requireValid(state.outcome === null || state.paused, '已结束的战役必须暂停');
  integer(state.nextId, '下一个实体编号', 1);
  integer(state.territoryVersion, '领土版本');
  integer(state.infrastructureVersion, '基础设施版本');

  list(state.tiles, '地块', TILE_COUNT, TILE_COUNT);
  for (let id = 0; id < TILE_COUNT; id++) {
    const tile = state.tiles[id], row = Math.floor(id / WIDTH);
    record(tile, ['id', 'q', 'r', 'terrain', 'owner', 'road'], `地块 ${id}`);
    requireValid(tile.id === id && tile.r === row && tile.q === id % WIDTH - Math.floor(row / 2), `地块 ${id} 编号或六边形坐标错误`);
    choice(tile.terrain, Object.keys(TERRAIN), `地块 ${id} 地形`);
    choice(tile.owner, [-1, 0, 1], `地块 ${id} 归属`);
    if (tile.road !== null) {
      record(tile.road, ['owner', 'kind'], `地块 ${id} 道路`);
      choice(tile.road.owner, [0, 1], `地块 ${id} 道路归属`);
      choice(tile.road.kind, ['road', 'bridge'], `地块 ${id} 道路类型`);
      requireValid(tile.road.kind === 'bridge' ? tile.terrain === 'water' : tile.terrain === 'plain', `地块 ${id} 道路与地形不符`);
    }
  }
  function tileId(id, label, walkable = false) {
    integer(id, label, 0, TILE_COUNT - 1);
    if (walkable) requireValid(isWalkable(state.tiles[id]), `${label}必须位于可通行地形`);
  }
  function allocatedId(id, label) {
    integer(id, label, 1, state.nextId - 1);
  }
  function slot(value, field, specs, label) {
    record(value, [field, 'remaining', 'duration'], label);
    choice(value[field], Object.keys(specs), `${label}项目`);
    const spec = specs[value[field]];
    requireValid(value.duration === spec.duration, `${label}总时长与规则不符`);
    number(value.remaining, `${label}剩余时间`, 0, value.duration);
    return spec;
  }

  list(state.factions, '阵营', 2, 2);
  for (let id = 0; id < 2; id++) {
    const faction = state.factions[id];
    record(faction, ['id', 'resources', 'techs', 'research'], `阵营 ${id}`);
    requireValid(faction.id === id, '阵营编号或顺序错误');
    record(faction.resources, Object.keys(RESOURCES), `阵营 ${id} 资源`);
    for (const key of Object.keys(RESOURCES)) number(faction.resources[key], `${RESOURCES[key]}库存`);
    list(faction.techs, '已完成科技', Object.keys(TECHS).length);
    requireValid(new Set(faction.techs).size === faction.techs.length, '已完成科技重复');
    for (const tech of faction.techs) choice(tech, Object.keys(TECHS), '科技');
    for (const tech of faction.techs) requireValid(!TECHS[tech].requires || faction.techs.includes(TECHS[tech].requires), '已完成科技缺少前置科技');
    if (faction.research !== null) {
      const spec = slot(faction.research, 'tech', TECHS, '研究槽');
      requireValid(!faction.techs.includes(faction.research.tech), '不能重复研究已完成科技');
      requireValid(!spec.requires || faction.techs.includes(spec.requires), '研究缺少前置科技');
    }
  }

  const ids = new Set(), cityTiles = new Set(), capitals = [null, null];
  function entityId(id) {
    allocatedId(id, '实体编号');
    requireValid(!ids.has(id), '城市与部队的实体编号必须唯一');
    ids.add(id);
  }
  list(state.cities, '城市', TILE_COUNT, 2);
  for (const city of state.cities) {
    record(city, ['tile', 'name', 'owner', 'capitalOf', 'kind', 'id', 'hp', 'maxHp', 'buildings', 'production', 'cooldown'], '城市');
    entityId(city.id);
    text(city.name, '城市名称');
    tileId(city.tile, '城市位置', true);
    requireValid(!cityTiles.has(city.tile), '城市位置重复');
    cityTiles.add(city.tile);
    requireValid(state.tiles[city.tile].terrain === 'plain', '城市必须位于平原');
    choice(city.owner, [-1, 0, 1], '城市归属');
    requireValid(state.tiles[city.tile].owner === city.owner, '城市与所在领土归属不一致');
    choice(city.capitalOf, [null, 0, 1], '原始首都归属');
    choice(city.kind, ['capital', 'city', 'fortress'], '城市类型');
    requireValid(city.capitalOf === null || city.kind === 'capital', '首都城市类型不符');
    requireValid(city.kind !== 'capital' || city.capitalOf !== null, '普通城市不能标记为首都');
    if (city.capitalOf !== null) {
      const original = CAPITALS[city.capitalOf];
      requireValid(capitals[city.capitalOf] === null, '每个阵营只能有一座原始首都');
      requireValid(city.id === original.id && city.tile === original.tile && city.owner !== -1, '原始首都编号、位置或归属错误');
      capitals[city.capitalOf] = city;
    }
    requireValid(city.maxHp === 300, '城市最大生命值与规则不符');
    number(city.hp, '城市生命值', 0, city.maxHp);
    number(city.cooldown, '城市攻击冷却', 0, COMBAT_INTERVAL);
    requireValid(city.owner !== -1 || (city.hp === 0 && city.production === null), '中立城市不能有守备生命或生产任务');
    record(city.buildings, Object.keys(BUILDINGS), '城市建筑');
    for (const key of Object.keys(BUILDINGS)) integer(city.buildings[key], `${BUILDINGS[key].name}等级`, 0, BUILDINGS[key].max);
    if (city.production !== null) {
      const spec = slot(city.production, 'item', { ...BUILDINGS, ...UNITS }, '生产槽');
      requireValid(city.owner >= 0, '中立城市不能生产');
      requireValid(!spec.requires || state.factions[city.owner].techs.includes(spec.requires), '生产缺少前置科技');
      const item = city.production.item;
      if (Object.hasOwn(BUILDINGS, item)) requireValid(city.buildings[item] < spec.max, '生产中的建筑已达到最高等级');
    }
  }
  requireValid(capitals.every(Boolean), '每个阵营必须保留一座原始首都');
  const fallen = capitals.map((city, owner) => city.owner !== owner);
  const player = state.playerFaction, enemy = 1 - player;
  const outcome = fallen[player] && fallen[enemy] ? 'draw' : fallen[enemy] ? 'victory' : fallen[player] ? 'defeat' : null;
  requireValid(state.outcome === outcome, '战役结果与首都占领情况不一致');

  list(state.units, '部队', MAX_ITEMS);
  for (const unit of state.units) {
    record(unit, ['id', 'owner', 'type', 'tile', 'hp', 'path', 'order', 'progress', 'cooldown', 'replanAt', 'status', 'work'], '部队');
    entityId(unit.id);
    choice(unit.owner, [0, 1], '部队归属');
    choice(unit.type, Object.keys(UNITS), '兵种');
    const spec = UNITS[unit.type];
    tileId(unit.tile, '部队位置', true);
    number(unit.hp, '部队生命值', 0, spec.hp);
    requireValid(unit.hp > 0, '已被歼灭的部队不能留在场上');
    number(unit.cooldown, '部队攻击冷却', 0, COMBAT_INTERVAL);
    number(unit.replanAt, '重新寻路时间', 0, state.time + 2 + EPSILON);
    text(unit.status, '部队状态');
    list(unit.path, '行军路径', TILE_COUNT - 1);
    let previous = unit.tile;
    const visited = new Set([previous]);
    for (const next of unit.path) {
      tileId(next, '路径地块', true);
      requireValid(neighbors(state, previous).includes(next) && !visited.has(next), '行军路径必须连续相邻且无循环');
      visited.add(next);
      previous = next;
    }
    number(unit.progress, '行军进度', 0, unit.path.length
      ? spec.moveTime * movementCost(state, unit.path[0]) / 0.6 + EPSILON : 0);
    if (unit.order === null) {
      requireValid(unit.path.length === 0 && unit.progress === 0, '无指令部队不能保留行军路径或进度');
    } else {
      record(unit.order, ['tile', 'kind', 'targetId'], '部队指令');
      tileId(unit.order.tile, '指令目标位置', true);
      choice(unit.order.kind, ['move', 'attack'], '指令类型');
      // Targets can die after movement, before the next replan/AI cleanup.
      if (unit.order.targetId !== null) allocatedId(unit.order.targetId, '指令目标编号');
    }
    if (unit.work !== null) {
      requireValid(unit.type === 'engineer', '只有工兵可以保留工程作业');
      record(unit.work, ['tile', 'action', 'remaining', 'duration'], '工程作业');
      tileId(unit.work.tile, '工程施工地块');
      choice(unit.work.action, ['build', 'destroy', 'autoRoad'], '工程类型');
      const target = state.tiles[unit.work.tile];
      const spec = unit.work.action === 'destroy' ? ENGINEERING.destroy
        : unit.work.action === 'autoRoad' ? ENGINEERING.plain : ENGINEERING[target.terrain];
      requireValid(Boolean(spec), '工程目标地形不合法');
      requireValid(unit.work.duration === spec.duration, '工程总时长与规则不符');
      number(unit.work.remaining, '工程剩余时间', 0, unit.work.duration);
      if (unit.work.action === 'destroy') requireValid(target.road && target.road.owner !== unit.owner, '拆除目标不是敌方道路');
      else requireValid(!target.road, '工程目标已有道路');
      if (unit.work.action === 'autoRoad') requireValid(target.terrain === 'plain', '自动铺路目标必须是平原');
    }
  }

  list(state.events, '战报', 100);
  let previousEventTime = 0;
  for (const event of state.events) {
    record(event, ['time', 'text', 'kind'], '战报');
    number(event.time, '战报时间', previousEventTime, state.time + EPSILON);
    previousEventTime = event.time;
    text(event.text, '战报内容', 2048);
    choice(event.kind, ['info', 'success', 'danger'], '战报类型');
  }
  list(state.effects, '战斗特效', 120);
  for (const effect of state.effects) {
    record(effect, ['time', 'from', 'to', 'type'], '战斗特效');
    number(effect.time, '特效时间', Math.max(0, state.time - 0.7 - EPSILON), state.time + EPSILON);
    tileId(effect.from, '特效起点', true);
    tileId(effect.to, '特效终点', true);
    choice(effect.type, [...Object.keys(UNITS), 'garrison'], '特效类型');
  }

  record(state.ai, ['nextAt', 'targets', 'lastPositions'], 'AI 记忆');
  number(state.ai.nextAt, 'AI 下次行动时间', 0, state.time + 2 + EPSILON);
  function memory(entries, timer, label) {
    requireValid(entries !== null && typeof entries === 'object' && !Array.isArray(entries), `${label}必须是对象`);
    for (const [key, value] of Object.entries(entries)) {
      requireValid(/^[1-9]\d*$/.test(key), `${label}部队编号错误`);
      allocatedId(Number(key), `${label}部队编号`);
      record(value, ['tile', timer], label);
      tileId(value.tile, `${label}位置`);
      number(value[timer], `${label}时间`, 0, state.time + EPSILON);
    }
  }
  memory(state.ai.targets, 'at', 'AI 目标');
  memory(state.ai.lastPositions, 'since', 'AI 历史位置');
  return state;
}

export function serializeGame(state) {
  try {
    const result = JSON.stringify(validate(copyData(state)));
    checkTextSize(result);
    return result;
  } catch (error) {
    if (error instanceof InvalidSaveError) throw error;
    throw new Error('无法序列化存档：对局数据不可读取或格式不合法。');
  }
}

export function deserializeGame(source) {
  try {
    checkTextSize(source);
    let parsed;
    try { parsed = JSON.parse(source); }
    catch { throw new InvalidSaveError('存档无效：JSON 文本损坏或格式错误。'); }
    const state = validate(copyData(parsed));
    // WeakMap-based simulation caches rebuild against this new state identity.
    state.paused = true;
    return state;
  } catch (error) {
    if (error instanceof InvalidSaveError) throw error;
    throw new Error('无法读取存档：数据格式不合法。');
  }
}

function storageFailure(action, error) {
  if (error instanceof InvalidSaveError) return { ok: false, reason: error.message };
  return { ok: false, reason: `${action}失败：本地存储不可用、访问被禁止或空间不足。` };
}

export function saveGame(state, storage) {
  try {
    // Validate before touching storage so an invalid game never replaces a save.
    const serialized = serializeGame(state);
    const target = storage === undefined ? globalThis.localStorage : storage;
    requireValid(target && typeof target.setItem === 'function', '本地存储不可用');
    target.setItem(SAVE_KEY, serialized);
    return { ok: true, reason: '' };
  } catch (error) {
    return storageFailure('保存', error);
  }
}

export function loadGame(storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    requireValid(target && typeof target.getItem === 'function', '本地存储不可用');
    const source = target.getItem(SAVE_KEY);
    if (source === null) return { ok: false, reason: '尚无存档，请先保存战役。' };
    return { ok: true, reason: '', state: deserializeGame(source) };
  } catch (error) {
    return storageFailure('读取', error);
  }
}
