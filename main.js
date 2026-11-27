import { createGame, randomSeed, validateCommand, applyCommand, step, income, getSupply, getCombatTarget } from './rules.js';
import { updateAI } from './ai.js';
import { saveGame, loadGame } from './storage.js';
import { STEP, TERRAIN, UNITS, FACTIONS, BUILDINGS, TECHS, ENGINEERING_ACTIONS, FOUND_COST } from './config.js';
import { View, $, updatePanels, showGuide, modal, toast, escapeHTML, icon, costText, clock } from './view.js';

let state = createGame();
let selection = { kind: 'city', id: 1 };
let drag = null, orderMode = false, engineerMode = null, started = false, resultShown = false, selectedFaction = 0;
let lastFrame = null, accumulator = 0, lastUI = 0, pointerHeld = false, selectedTech = 'industry';
const view = new View($('map'), $('minimap'));
view.buildMap(state);
view.focus(state.tiles[state.cities[0].tile], 1);

const playerOwner = () => state.playerFaction;
const enemyOwner = () => 1 - state.playerFaction;
function factionPicker() {
  return `<div class="faction-select" role="group" aria-label="选择指挥阵营">${FACTIONS.map(faction => `<button type="button" data-faction="${faction.id}" class="faction-card ${selectedFaction === faction.id ? 'active' : ''}" aria-pressed="${selectedFaction === faction.id}"><span class="faction-mark">${faction.mark}</span><span><strong>${faction.name}</strong><small>${faction.id === 0 ? '工业 · 均衡 · 联盟战线' : '钢铁 · 攻坚 · 帝国战线'}</small></span></button>`).join('')}</div>`;
}
function updateFactionChoice() {
  document.querySelectorAll('[data-faction]').forEach(button => {
    const active = Number(button.dataset.faction) === selectedFaction;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const faction = FACTIONS[selectedFaction], enemy = FACTIONS[1 - selectedFaction];
  if ($('intro-faction-detail')) $('intro-faction-detail').textContent = `你将指挥${faction.name}，在北境建设工业、研究科技，率领部队夺取${enemy.name}首都。`;
  if ($('objective-title')) $('objective-title').textContent = `攻占${enemy.name}首都`;
}

const htmlCache = new WeakMap();
function setHTML(element, html) {
  if (htmlCache.get(element) === html) return;
  htmlCache.set(element, html);
  const focused = element.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
  element.innerHTML = html;
  if (focused) element.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
function stack(tile) {
  const units = state.units.filter(u => u.tile === tile);
  return units.length ? `<div class="section-heading"><h3>驻留部队 · ${units.length}</h3></div><div class="stack-buttons">${units.map(u => `<button data-unit="${u.id}" data-focus="unit-${u.id}" class="${selection?.kind === 'unit' && selection.id === u.id ? 'active' : ''}">${FACTIONS[u.owner].mark} ${UNITS[u.type].short} #${u.id}</button>`).join('')}</div>` : '';
}
function productionCard(city, item) {
  const config = BUILDINGS[item] || UNITS[item];
  const result = validateCommand(state, playerOwner(), { type: 'produce', cityId: city.id, item });
  return `<button class="action-card" data-produce="${item}" data-city-id="${city.id}" data-focus="produce-${item}" ${result.ok ? '' : 'disabled'} title="${escapeHTML(config.description + '；' + costText(config.cost) + (result.ok ? '' : '；' + result.reason))}">${BUILDINGS[item] ? icon(config.icon) : `<img class="unit-icon" src="${view.portraits[item]}" alt="">`}<div><strong>${config.name}${BUILDINGS[item] ? ` · ${city.buildings[item]}/${config.max}` : ''}</strong><small>${costText(config.cost)}</small>${result.ok ? '' : `<span class="reason">${escapeHTML(result.reason)}</span>`}</div><span class="duration">${config.duration}s</span></button>`;
}
function inspector() {
  let html = '';
  if (selection?.kind === 'city') {
    const city = state.cities.find(c => c.id === selection.id);
    if (!city) { selection = null; return inspector(); }
    const owned = city.owner === playerOwner();
    html = `<div class="detail-heading"><h2>${escapeHTML(city.name)}</h2>${city.capitalOf !== null ? '<span class="badge">首都</span>' : city.kind === 'fortress' ? '<span class="badge">要塞</span>' : ''}</div><div class="owner-label ${city.owner >= 0 && !owned ? 'enemy' : ''}">${city.owner < 0 ? city.kind === 'fortress' ? '中立要塞' : '中立城市' : FACTIONS[city.owner].name}</div>${view.portrait(city.capitalOf === null ? city.kind === 'fortress' ? 'fortress' : 'town' : 'capital')}<div class="detail-stats"><div><span>守备</span><strong>${Math.ceil(city.hp)} / ${city.maxHp}</strong></div><div><span>补给枢纽</span><strong>${city.owner < 0 ? '尚未启用' : state.factions[city.owner].techs.includes('advancedLogistics') ? '12 格' : state.factions[city.owner].techs.includes('logistics') ? '10 格' : '8 格'}</strong></div></div><div class="health-track"><i style="width:${city.hp / city.maxHp * 100}%"></i></div>`;
    if (owned) {
      html += city.production ? `<div class="production-box"><strong>${(BUILDINGS[city.production.item] || UNITS[city.production.item]).name}</strong><small>${city.production.remaining < 1e-8 && UNITS[city.production.item] ? ' · 城内敌军阻挡部署，请先清除敌军' : ` · 剩余 ${Math.ceil(city.production.remaining)}秒`}</small><div class="progress"><i style="width:${100 * (1 - city.production.remaining / city.production.duration)}%"></i></div><button data-cancel="${city.id}" data-focus="cancel">取消生产 · 返还50%</button></div>` : '<p class="description">生产槽空闲 · 选择建设或征兵</p>';
      html += `<div class="production-tabs"><button data-production-tab="build" data-focus="tab-build" class="${productionTab === 'build' ? 'active' : ''}">城市建设</button><button data-production-tab="army" data-focus="tab-army" class="${productionTab === 'army' ? 'active' : ''}">征召部队</button></div><div class="action-list">${Object.keys(productionTab === 'build' ? BUILDINGS : UNITS).map(item => productionCard(city, item)).join('')}</div>`;
    } else html += `<p class="description">${city.owner < 0 ? `派步兵、装甲或工兵进驻，即可接管${city.kind === 'fortress' ? '中立要塞' : '中立城市'}。` : '击破守备、清除城中敌军后，让步兵、装甲或工兵进入城市。'}${city.capitalOf === enemyOwner() ? ` 攻占${FACTIONS[enemyOwner()].name}首都即可赢得战役。` : ''}</p>`;
    html += stack(city.tile);
  } else if (selection?.kind === 'unit') {
    const unit = state.units.find(u => u.id === selection.id);
    if (!unit) { selection = null; orderMode = false; engineerMode = null; return inspector(); }
    const data = UNITS[unit.type], supplied = getSupply(state, unit.owner).has(unit.tile), owned = unit.owner === playerOwner();
    const target = unit.order && (state.cities.find(c => c.tile === unit.order.tile)?.name || `地块 ${unit.order.tile}`);
    const enemy = getCombatTarget(state, unit);
    const activity = unit.work ? `${ENGINEERING_ACTIONS[unit.work.action]}：地块 ${unit.work.tile} · ${Math.ceil(unit.work.remaining)}秒`
      : enemy ? `交战：${enemy.type ? `${UNITS[enemy.type].name} #${enemy.id}` : enemy.name}`
        : unit.status === '交战' ? (unit.path.length ? '行军' : '原地防御') : unit.status;
    html = `<div class="detail-heading"><h2>${data.name}</h2><span class="badge">#${unit.id}</span></div><div class="owner-label ${owned ? '' : 'enemy'}">${FACTIONS[unit.owner].mark} ${FACTIONS[unit.owner].name}</div>${view.portrait(unit.type)}<span class="status-pill ${supplied ? '' : 'warning'}">${supplied ? '补给充足' : '！断供 · 速度与伤害 −40%'}</span><div class="detail-stats"><div><span>生命</span><strong>${Math.ceil(unit.hp)} / ${data.hp}</strong></div><div><span>火力 / 射程</span><strong>${(data.damage * (supplied ? 1 : 0.6)).toFixed(1)} / ${data.range}格</strong></div></div><div class="health-track"><i style="width:${unit.hp / data.hp * 100}%"></i></div><p class="unit-order">${escapeHTML(activity)}${target && !unit.work ? `<br>目标：${escapeHTML(target)} · 余 ${unit.path.length}格` : ''}</p>`;
    if (owned) {
      const found = validateCommand(state, playerOwner(), { type: 'found', unitId: unit.id });
      html += `<div class="action-list"><button class="primary" data-order data-focus="order" ${state.outcome ? 'disabled' : ''}>${orderMode ? '取消选取目标' : '移动 / 进攻 · 选择目标'}</button><button data-hold="${unit.id}" data-focus="hold" ${state.outcome ? 'disabled' : ''}>${unit.work ? '停止作业 / 原地防御' : '停止行军 / 原地防御'}</button>${unit.type === 'engineer' ? `<button data-engineer="build" data-focus="engineer-build" class="${engineerMode === 'build' ? 'active' : ''}" ${state.outcome ? 'disabled' : ''}>建设 / 改造 · 选择地块</button><button data-engineer="destroy" data-focus="engineer-destroy" class="${engineerMode === 'destroy' ? 'active' : ''}" ${state.outcome ? 'disabled' : ''}>拆除敌方道路 · 选择地块</button>` : ''}<button data-found="${unit.id}" data-focus="found" ${found.ok ? '' : 'disabled'} title="${escapeHTML(costText(FOUND_COST))}">建立新城</button></div><p class="reason">${found.ok ? costText(FOUND_COST) : escapeHTML(found.reason)}</p>`;
      if (unit.type === 'engineer') html += `<p class="description">工兵无战斗力且不会被俘虏，可占领所在区块。行军经过无公路的平原时会自动铺路，不中断移动。指定相邻或远处地块进行手动建设；平原30秒、森林30秒、丘陵60秒、河流120秒，拆路30秒。</p>`;
      if (unit.work) html += `<div class="production-box"><strong>${ENGINEERING_ACTIONS[unit.work.action]} · 地块 ${unit.work.tile}</strong><small> · 剩余 ${Math.ceil(unit.work.remaining)}秒</small><div class="progress"><i style="width:${100 * (1 - unit.work.remaining / unit.work.duration)}%"></i></div></div>`;
    }
    html += `<p class="description">${data.description}</p>${stack(unit.tile)}`;
  } else if (selection?.kind === 'tile') {
    const tile = state.tiles[selection.id], data = TERRAIN[tile.terrain];
    const road = tile.road ? `<br>${tile.road.kind === 'bridge' ? '桥梁' : '公路'} · ${FACTIONS[tile.road.owner].name}建设 · 移速加成` : '';
    const passable = data.walkable || tile.road?.kind === 'bridge';
    html = `<div class="detail-heading"><h2>${data.name}</h2><span class="badge">#${tile.id}</span></div><div class="owner-label ${tile.owner >= 0 && tile.owner !== playerOwner() ? 'enemy' : ''}">${tile.owner < 0 ? '无主领土' : FACTIONS[tile.owner].name}</div>${view.portraits[tile.terrain] ? view.portrait(tile.terrain) : '<div class="empty-symbol">◇</div>'}<p class="description">${passable ? `地形防御 ${data.defense * 100}% · 移动消耗 ${data.cost}<br>${FACTIONS[playerOwner()].name}补给${getSupply(state, playerOwner()).has(tile.id) ? '已覆盖' : '未覆盖'}${road}` : '水域和山地不可通行。水域可由工兵架桥，山地需绕行。'}${tile.road ? '<br>工兵可拆除敌方建设的道路。' : ''}</p>${stack(tile.id)}`;
  } else html = `<div class="empty-symbol">${FACTIONS[playerOwner()].mark}</div><h2>战区指挥</h2><p class="description">选择城市管理发展，选择军队下达命令。<br>右键移动或攻击；同格多次点击可切换单位。</p><button data-guide class="wide-button">打开指挥官手册 ↗</button>`;
  setHTML($('inspector'), html);
}
let productionTab = 'build';
function refresh() {
  updatePanels(state, selection, view, income(state, playerOwner())); inspector();
  $('order-hint').hidden = !orderMode && !engineerMode;
  $('order-hint').textContent = engineerMode === 'build' ? '选择施工地块 · Esc 取消' : engineerMode === 'destroy' ? '选择敌方公路或桥梁 · Esc 取消' : '选择目标地块 · Esc 取消';
  $('pause').disabled = !started || Boolean(state.outcome);
}
function setPaused(paused) {
  state.paused = paused; accumulator = 0; lastFrame = null; refresh();
}
function clearSelection() { orderMode = false; engineerMode = null; selection = null; view.closeStack(); refresh(); }
function showInspector(show) {
  document.body.classList.toggle('collapse-right', !show);
  $('open-inspector').hidden = show;
  $('open-inspector').setAttribute('aria-expanded', String(show));
}
function choose(tile) {
  if (tile === null) { view.closeStack(); return; }
  if (engineerMode) { issueEngineering(tile); return; }
  if (orderMode) { issueOrder(tile); return; }
  const units = state.units.filter(u => u.tile === tile);
  if (units.length > 1) {
    const city = state.cities.find(c => c.tile === tile);
    const choices = [...units.map(u => ({ kind: 'unit', id: u.id })), ...(city ? [{ kind: 'city', id: city.id }] : []), { kind: 'tile', id: tile }];
    const index = choices.findIndex(c => c.kind === selection?.kind && c.id === selection.id);
    selection = choices[(index + 1) % choices.length];
    if (selection.kind === 'unit') view.openStack(tile, selection.id); else view.closeStack();
    showInspector(true); refresh(); return;
  }
  view.closeStack();
  const choices = units.map(u => ({ kind: 'unit', id: u.id }));
  const city = state.cities.find(c => c.tile === tile); if (city) choices.push({ kind: 'city', id: city.id });
  choices.push({ kind: 'tile', id: tile });
  const index = choices.findIndex(c => c.kind === selection?.kind && c.id === selection?.id);
  selection = choices[(index + 1) % choices.length]; showInspector(true); refresh();
}
function send(command, message) {
  const result = applyCommand(state, playerOwner(), command);
  toast(result.ok ? message : result.reason); refresh(); return result.ok;
}
function issueOrder(tile) {
  if (selection?.kind !== 'unit') { toast('请先选择一支己方部队。'); return; }
  if (send({ type: 'order', unitId: selection.id, tile }, '指令已下达；部队将在射程内自动交战。')) { orderMode = false; engineerMode = null; refresh(); }
}
function issueEngineering(tile) {
  if (selection?.kind !== 'unit' || state.units.find(unit => unit.id === selection.id)?.type !== 'engineer') { toast('请先选择己方工兵。'); return; }
  const message = engineerMode === 'destroy' ? '拆路指令已下达，工兵将前往目标区域。' : '工程指令已下达，工兵将前往目标区域。';
  if (send({ type: 'engineer', unitId: selection.id, tile, action: engineerMode }, message)) { engineerMode = null; refresh(); }
}
function replaceGame(next) {
  state = next; selectedFaction = state.playerFaction; updateFactionChoice();
  selection = { kind: 'city', id: state.cities.find(c => c.capitalOf === playerOwner()).id };
  orderMode = false; engineerMode = null; drag = null; pointerHeld = false; accumulator = 0; lastFrame = null; lastUI = 0; resultShown = false; productionTab = 'build';
  $('intro').hidden = true; $('modal').close(); started = true; view.hover = null; view.closeStack(); showInspector(true);
  view.buildMap(state); view.focus(state.tiles[state.cities.find(c => c.capitalOf === playerOwner()).tile], 1); refresh();
}
function researchState(key) {
  const faction = state.factions[playerOwner()], tech = TECHS[key];
  const result = validateCommand(state, playerOwner(), { type: 'research', tech: key });
  const completed = faction.techs.includes(key), active = faction.research?.tech === key;
  const locked = Boolean(tech.requires && !faction.techs.includes(tech.requires));
  const status = completed ? 'completed' : active ? 'active' : locked ? 'locked' : result.ok ? 'available' : 'unavailable';
  return { result, completed, active, locked, status, statusText: { completed: '已完成', active: '研究中', locked: '未解锁', available: '可研究', unavailable: faction.research ? '研究槽占用' : '科研不足' }[status] };
}
function selectTech(key) {
  if (!Object.hasOwn(TECHS, key)) return;
  selectedTech = key;
  document.querySelectorAll('.tech-node').forEach(node => node.classList.toggle('selected', node.dataset.techDetail === key));
  const detail = $('tech-detail'); if (!detail) return;
  const tech = TECHS[key], faction = state.factions[playerOwner()], info = researchState(key);
  const prerequisite = tech.requires
    ? `<span class="tech-requirement ${faction.techs.includes(tech.requires) ? 'met' : ''}"><i></i>${TECHS[tech.requires].name} · ${faction.techs.includes(tech.requires) ? '已解锁' : '未完成'}</span>`
    : '<span class="tech-requirement met"><i></i>基础科技 · 无前置</span>';
  const hint = escapeHTML(`${tech.description}；${costText(tech.cost)}；${tech.duration}秒${tech.requires ? '；前置：' + TECHS[tech.requires].name : ''}${info.result.ok ? '' : '；' + info.result.reason}`);
  const actionText = info.completed ? '研究完成' : info.active ? `研究中 · ${Math.ceil(faction.research.remaining)}秒` : info.locked ? '尚未解锁' : info.result.ok ? '开始研究' : escapeHTML(info.result.reason);
  detail.innerHTML = `<div class="tech-detail-main"><span class="eyebrow">TECH DOSSIER · TIER ${(tech.tier ?? 0) + 1}</span><h3>${tech.name}<span class="tech-detail-state ${info.status}">${info.statusText}</span></h3><p>${tech.description}</p>${prerequisite}</div><div class="tech-detail-action" title="${hint}"><small>${costText(tech.cost)} · ${tech.duration}秒</small><button class="primary" data-tech="${key}" title="${hint}" ${info.result.ok ? '' : 'disabled'}>${actionText}</button></div>`;
}
function researchPanel() {
  setPaused(true);
  const faction = state.factions[playerOwner()], positions = {}, rows = [0, 0, 0, 0], nodeWidth = 190, nodeHeight = 112;
  for (const [key, tech] of Object.entries(TECHS)) {
    const tier = tech.tier ?? 0, row = rows[tier]++;
    positions[key] = { x: 24 + tier * 238, y: 24 + row * 132 };
  }
  const height = Math.max(...rows) * 132 + 34;
  const edges = Object.entries(TECHS).filter(([, tech]) => tech.requires).map(([key, tech]) => {
    const from = positions[tech.requires], to = positions[key], unlocked = faction.techs.includes(tech.requires);
    const x1 = from.x + nodeWidth, y1 = from.y + nodeHeight / 2, x2 = to.x, y2 = to.y + nodeHeight / 2;
    return `<path class="tech-edge ${unlocked ? 'unlocked' : ''}" d="M${x1} ${y1} C${x1 + 30} ${y1},${x2 - 30} ${y2},${x2} ${y2}" marker-end="url(#tech-arrow)"/>`;
  }).join('');
  const nodes = Object.entries(TECHS).map(([key, tech]) => {
    const info = researchState(key);
    const hint = escapeHTML(`${tech.description}；${costText(tech.cost)}；${tech.duration}秒${tech.requires ? '；前置：' + TECHS[tech.requires].name : ''}${info.result.ok ? '' : '；' + info.result.reason}`);
    const buttonText = info.completed ? '研究完成' : info.active ? `${Math.ceil(faction.research.remaining)} 秒` : info.locked ? `需要 ${TECHS[tech.requires].name}` : info.result.ok ? '开始研究' : escapeHTML(info.result.reason);
    const p = positions[key];
    return `<article class="tech-node ${info.status}" data-tech-detail="${key}" tabindex="0" aria-label="查看${tech.name}详情" style="left:${p.x}px;top:${p.y}px" title="${hint}"><div class="tech-node-head"><span class="tech-node-icon">${icon(tech.icon)}</span><div><h3>${tech.name}</h3><span class="tech-state">${info.statusText}</span></div></div><p>${tech.description}</p><div class="tech-node-foot"><small>${costText(tech.cost)} · ${tech.duration}秒</small><button data-tech="${key}" ${info.result.ok ? '' : 'disabled'} title="${hint}">${buttonText}</button></div>${info.active ? `<div class="tech-node-progress"><i style="width:${100 * (1 - faction.research.remaining / faction.research.duration)}%"></i></div>` : ''}</article>`;
  }).join('');
  modal('科技与发展', `<p class="description">战役已暂停。点击节点查看效果与前置条件；连线表示解锁关系，研究完成后会点亮后续分支。</p><div class="tech-legend"><span class="completed">已完成</span><span class="active">研究中</span><span class="available">可研究</span><span class="locked">未解锁</span></div><section id="tech-detail" class="tech-detail" aria-live="polite"></section><div class="tech-tree-scroll"><div class="tech-tree" style="width:952px;height:${height}px"><svg class="tech-links" width="952" height="${height}" viewBox="0 0 952 ${height}" aria-hidden="true"><defs><marker id="tech-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}</svg>${nodes}</div></div>`, 'tech-tree-modal');
  selectTech(selectedTech);
}
function menuPanel() {
  setPaused(true);
  modal('对局菜单', '<p class="description">战役已暂停。存档仅保存在此浏览器中，使用一个存档槽；读取会替换当前进度。</p><div class="menu-actions"><button data-save>保存当前战役</button><button data-load>读取本地存档</button><button data-new>重新开始战役</button><button data-guide>指挥官手册</button></div><p id="menu-message" class="description" role="status"></p>');
}
function load() {
  const result = loadGame();
  if (result.ok) { replaceGame(result.state); toast('存档已载入并暂停；按空格继续。'); }
  else {
    if (!$('intro').hidden) $('load-status').textContent = result.reason;
    if ($('menu-message')) $('menu-message').textContent = result.reason;
    toast(result.reason);
  }
}
function resultPanel() {
  resultShown = true;
  const capital = state.cities.find(city => city.capitalOf === playerOwner());
  const enemyCapital = state.cities.find(city => city.capitalOf === enemyOwner());
  const title = { victory: '北境已定', defeat: `${capital.name}陷落`, draw: '两败俱伤' }[state.outcome];
  modal('战役结算', `<div class="outcome"><span class="eyebrow">${state.outcome === 'victory' ? 'VICTORY' : state.outcome === 'draw' ? 'DRAW' : 'DEFEAT'}</span><h3>${title}</h3><p>${state.outcome === 'victory' ? `${FACTIONS[playerOwner()].name}旗帜已在${enemyCapital.name}升起。` : state.outcome === 'draw' ? '双方首都在同一模拟步失守。' : `敌军占领了${FACTIONS[playerOwner()].name}首都。`}<br>战役用时 ${clock(state.time)} · ${FACTIONS[playerOwner()].name}控制 ${state.cities.filter(c => c.owner === playerOwner()).length} 座城市</p><button class="primary large" data-new-confirm>开始新的战役</button></div>`);
}
$('start').onclick = () => { replaceGame(createGame(randomSeed(), selectedFaction)); setPaused(false); };
$('help').onclick = () => { setPaused(true); showGuide(view); };
$('modal-close').onclick = () => $('modal').close();
$('research-open').onclick = researchPanel;
$('menu').onclick = menuPanel;
$('intro-load').onclick = load;
$('pause').onclick = () => { if (started && !state.outcome) setPaused(!state.paused); };
$('log-open').onclick = () => { setPaused(true); modal('战报', state.events.slice().reverse().map(e => `<div class="log-entry ${e.kind}"><time>${clock(e.time)}</time><span>${escapeHTML(e.text)}</span></div>`).join('')); };
$('fit').onclick = () => view.fit(state);
$('home').onclick = () => view.focus(state.tiles[state.cities.find(c => c.capitalOf === playerOwner()).tile], 1);
$('zoom-in').onclick = () => view.zoom(1.2);
$('zoom-out').onclick = () => view.zoom(1 / 1.2);
$('toggle-left').onclick = () => document.body.classList.toggle('collapse-left');
$('close-left').onclick = () => document.body.classList.remove('collapse-left');
$('supply-toggle').onclick = () => { view.supply = !view.supply; $('supply-toggle').classList.toggle('active', view.supply); toast(view.supply ? `青绿色覆盖：${FACTIONS[playerOwner()].name}补给通路；断供单位速度与伤害降低40%。` : '补给视图已关闭。'); };
$('grid-toggle').onclick = () => { view.grid = !view.grid; $('grid-toggle').classList.toggle('active', view.grid); };
$('routes-toggle').onclick = () => { view.routes = !view.routes; $('routes-toggle').classList.toggle('active', view.routes); $('routes-toggle').setAttribute('aria-pressed', String(view.routes)); };
$('clear-selection').onclick = clearSelection;
$('collapse-inspector').onclick = () => showInspector(false);
$('open-inspector').onclick = () => showInspector(true);
document.addEventListener('pointerdown', () => { pointerHeld = true; });
document.addEventListener('pointerup', () => { pointerHeld = false; });
document.addEventListener('pointercancel', () => { pointerHeld = false; });
document.addEventListener('click', event => {
  const node = event.target.closest('[data-tech-detail]');
  if (node) { selectTech(node.dataset.techDetail); if (!event.target.closest('button')) return; }
  const b = event.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.faction !== undefined) { selectedFaction = Number(b.dataset.faction); updateFactionChoice(); return; }
  if (b.dataset.city) { const city = state.cities.find(c => c.id === Number(b.dataset.city)); selection = { kind: 'city', id: city.id }; orderMode = false; engineerMode = null; view.closeStack(); showInspector(true); view.focus(state.tiles[city.tile]); refresh(); }
  if (b.dataset.unit) {
    const unit = state.units.find(u => u.id === Number(b.dataset.unit)); selection = { kind: 'unit', id: unit.id }; orderMode = false; engineerMode = null;
    if (state.units.filter(u => u.tile === unit.tile).length > 1) view.openStack(unit.tile, unit.id); else view.closeStack();
    refresh();
  }
  if (b.dataset.productionTab) { productionTab = b.dataset.productionTab; refresh(); }
  if (b.dataset.produce) send({ type: 'produce', cityId: Number(b.dataset.cityId), item: b.dataset.produce }, '生产已开工，费用已扣除。');
  if (b.dataset.cancel) send({ type: 'cancel', cityId: Number(b.dataset.cancel) }, '生产已取消，返还50%费用。');
  if (b.dataset.tech) { selectedTech = b.dataset.tech; if (send({ type: 'research', tech: b.dataset.tech }, '研究已安排；按空格继续战役。')) researchPanel(); }
  if (b.hasAttribute('data-order')) { engineerMode = null; orderMode = !orderMode; refresh(); }
  if (b.dataset.engineer) { orderMode = false; engineerMode = engineerMode === b.dataset.engineer ? null : b.dataset.engineer; refresh(); }
  if (b.dataset.hold) { orderMode = false; engineerMode = null; send({ type: 'hold', unitId: Number(b.dataset.hold) }, '部队原地防御。'); }
  if (b.dataset.found) { if (send({ type: 'found', unitId: Number(b.dataset.found) }, '新城已建立，补给范围已更新。')) { selection = { kind: 'city', id: state.cities.at(-1).id }; refresh(); } }
  if (b.dataset.speed) { state.speed = Number(b.dataset.speed); accumulator = 0; lastFrame = null; refresh(); }
  if (b.hasAttribute('data-guide')) { setPaused(true); showGuide(view); }
  if (b.hasAttribute('data-save')) { const result = saveGame(state); $('menu-message').textContent = result.ok ? `已保存 · ${clock(state.time)} · 单槽存档已更新。` : result.reason; }
  if (b.hasAttribute('data-load')) load();
  if (b.hasAttribute('data-new')) modal('重新开始', `<p class="description">未保存的战役进度将丢失；现有本地存档不会被删除。每次开始都会随机生成新的北境战区。</p>${factionPicker()}<button data-new-confirm class="primary">确认开始新战役</button>`);
  if (b.hasAttribute('data-new-confirm')) { replaceGame(createGame(randomSeed(), selectedFaction)); setPaused(false); }
});
$('map').addEventListener('pointerdown', event => { if (event.button !== 0 && event.button !== 1) return; drag = { x: event.clientX, y: event.clientY, cx: view.camera.x, cy: view.camera.y, moved: false, button: event.button }; $('map').setPointerCapture(event.pointerId); });
$('map').addEventListener('pointermove', event => {
  const rect = $('map').getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  view.hoverBubble = view.pickBubble(x, y); view.hover = view.hoverBubble === null ? view.pick(state, x, y) : null;
  $('map').style.cursor = view.hoverBubble !== null ? 'pointer' : '';
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  if (drag.moved) { view.camera.x = drag.cx - dx / view.camera.zoom; view.camera.y = drag.cy - dy / view.camera.zoom; }
});
$('map').addEventListener('pointerup', event => {
  if (drag && !drag.moved && drag.button === 0) {
    const rect = $('map').getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const bubbleId = view.pickBubble(x, y);
    if (bubbleId !== null) {
      const unit = state.units.find(u => u.id === bubbleId);
      if (unit) { selection = { kind: 'unit', id: unit.id }; orderMode = false; engineerMode = null; view.openStack(unit.tile, unit.id); showInspector(true); refresh(); }
    } else choose(view.pick(state, x, y));
  }
  drag = null;
});
$('map').addEventListener('pointercancel', () => { drag = null; });
$('map').addEventListener('contextmenu', event => { event.preventDefault(); const rect = $('map').getBoundingClientRect(); const tile = view.pick(state, event.clientX - rect.left, event.clientY - rect.top); if (engineerMode) issueEngineering(tile); else issueOrder(tile); });
$('map').addEventListener('wheel', event => { event.preventDefault(); const r = $('map').getBoundingClientRect(); view.zoom(Math.exp(-event.deltaY * .0015), event.clientX - r.left, event.clientY - r.top); }, { passive: false });
$('minimap').addEventListener('click', event => { const r = $('minimap').getBoundingClientRect(), t = view.miniTransform; view.camera.x = (event.clientX - r.left - t.ox) / t.scale; view.camera.y = (event.clientY - r.top - t.oy) / t.scale; });
document.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-tech-detail]') && $('modal').open) {
    event.preventDefault(); selectTech(event.target.dataset.techDetail); return;
  }
  if (event.key === 'Escape' && !$('modal').open) { clearSelection(); }
  if (event.code === 'Space' && !event.repeat && !$('modal').open && started && !state.outcome) { event.preventDefault(); setPaused(!state.paused); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && started && !state.outcome) { setPaused(true); drag = null; pointerHeld = false; toast('切换到后台，战役已自动暂停。'); }
});
function render(now) {
  const delta = lastFrame === null ? 0 : (now - lastFrame) / 1000; lastFrame = now;
  if (delta > 0.5 && started && !state.paused) { setPaused(true); toast('窗口长时间未刷新，战役已暂停，未补算离线时间。'); }
  if (started && !state.paused && !state.outcome) {
    accumulator += Math.min(delta, 0.25) * state.speed;
    while (accumulator + 1e-8 >= STEP && !state.paused && !state.outcome) { step(state); updateAI(state); accumulator -= STEP; }
  } else accumulator = 0;
  if (!pointerHeld && now - lastUI >= 200) { refresh(); lastUI = now; }
  if (state.outcome && !resultShown) resultPanel();
  view.draw(state, selection); requestAnimationFrame(render);
}
refresh(); updateFactionChoice(); requestAnimationFrame(render);
$('start').disabled = false; $('start').textContent = '进入北境战区'; $('load-status').textContent = '战区已就绪 · 左键选择 / 右键下令 / 空格暂停';
