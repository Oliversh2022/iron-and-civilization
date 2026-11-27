import { BUILDINGS, FOUND_COST, TECHS, TERRAIN, UNITS } from './config.js';
import { applyCommand, getSupply, income, validateCommand } from './rules.js';
import { distance } from './world.js';

let OWNER = 1;
const INTERVAL = 2;
const STUCK_AFTER = 18;
const health = unit => unit.hp / UNITS[unit.type].hp;
const captures = unit => UNITS[unit.type].canCapture;
const command = (state, value) => applyCommand(state, OWNER, value).ok;
const byId = (a, b) => a.id - b.id;

function canSpend(state, cost, reserve = {}) {
  const resources = state.factions[OWNER].resources;
  return Object.keys(resources).every(key => resources[key] + 1e-8 >= (cost[key] || 0) + (reserve[key] || 0));
}

function economy(state, cities, army, threatened) {
  const faction = state.factions[OWNER];
  const counts = { infantry: 0, artillery: 0, tank: 0, engineer: 0 };
  // Wounded reserves must not prevent replacements from being recruited.
  for (const unit of army) if (health(unit) > 0.3) counts[unit.type]++;
  for (const city of cities) if (Object.hasOwn(counts, city.production?.item)) counts[city.production.item]++;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const desired = Math.min(16, Math.max(5, cities.length * 2 + 3, threatened * 2 + 2));
  const armor = faction.techs.includes('armor');
  const quotas = { engineer: Math.min(2, Math.max(1, Math.ceil(cities.length / 3))) };
  quotas.infantry = Math.ceil((desired - quotas.engineer) * (armor ? 0.55 : 0.7));
  quotas.tank = armor ? Math.ceil((desired - quotas.engineer) * 0.23) : 0;
  quotas.artillery = Math.max(1, desired - quotas.engineer - quotas.infantry - quotas.tank);
  const needed = Object.keys(counts).filter(type => counts[type] < quotas[type])
    .sort((a, b) => counts[a] / quotas[a] - counts[b] / quotas[b]);
  const recruit = counts.engineer === 0 ? 'engineer' : counts.infantry < 3 ? 'infantry' : needed[0];
  const idle = cities.filter(city => !city.production);
  let saving = recruit;
  if (idle.length && recruit
    && command(state, { type: 'produce', cityId: idle[0].id, item: recruit })) saving = null;

  if (!faction.research) {
    for (const tech of ['industry', 'logistics', 'agriculture', 'armor', 'steel', 'radio', 'irrigation', 'mobility', 'combined', 'massProduction', 'chemistry', 'ballistics', 'advancedLogistics', 'automation', 'hydraulics', 'jointOperations']) {
      if (faction.techs.includes(tech) || (TECHS[tech].requires && !faction.techs.includes(TECHS[tech].requires))) continue;
      command(state, { type: 'research', tech });
      break;
    }
  }

  // Recruitment has first use of both the production slot and its full budget.
  if (army.length === 0 || total < 2) return;
  const reserve = { ...UNITS.infantry.cost };
  // Preserve specialist funding even when ordinary infantry already fill the army.
  if (saving) for (const [key, amount] of Object.entries(UNITS[saving].cost)) reserve[key] = Math.max(reserve[key] || 0, amount);
  const rates = income(state, OWNER);
  const preference = rates.industry < Math.max(2, rates.food * 0.9) ? ['factory', 'farm', 'lab']
    : rates.food < rates.industry * 0.6 ? ['farm', 'factory', 'lab']
      : rates.science < rates.industry * 0.4 ? ['lab', 'factory', 'farm'] : ['factory', 'farm', 'lab'];
  const tier = state.time < 100 ? 1 : state.time < 240 ? 2 : 3;
  for (const city of cities) {
    if (city.production) continue;
    const items = preference.filter(item => city.buildings[item] < Math.min(tier, BUILDINGS[item].max))
      .sort((a, b) => city.buildings[a] - city.buildings[b] || preference.indexOf(a) - preference.indexOf(b));
    for (const item of items) {
      if (canSpend(state, BUILDINGS[item].cost, reserve)
        && command(state, { type: 'produce', cityId: city.id, item })) break;
    }
  }
}

