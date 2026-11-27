import { WIDTH, HEIGHT, TERRAIN, ROAD_MOVEMENT_MULTIPLIER } from './config.js';

const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const isWalkable = (tile) => Boolean(tile && (tile.road?.kind === 'bridge' || TERRAIN[tile.terrain]?.walkable));

export function movementCost(state, tileId) {
  const tile = state.tiles[tileId];
  if (!tile) return Infinity;
  if (tile.road) return tile.road.kind === 'bridge' ? Math.min(1, ROAD_MOVEMENT_MULTIPLIER * 1.25) : ROAD_MOVEMENT_MULTIPLIER;
  return TERRAIN[tile.terrain].cost;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseField(random, width, height, scale) {
  const columns = Math.ceil(width / scale) + 1;
  const rows = Math.ceil(height / scale) + 1;
  const values = Float64Array.from({ length: columns * rows }, () => random());
  const smooth = (value) => value * value * (3 - 2 * value);
  const mix = (a, b, amount) => a + (b - a) * amount;
  return (x, y) => {
    const gx = x / scale;
    const gy = y / scale;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const tx = smooth(gx - ix);
    const ty = smooth(gy - iy);
    const top = iy * columns + ix;
    const bottom = top + columns;
    return mix(mix(values[top], values[top + 1], tx),
      mix(values[bottom], values[bottom + 1], tx), ty);
  };
}

export function axialDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function distance(world, start, goal) {
  const a = world.tiles[start];
  const b = world.tiles[goal];
  return a && b ? axialDistance(a, b) : Infinity;
}

export function neighbors(world, tileId) {
  const tile = world.tiles[tileId];
  if (!tile) return [];
  const result = [];
  for (const [dq, dr] of DIRECTIONS) {
    const r = tile.r + dr;
    const x = tile.q + dq + Math.floor(r / 2);
    if (r >= 0 && r < world.height && x >= 0 && x < world.width) {
      const id = r * world.width + x;
      if (world.tiles[id]) result.push(id);
    }
  }
  return result;
}

// Stable heap ordering keeps equally good routes deterministic.
class Frontier {
  constructor() {
    this.heap = [];
  }

  before(a, b) {
    return a.priority < b.priority || (a.priority === b.priority && a.id < b.id);
  }

  push(entry) {
    const heap = this.heap;
    let index = heap.length;
    heap.push(entry);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!this.before(entry, heap[parent])) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = entry;
  }

  pop() {
    const heap = this.heap;
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && this.before(heap[child + 1], heap[child])) child++;
        if (!this.before(heap[child], last)) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return first;
  }
}

function searchPath(world, starts, isGoal, stepCost, estimate = () => 0) {
  const costs = new Float64Array(world.tiles.length).fill(Infinity);
  const previous = new Int32Array(world.tiles.length).fill(-1);
  const frontier = new Frontier();
  for (const id of starts) {
    costs[id] = 0;
    frontier.push({ id, cost: 0, priority: estimate(id) });
  }
  while (frontier.heap.length) {
    const current = frontier.pop();
    if (current.cost !== costs[current.id]) continue;
    if (isGoal(current.id)) {
      const path = [];
      for (let id = current.id; previous[id] !== -1; id = previous[id]) path.push(id);
      return path.reverse();
    }
    for (const id of neighbors(world, current.id)) {
      const cost = current.cost + stepCost(id);
      if (cost >= costs[id]) continue;
      costs[id] = cost;
      previous[id] = current.id;
      frontier.push({ id, cost, priority: cost + estimate(id) });
    }
  }
  return null;
}