function hold(state, unit) {
  if (unit.order || unit.path.length || unit.progress > 0) command(state, { type: 'hold', unitId: unit.id });
}

function order(state, unit, tile) {
  // Applying even an identical order resets movement progress in the rules.
  if (unit.order?.tile === tile) return true;
  if (unit.tile === tile) { hold(state, unit); return true; }
  if (!command(state, { type: 'order', unitId: unit.id, tile })) return false;
  state.ai.targets[unit.id] = { tile, at: state.time };
  return true;
}

function chooseOrder(state, unit, tiles, avoid = null) {
  for (const tile of tiles) {
    if (tile === avoid) continue;
    if (order(state, unit, tile)) return true;
  }
  return false;
}

function dangerAt(state, tile, enemies, radius = 2) {
  return enemies.filter(enemy => distance(state, tile, enemy.tile) <= radius).length;
}

function noProgressFor(state, unit) {
  return state.time - Math.max(state.ai.lastPositions[unit.id].since, state.ai.targets[unit.id]?.at ?? 0);
}

function retreat(state, unit, supply, enemies, hostileCities) {
  const unsafe = tile => dangerAt(state, tile, enemies)
    + hostileCities.filter(city => city.hp > 0 && distance(state, tile, city.tile) <= 1).length;
  if (supply.has(unit.tile) && !unsafe(unit.tile)) { hold(state, unit); return; }
  // Retain a valid withdrawal just like any other moving order.
  if (unit.order && supply.has(unit.order.tile) && !unsafe(unit.order.tile)
    && noProgressFor(state, unit) <= STUCK_AFTER) return;
  const avoid = unit.order && noProgressFor(state, unit) > STUCK_AFTER ? unit.order.tile : null;
  if (avoid !== null) hold(state, unit);
  const safeTiles = [...supply].sort((a, b) => unsafe(a) - unsafe(b)
    || distance(state, unit.tile, a) - distance(state, unit.tile, b) || a - b);
  if (!chooseOrder(state, unit, safeTiles, avoid)) hold(state, unit);
}

function closeBlocker(state, unit, enemies, hostileCities) {
  const range = UNITS[unit.type].range;
  return [...enemies, ...hostileCities.filter(city => city.hp > 0)]
    .filter(target => distance(state, unit.tile, target.tile) <= range + 1)
    .sort((a, b) => distance(state, unit.tile, a.tile) - distance(state, unit.tile, b.tile) || byId(a, b));
}

function rallyTiles(state, objective, supply, enemies, hostileCities) {
  return [...supply].filter(tile => !dangerAt(state, tile, enemies)
    && !hostileCities.some(city => city.hp > 0 && distance(state, tile, city.tile) <= 2))
    .sort((a, b) => distance(state, a, objective.tile) - distance(state, b, objective.tile)
      || TERRAIN[state.tiles[b].terrain].defense - TERRAIN[state.tiles[a].terrain].defense || a - b);
}