export function findPath(state, start, goal, options = {}) {
  if (!isWalkable(state.tiles[start]) || !isWalkable(state.tiles[goal])) return null;
  if (start === goal) return [];
  const blocked = new Set();
  if (options.owner !== undefined) {
    for (const unit of state.units ?? []) {
      if (unit.hp > 0 && unit.owner !== options.owner) blocked.add(unit.tile);
    }
    for (const city of state.cities ?? []) {
      if (city.hp > 0 && city.owner >= 0 && city.owner !== options.owner) blocked.add(city.tile);
    }
  }
  if (options.allowGoalOccupied === true) blocked.delete(goal);
  if (blocked.has(goal)) return null;
  const minimumCost = Math.min(ROAD_MOVEMENT_MULTIPLIER, ...Object.values(TERRAIN)
    .filter((terrain) => terrain.walkable).map((terrain) => terrain.cost));
  return searchPath(state, [start], (id) => id === goal,
    (id) => isWalkable(state.tiles[id]) && !blocked.has(id)
      ? movementCost(state, id) : Infinity,
    (id) => distance(state, id, goal) * minimumCost);
}

function walkableRegion(world, start) {
  const reached = new Set();
  if (!isWalkable(world.tiles[start])) return reached;
  const queue = [start];
  reached.add(start);
  for (let index = 0; index < queue.length; index++) {
    for (const id of neighbors(world, queue[index])) {
      if (!reached.has(id) && isWalkable(world.tiles[id])) {
        reached.add(id);
        queue.push(id);
      }
    }
  }
  return reached;
}

export function areCitiesConnected(world, sites = world.citySites) {
  if (!sites?.length) return true;
  const reached = walkableRegion(world, sites[0].tile);
  return sites.every((site) => reached.has(site.tile));
}

function connectCities(world) {
  let reached = walkableRegion(world, world.citySites[0].tile);
  while (true) {
    const targets = new Set(world.citySites.filter((site) => !reached.has(site.tile))
      .map((site) => site.tile));
    if (!targets.size) return;
    // One removed obstacle costs more than any walkable detour across the map.
    const path = searchPath(world, reached, (id) => targets.has(id),
      (id) => isWalkable(world.tiles[id]) ? 1 : world.tiles.length + 1);
    if (path === null) throw new Error('Unable to connect city sites.');
    for (const id of path) {
      if (!isWalkable(world.tiles[id])) world.tiles[id].terrain = 'plain';
    }
    reached = walkableRegion(world, world.citySites[0].tile);
  }
}

function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createWorld(seed = 73129) {
  const random = seededRandom(seed);
  const rotate = id => (HEIGHT - 1 - Math.floor(id / WIDTH)) * WIDTH + WIDTH - 1 - id % WIDTH;
  const symmetrize = values => values.map((value, id) => (value + values[rotate(id)]) / 2);
  const elevation = noiseField(random, WIDTH, HEIGHT, 4.5);
  const detail = noiseField(random, WIDTH, HEIGHT, 2);
  const moistureField = noiseField(random, WIDTH, HEIGHT, 4);
  const heights = symmetrize(Array.from({ length: WIDTH * HEIGHT }, (_, id) => {
    const x = id % WIDTH;
    const y = Math.floor(id / WIDTH);
    return elevation(x, y) * 0.72 + detail(x, y) * 0.28;
  }));
  const moisture = symmetrize(Array.from({ length: WIDTH * HEIGHT }, (_, id) =>
    moistureField(id % WIDTH, Math.floor(id / WIDTH))));
  const sortedHeights = [...heights].sort((a, b) => a - b);
  const hillLevel = sortedHeights[Math.floor(heights.length * 0.69)];
  const mountainLevel = sortedHeights[Math.floor(heights.length * 0.92)];
  const tiles = heights.map((height, id) => {
    const x = id % WIDTH;
    const r = Math.floor(id / WIDTH);
    const terrain = height >= mountainLevel ? 'mountain'
      : height >= hillLevel ? 'hill'
        : moisture[id] > 0.54 ? 'forest' : 'plain';
    return { id, q: x - Math.floor(r / 2), r, terrain, owner: -1, road: null };
  });

  const wall = { from: 10, to: 15 };
  for (const tile of tiles) {
    if (tile.q + Math.floor(tile.r / 2) >= wall.from && tile.q + Math.floor(tile.r / 2) <= wall.to) {
      tile.terrain = 'mountain';
    }
  }
  const riverCenter = 12 + random() * 2;
  const phase = random() * Math.PI * 2;
  let previousX;
  for (let y = 0; y < HEIGHT; y++) {
    const x = Math.round(riverCenter + Math.sin(y * 0.48 + phase) * 1.7);
    const from = previousX ?? x;
    for (let column = Math.min(from, x); column <= Math.max(from, x); column++) {
      tiles[y * WIDTH + column].terrain = 'water';
    }
    previousX = x;
  }
  for (const tile of tiles) {
    const x = tile.q + Math.floor(tile.r / 2);
    if (x < wall.from || x > wall.to) continue;
    const mirror = tiles[rotate(tile.id)];
    if (tile.terrain === 'water' || mirror.terrain === 'water') {
      tile.terrain = mirror.terrain = 'water';
    } else {
      tile.terrain = mirror.terrain = 'mountain';
    }
  }
  const lakes = Array.from({ length: 2 }, () => ({
    x: 6 + random() * 3, y: 2 + random() * 13,
    rx: 1.6 + random(), ry: 1.1 + random() * 0.7,
  }));
  for (const lake of lakes) {
    for (const site of [lake, { ...lake, x: WIDTH - 1 - lake.x, y: HEIGHT - 1 - lake.y }]) {
      for (const tile of tiles) {
        const x = tile.q + Math.floor(tile.r / 2);
        if (((x - site.x) / site.rx) ** 2 + ((tile.r - site.y) / site.ry) ** 2 < 1) tile.terrain = 'water';
      }
    }
  }

  const passageCount = 3 + Math.floor(random() * 3);
  const selectedPairs = shuffled([[1.5, 15.5], [4.5, 12.5]], random)
    .slice(0, Math.floor(passageCount / 2));
  const bands = selectedPairs.flat();
  if (passageCount % 2) bands.push(8.5);
  const passageMask = new Uint8Array(WIDTH * HEIGHT);
  for (const center of bands) {
    const wavePhase = random() * Math.PI * 2;
    const mask = new Uint8Array(WIDTH * HEIGHT);
    for (const tile of tiles) {
      const x = tile.q + Math.floor(tile.r / 2);
      const row = center + Math.sin(x * 0.48 + wavePhase) * 0.38;
      if (x >= 5 && x <= 20 && Math.abs(tile.r - row) <= 0.86) mask[tile.id] = 1;
    }
    const rows = center === 8.5 ? [8, 9] : [Math.floor(center), Math.ceil(center)];
    for (let x = 7; x <= 18; x++) for (const row of rows) mask[row * WIDTH + x] = 1;
    for (let id = 0; id < mask.length; id++) {
      if (mask[id] || mask[rotate(id)]) passageMask[id] = 1;
    }
  }
  for (const tile of tiles) if (passageMask[tile.id] && !isWalkable(tile)) tile.terrain = 'plain';

  const fortressNames = shuffled(['北境关', '灰岩堡', '风啸隘', '铁脊关', '霜河堡', '断云寨'], random);
  const cityNames = shuffled(['青石镇', '白桦城', '红丘集', '暮港', '石门', '溪谷城', '荒原驿', '铜川', '杉林镇', '沉石城', '望北城', '盐湖镇'], random);
  const citySites = [
    { tile: 9 * WIDTH + 4, name: '岚京', owner: 0, capitalOf: 0, kind: 'capital' },
    { tile: 4 * WIDTH + 6, name: '白石城', owner: 0, capitalOf: null, kind: 'city' },
    { tile: 8 * WIDTH + 21, name: '赤都', owner: 1, capitalOf: 1, kind: 'capital' },
    { tile: 13 * WIDTH + 19, name: '铁砧堡', owner: 1, capitalOf: null, kind: 'city' },
  ];
  const fortressTile = row => row * WIDTH + 12 + Math.floor(random() * 2);
  for (const [north] of selectedPairs) {
    const tile = fortressTile(Math.round(north));
    citySites.push(
      { tile, name: fortressNames[citySites.length - 4], owner: -1, capitalOf: null, kind: 'fortress' },
      { tile: rotate(tile), name: fortressNames[citySites.length - 3], owner: -1, capitalOf: null, kind: 'fortress' },
    );
  }
  if (passageCount % 2) {
    const tile = random() < 0.5 ? 8 * WIDTH + 12 : 9 * WIDTH + 13;
    citySites.push(
      { tile, name: fortressNames[citySites.length - 4], owner: -1, capitalOf: null, kind: 'fortress' },
      { tile: rotate(tile), name: cityNames[0], owner: -1, capitalOf: null, kind: 'city' },
    );
  }

  const candidates = shuffled(tiles.filter(tile => {
    const x = tile.q + Math.floor(tile.r / 2);
    return x >= 2 && x <= 9 && isWalkable(tile);
  }).map(tile => tile.id), random);
  let neutralPairs = 0;
  for (const tile of candidates) {
    const mirror = rotate(tile);
    if (!isWalkable(tiles[mirror])) continue;
    if (citySites.some(city => distance({ tiles }, city.tile, tile) < 3 || distance({ tiles }, city.tile, mirror) < 3)) continue;
    citySites.push(
      { tile, name: cityNames[(passageCount % 2) + neutralPairs * 2], owner: -1, capitalOf: null, kind: 'city' },
      { tile: mirror, name: cityNames[(passageCount % 2) + neutralPairs * 2 + 1], owner: -1, capitalOf: null, kind: 'city' },
    );
    if (++neutralPairs === 3) break;
  }

  const world = { width: WIDTH, height: HEIGHT, tiles, citySites };
  for (const city of citySites) tiles[city.tile].terrain = 'plain';
  connectCities(world);
  for (const tile of tiles) {
    const x = tile.q + Math.floor(tile.r / 2);
    if (x >= wall.from && x <= wall.to) continue;
    const mirror = tiles[rotate(tile.id)];
    if (tile.terrain !== mirror.terrain) {
      if (mirror.terrain === 'plain' && isWalkable(tile)) mirror.terrain = tile.terrain;
      else if (tile.terrain === 'plain' && isWalkable(mirror)) tile.terrain = mirror.terrain;
      else if (isWalkable(tile) !== isWalkable(mirror)) tile.terrain = mirror.terrain = 'plain';
      else tile.terrain = mirror.terrain = tile.terrain;
    }
  }

  const ownedCities = citySites.filter((city) => city.owner >= 0);
  for (const tile of tiles) {
    if (!isWalkable(tile)) continue;
    let nearest = 5;
    let owner = -1;
    for (const city of ownedCities) {
      const steps = axialDistance(tile, tiles[city.tile]);
      if (steps < nearest) {
        nearest = steps;
        owner = city.owner;
      } else if (steps === nearest && city.owner !== owner) {
        owner = -1;
      }
    }
    tile.owner = owner;
  }
  for (const city of citySites) tiles[city.tile].owner = city.owner;
  return world;
}

export function computeSupply(state, owner) {
  const techs = state.factions?.[owner]?.techs ?? [];
  const limit = techs.includes('advancedLogistics') ? 12 : techs.includes('logistics') ? 10 : 8;
  const supplied = new Set();
  const queue = [];
  for (const city of state.cities ?? []) {
    const tile = state.tiles[city.tile];
    if (city.owner === owner && tile?.owner === owner && isWalkable(tile)
      && !supplied.has(city.tile)) {
      supplied.add(city.tile);
      queue.push([city.tile, 0]);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const [current, steps] = queue[index];
    if (steps >= limit) continue;
    for (const id of neighbors(state, current)) {
      const tile = state.tiles[id];
      if (tile.owner === owner && isWalkable(tile) && !supplied.has(id)) {
        supplied.add(id);
        queue.push([id, steps + 1]);
      }
    }
  }
  return supplied;
}