/** Deterministic decisions; all game actions go through the player's rules. */
export function updateAI(state) {
  if (state.paused || state.outcome) return;
  OWNER = 1 - state.playerFaction;
  if (state.time + 1e-8 < state.ai.nextAt) return;
  state.ai.nextAt = state.time + INTERVAL;

  const army = state.units.filter(unit => unit.owner === OWNER && unit.hp > 0).sort(byId);
  const enemies = state.units.filter(unit => unit.owner !== OWNER && unit.hp > 0);
  const cities = state.cities.filter(city => city.owner === OWNER)
    .sort((a, b) => Number(b.capitalOf === OWNER) - Number(a.capitalOf === OWNER) || byId(a, b));
  const capital = cities.find(city => city.capitalOf === OWNER) || cities[0];
  const neutrals = state.cities.filter(city => city.owner < 0);
  const hostileCities = state.cities.filter(city => city.owner >= 0 && city.owner !== OWNER);
  const living = new Set(army.map(unit => String(unit.id)));
  for (const records of [state.ai.targets, state.ai.lastPositions]) {
    for (const id of Object.keys(records)) if (!living.has(id)) delete records[id];
  }
  for (const unit of army) {
    const previous = state.ai.lastPositions[unit.id];
    if (!previous || previous.tile !== unit.tile) state.ai.lastPositions[unit.id] = { tile: unit.tile, since: state.time };
  }
  const threats = capital ? enemies.filter(enemy => distance(state, capital.tile, enemy.tile) <= 5)
    .sort((a, b) => distance(state, capital.tile, a.tile) - distance(state, capital.tile, b.tile) || byId(a, b)) : [];
  economy(state, cities, army, threats.length);
  if (!capital || !army.length) return;

  const supply = getSupply(state, OWNER);
  // Prefer an existing local guard, so newly spawned troops do not rotate it out.
  const combatArmy = army.filter(unit => unit.type !== 'engineer');
  const garrison = [...combatArmy].sort((a, b) => Number(distance(state, b.tile, capital.tile) <= 1) - Number(distance(state, a.tile, capital.tile) <= 1)
    || Number(captures(b)) - Number(captures(a)) || byId(a, b))[0];
  const field = combatArmy.filter(unit => unit !== garrison && health(unit) > 0.3);
  const objectives = [...hostileCities].sort((a, b) => Math.min(...cities.map(city => distance(state, city.tile, a.tile)))
    - Math.min(...cities.map(city => distance(state, city.tile, b.tile))) || byId(a, b));
  const staging = new Map(objectives.map(city => [city.id, rallyTiles(state, city, supply, enemies, hostileCities)]));
  const commitments = new Map(neutrals.map(city => [city.tile, field.filter(unit => captures(unit) && unit.order?.tile === city.tile).length]));

  for (const unit of army) {
    const age = noProgressFor(state, unit);
    const nearEnemies = enemies.filter(enemy => distance(state, unit.tile, enemy.tile) <= 3);
    const nearby = army.filter(ally => ally !== unit && health(ally) > 0.3 && distance(state, unit.tile, ally.tile) <= 3);
    const cityFire = hostileCities.some(city => city.hp > 0 && distance(state, unit.tile, city.tile) <= 1);
    const exposed = !supply.has(unit.tile);
    const neutralMarch = captures(unit) && neutrals.some(city => city.tile === unit.order?.tile)
      && !nearEnemies.length && !cityFire;
    const weak = health(unit) <= 0.3;
    const outmatched = nearEnemies.length > nearby.length + 1;
    const isolated = (nearEnemies.length || cityFire) && !nearby.length && (exposed || health(unit) < 0.55);
    // A safe neutral march must cross the supply limit before establishing its new hub.
    const stranded = exposed && !neutralMarch && !nearby.length;
    if (weak || isolated || (outmatched && (exposed || health(unit) < 0.6)) || stranded) {
      retreat(state, unit, supply, enemies, hostileCities);
      continue;
    }

    if (unit.type === 'engineer') {
      if (unit.work) continue;
      if (unit.order) {
        if (age > STUCK_AFTER) hold(state, unit);
        continue;
      }
      const leader = [...combatArmy].sort((a, b) => distance(state, unit.tile, a.tile) - distance(state, unit.tile, b.tile) || byId(a, b))[0];
      if (leader && distance(state, unit.tile, leader.tile) > 2) order(state, unit, leader.tile);
      else hold(state, unit);
      continue;
    }

    const defending = threats.length && (unit === garrison
      || distance(state, unit.tile, capital.tile) <= 7
      || (threats.length >= 2 && distance(state, threats[0].tile, capital.tile) <= 2));
    if (defending) {
      if (unit.order && threats.some(enemy => enemy.id === unit.order.targetId
        && (unit !== garrison || distance(state, capital.tile, enemy.tile) <= 2)) && age <= STUCK_AFTER) continue;
      const targets = threats.filter(enemy => unit !== garrison || distance(state, capital.tile, enemy.tile) <= 2);
      if (chooseOrder(state, unit, targets.map(target => target.tile))) continue;
    }
    if (unit === garrison) {
      if (distance(state, unit.tile, capital.tile) > 1) order(state, unit, capital.tile);
      else hold(state, unit);
      continue;
    }

    const blockers = closeBlocker(state, unit, enemies, hostileCities);
    const fighting = blockers.some(target => distance(state, unit.tile, target.tile) <= UNITS[unit.type].range);
    let avoid = null;
    if (unit.order) {
      // The rules track moving attack targets themselves; preserve their path.
      const blockedNext = unit.path.length && enemies.some(enemy => enemy.tile === unit.path[0]);
      if (blockedNext && chooseOrder(state, unit, blockers.map(target => target.tile))) continue;
      if (age <= STUCK_AFTER || (unit.status === '交战' && fighting)) continue;
      avoid = unit.order.tile;
      hold(state, unit);
      state.ai.targets[unit.id] = { tile: avoid, at: state.time };
    } else {
      const previous = state.ai.targets[unit.id];
      if (previous && previous.tile !== unit.tile && state.time - previous.at < 24) avoid = previous.tile;
    }
    if (blockers.length && chooseOrder(state, unit, blockers.map(target => target.tile), avoid)) continue;

    // A stopped frontier force may create a legal, fully paid supply hub.
    if (field.length >= 4 && cities.length < 6 && health(unit) > 0.6
      && !dangerAt(state, unit.tile, enemies, 4)
      && canSpend(state, FOUND_COST, UNITS.infantry.cost)
      && validateCommand(state, OWNER, { type: 'found', unitId: unit.id }).ok
      && command(state, { type: 'found', unitId: unit.id })) continue;

    if (captures(unit)) {
      const goals = [...neutrals].sort((a, b) => distance(state, unit.tile, a.tile) + (commitments.get(a.tile) || 0) * 5
        - distance(state, unit.tile, b.tile) - (commitments.get(b.tile) || 0) * 5 || byId(a, b));
      let expanding = false;
      for (const city of goals) {
        if (city.tile === avoid || !order(state, unit, city.tile)) continue;
        commitments.set(city.tile, (commitments.get(city.tile) || 0) + 1);
        expanding = true;
        break;
      }
      if (expanding) continue;
    } else {
      // Artillery cannot capture the neutral hub itself.
      const leaders = field.filter(ally => captures(ally) && neutrals.some(city => city.tile === ally.order?.tile))
        .sort((a, b) => distance(state, unit.tile, a.tile) - distance(state, unit.tile, b.tile) || byId(a, b));
      if (leaders.length) {
        if (distance(state, unit.tile, leaders[0].tile) <= 2) { hold(state, unit); continue; }
        if (chooseOrder(state, unit, leaders.map(leader => leader.tile), avoid)) continue;
      }
    }

    let assigned = false;
    for (const objective of objectives) {
      if (objective.tile === avoid) continue;
      const attack = { type: 'order', unitId: unit.id, tile: objective.tile };
      if (!validateCommand(state, OWNER, attack).ok) continue;
      const rallies = staging.get(objective.id);
      const rally = rallies[0] ?? capital.tile;
      const ready = field.filter(ally => distance(state, ally.tile, rally) <= 4);
      const advancing = field.filter(ally => ally.order?.tile === objective.tile);
      const attackNow = (ready.length >= 3 && ready.filter(captures).length >= 2)
        || advancing.length >= 2 || (objective.hp <= 0 && captures(unit));
      if (attackNow && order(state, unit, objective.tile)) { assigned = true; break; }
      if (chooseOrder(state, unit, rallies, avoid)) { assigned = true; break; }
    }
    if (assigned) continue;
    // A hostile screen can make every city unreachable.
    const screens = [...enemies].sort((a, b) => distance(state, unit.tile, a.tile) - distance(state, unit.tile, b.tile) || byId(a, b));
    if (!chooseOrder(state, unit, screens.map(enemy => enemy.tile), avoid)) hold(state, unit);
  }
}
