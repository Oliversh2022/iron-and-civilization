import { FACTIONS, RESOURCES, TERRAIN, UNITS, BUILDINGS, TECHS } from './config.js';
import { computeSupply, distance, movementCost } from './world.js';

const R = 38, Y = 0.82, SQRT3 = Math.sqrt(3);
const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
// 棋盘色板与笔触参数：压低明度和饱和，贴近棋子的旧石板/橄榄绿/黄铜气质；只影响绘制，不参与规则与坐标。
const BOARD = {
  void: '#112126',
  seam: '#0a161a45', bevelLight: '#e2d0a314', bevelShade: '#08121632',
  washLight: '#e3d3ab10', washShade: '#0b191f26',
  coast: '#bcae8454', rimDark: '#091417', rimLight: '#c3a97738',
};
export const $ = id => document.getElementById(id);
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clock = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export const costText = cost => Object.entries(cost).map(([key, value]) => `${RESOURCES[key]} ${value}`).join(' · ');
export function icon(name) {
  const paths = {
    food: '<path d="M12 22V3m0 7C5 10 5 5 5 5s7 0 7 5Zm0 6c-7 0-7-5-7-5s7 0 7 5Zm0-3c7 0 7-5 7-5s-7 0-7 5Zm0 6c7 0 7-5 7-5s-7 0-7 5Z"/>',
    industry: '<path d="M3 21V11l6-4v5l6-4v13Zm12 0V4h5v17M6 16h1m3 0h1m-5 3h1m3 0h1"/>',
    science: '<path d="M9 3h6m-5 0v7L4 19q-1 2 2 2h12q3 0 2-2l-6-9V3M7 15h10"/><circle cx="10" cy="17" r=".7"/>',
    manpower: '<circle cx="12" cy="6" r="3"/><path d="M6 22v-5a6 6 0 0 1 12 0v5M3 12a3 3 0 0 0-1 6m19-6a3 3 0 0 1 1 6"/>',
    infantry: '<path d="m4 20 15-15m-2-2 4 4M7 13l4 4M4 18l2 2M9 11l4 4"/>',
    artillery: '<circle cx="8" cy="17" r="4"/><path d="M8 17 20 4M5 12l6 5m-1 0 10 4M16 6l3 3"/>',
    tank: '<rect x="3" y="15" width="18" height="6" rx="3"/><path d="M6 15v-5h11l3 5M12 10V7h5V5h7M7 18h10"/>',
    supply: '<path d="M3 7h13v12H3Zm13 5h4l3 4v3h-7M7 3v8m-3-4h6"/><circle cx="7" cy="20" r="2"/><circle cx="19" cy="20" r="2"/>',
    engineer: '<path d="M4 20h16M7 20v-5a5 5 0 0 1 10 0v5M5 10h14M12 3v7m-3-4h6M8 12l-4 8m14-8 4 8"/>',
    town: '<path d="M3 21V10h6v11m0 0V4h7v17m0 0V12h5v9M6 13v2m6-8v2m0 3v2m0 3v2m7-4v2"/>',
    fortress: '<path d="M4 21V8h4V4h4v4h4V4h4v4h2v13M4 13h18M8 13v3m5-3v3m5-3v3M10 21v-5h6v5"/>',
  };
  return `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.town}</svg>`;
}
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function polygon(ctx, points, fill, stroke) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}
function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
}
function box(ctx, x, y, w, d, h, color = '#a1a38b') {
  polygon(ctx, [[x, y], [x + w, y + w * .45], [x + w, y + w * .45 - h], [x, y - h]], '#767d70');
  polygon(ctx, [[x + w, y + w * .45], [x + w + d, y + (w - d) * .45], [x + w + d, y + (w - d) * .45 - h], [x + w, y + w * .45 - h]], '#4c5a56');
  polygon(ctx, [[x, y - h], [x + w, y + w * .45 - h], [x + w + d, y + (w - d) * .45 - h], [x + d, y - d * .45 - h]], color);
  ctx.fillStyle = '#d4c48a';
  for (let i = 5; i < w - 2; i += 9) ctx.fillRect(x + i, y + i * .45 - h + 6, 3, 5);
}
function makeSprite(type) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 220;
  const c = canvas.getContext('2d'); c.translate(128, 150); c.lineWidth = 1;
  const rng = random(type.length * 21877 + type.charCodeAt(0));
  if (type === 'forest') {
    const trees = Array.from({ length: 12 }, () => ({ x: rng() * 140 - 70, y: rng() * 48 - 24, h: 42 + rng() * 35 })).sort((a, b) => a.y - b.y);
    for (const t of trees) {
      c.fillStyle = '#514c37'; c.fillRect(t.x - 2, t.y - 25, 4, 28);
      for (let i = 0; i < 3; i++) {
        const by = t.y - i * t.h * .19, w = 21 - i * 4;
        polygon(c, [[t.x - w, by], [t.x, by - t.h * .62], [t.x + w, by]], '#2c493e');
        polygon(c, [[t.x - w, by], [t.x, by - t.h * .62], [t.x - 2, by - 3]], ['#668160', '#728962', '#82936b'][i]);
        polygon(c, [[t.x - w + 3, by - 2], [t.x - 1, by - t.h * .47], [t.x - 7, by - 4]], '#56744f');
      }
    }
  } else if (type === 'mountain') {
    ellipse(c, 14, 8, 84, 24, '#26383250');
    for (const [x, y, h, w] of [[-39, -12, 76, 43], [22, -4, 119, 61], [60, 15, 54, 40], [-40, 21, 47, 47]]) {
      polygon(c, [[x - w, y], [x - 9, y - h], [x + w, y]], '#949581');
      polygon(c, [[x - 9, y - h], [x + 11, y - h * .46], [x + w, y], [x - 4, y - 4]], '#58665e');
      polygon(c, [[x - 9, y - h], [x - 23, y - h * .62], [x - 8, y - h * .72], [x + 3, y - h * .62]], '#c2bda0');
      c.strokeStyle = '#c5b99a60'; c.beginPath(); c.moveTo(x - 16, y - h * .58); c.lineTo(x - w * .7, y - 7); c.stroke();
    }
  } else if (type === 'fortress') {
    ellipse(c, 8, 13, 83, 24, '#17292450');
    polygon(c, [[-78, 6], [-30, -20], [72, 4], [25, 30]], '#7c81706a');
    box(c, -66, 0, 116, 22, 34, '#8f9582');
    for (const x of [-70, -25, 25, 55]) {
      box(c, x, -2, 22, 15, 55, '#a7a58d');
      for (const offset of [0, 7, 14]) box(c, x + offset, -9 + offset * .45, 6, 4, 13, '#b9b399');
    }
    box(c, -15, 12, 30, 12, 43, '#777f70');
    c.fillStyle = '#263934'; c.fillRect(-7, 25, 14, 30);
    c.strokeStyle = '#c6a56a'; c.lineWidth = 3; c.beginPath(); c.moveTo(42, -56); c.lineTo(42, -88); c.stroke();
    polygon(c, [[42, -89], [68, -80], [42, -70]], '#9f6655');
  } else if (type === 'town' || type === 'capital') {
    ellipse(c, 11, 12, 89, 29, '#17292450');
    polygon(c, [[-91, -7], [-12, -49], [91, 0], [18, 40]], '#7c81706a');
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const x = -70 + i * 41 + j * 11, y = -16 + j * 16 - i * 7;
      box(c, x, y, 20, 15, 16 + rng() * 17, rng() > .5 ? '#b3ad8c' : '#939a89');
    }
    box(c, 29, -15, 35, 21, 27, '#879086'); box(c, 64, -10, 7, 7, 69, '#a19c87');
    if (type === 'capital') {
      box(c, -26, 2, 44, 30, 47, '#c5bda0');
      c.fillStyle = '#465d59'; c.beginPath(); c.ellipse(11, -55, 22, 20, 0, Math.PI, Math.PI * 2); c.fill();
      ellipse(c, 11, -55, 22, 8, '#a8ac93');
      c.strokeStyle = '#c6a56a'; c.lineWidth = 3; c.beginPath(); c.moveTo(11, -76); c.lineTo(11, -95); c.stroke();
      polygon(c, [[10, -98], [15, -91], [10, -85], [5, -91]], '#d3b97e');
      for (let i = 0; i < 4; i++) box(c, -19 + i * 9, 8 + i * 4, 3, 2, 30, '#d2cbb1');
    } else { box(c, -20, 8, 28, 21, 44, '#c5baa0'); box(c, -13, -29, 8, 7, 25, '#b1ad91'); }
  } else if (type === 'engineer') {
    for (const [x, y] of [[0, -25], [-34, -4], [34, 1]]) {
      ellipse(c, x + 9, y + 4, 18, 7, '#13232455');
      c.strokeStyle = '#263735'; c.lineWidth = 7; c.beginPath(); c.moveTo(x - 4, y - 20); c.lineTo(x - 9, y + 1); c.moveTo(x + 4, y - 20); c.lineTo(x + 9, y + 1); c.stroke();
      box(c, x - 9, y - 19, 15, 7, 22, '#87947a');
      ellipse(c, x + 1, y - 48, 8, 9, '#b8ad8e');
      c.fillStyle = '#c6a56a'; c.beginPath(); c.ellipse(x + 1, y - 54, 12, 5, 0, Math.PI, Math.PI * 2); c.fill(); c.fillRect(x - 10, y - 54, 22, 3);
      c.strokeStyle = '#8f6f45'; c.lineWidth = 4; c.beginPath(); c.moveTo(x + 12, y - 32); c.lineTo(x + 24, y - 65); c.stroke();
      polygon(c, [[x + 19, y - 67], [x + 30, y - 71], [x + 27, y - 59]], '#aab0a0');
    }
  } else if (type === 'infantry') {
    for (const [x, y] of [[0, -28], [-36, -8], [35, -1], [-12, 24]]) {
      ellipse(c, x + 10, y + 3, 19, 7, '#13232466');
      c.strokeStyle = '#263735'; c.lineWidth = 7;
      c.beginPath(); c.moveTo(x - 4, y - 22); c.lineTo(x - 9, y); c.moveTo(x + 3, y - 22); c.lineTo(x + 8, y); c.stroke();
      box(c, x - 9, y - 20, 14, 7, 23, '#8b9275');
      ellipse(c, x + 1, y - 51, 8, 9, '#b0a88a'); ellipse(c, x, y - 55, 11, 5, '#747f69');
      c.strokeStyle = '#343e36'; c.lineWidth = 4; c.beginPath(); c.moveTo(x - 11, y - 26); c.lineTo(x + 25, y - 48); c.stroke();
      c.strokeStyle = '#a9a58a'; c.lineWidth = 5; c.beginPath(); c.moveTo(x + 6, y - 38); c.lineTo(x + 17, y - 36); c.stroke();
    }
  } else if (type === 'artillery') {
    ellipse(c, 9, 13, 77, 19, '#13232460');
    c.strokeStyle = '#697966'; c.lineWidth = 9; c.beginPath(); c.moveTo(-8, -8); c.lineTo(-62, 23); c.moveTo(10, -2); c.lineTo(-26, 35); c.stroke();
    ellipse(c, -27, 3, 18, 24, '#293a36'); ellipse(c, -28, 1, 11, 17, '#8d9578'); ellipse(c, 22, 17, 17, 23, '#293a36'); ellipse(c, 22, 16, 10, 16, '#737f69');
    box(c, -30, -2, 45, 17, 22, '#a0a384');
    c.strokeStyle = '#324940'; c.lineWidth = 15; c.beginPath(); c.moveTo(1, -29); c.lineTo(73, -77); c.stroke();
    c.strokeStyle = '#a0aa8d'; c.lineWidth = 8; c.beginPath(); c.moveTo(-1, -33); c.lineTo(69, -80); c.stroke();
    ellipse(c, 73, -79, 9, 7, '#283e35');
  } else if (type === 'tank') {
    ellipse(c, 8, 14, 86, 23, '#14262460');
    box(c, -79, 4, 107, 24, 24, '#2c3a36'); box(c, -55, -15, 109, 20, 25, '#2b3a34');
    for (let i = 0; i < 10; i++) { c.strokeStyle = '#858b72'; c.beginPath(); c.moveTo(-77 + i * 10, 6 + i * 4.5); c.lineTo(-76 + i * 10, -8 + i * 4.5); c.stroke(); }
    box(c, -68, -2, 104, 33, 30, '#989e7e'); box(c, -30, -31, 44, 26, 26, '#adb18d');
    ellipse(c, 6, -54, 15, 7, '#717e67');
    c.lineWidth = 12; c.strokeStyle = '#495e4c'; c.beginPath(); c.moveTo(28, -46); c.lineTo(100, -76); c.stroke();
    c.lineWidth = 4; c.strokeStyle = '#b5b391'; c.beginPath(); c.moveTo(28, -50); c.lineTo(101, -80); c.stroke();
  }
  return canvas;
}
// 原创素材统一预加载并复用：路径与构图参数（画布仍是 256x220，保持地图尺度/锚点不变）。
const ASSET_PATHS = {
  forest: './assets/terrain/forest.png', mountain: './assets/terrain/mountain.png',
  town: './assets/cities/town.png', capital: './assets/cities/capital.png', fortress: './assets/cities/fortress.png',
  infantry: './assets/units/infantry.png', artillery: './assets/units/artillery.png', tank: './assets/units/tank.png', engineer: './assets/units/engineer.png',
};
// 地块地表贴图：预缩放后作为连续平铺 pattern，替代程序色块；同一地形跨格连续，不与棋子素材混淆。
const TILE_PATHS = {
  plain: './assets/tiles/plain.png', forest: './assets/tiles/forest.png',
  hill: './assets/tiles/hill.png', mountain: './assets/tiles/mountain.png', water: './assets/tiles/water.png',
};
const TILE_SIZE = 256;
// height: 主体在画布中的绘制高度; bottom: 主体底边在画布中的纵坐标（贴近原程序绘制的落点）。
const ASSET_FIT = {
  forest: { height: 122, bottom: 166 }, mountain: { height: 152, bottom: 180 },
  town: { height: 104, bottom: 190 }, capital: { height: 148, bottom: 190 }, fortress: { height: 126, bottom: 184 },
  infantry: { height: 96, bottom: 164 }, artillery: { height: 112, bottom: 184 }, tank: { height: 112, bottom: 190 },
  engineer: { height: 100, bottom: 170 },
};
function bakeAsset(image, fit) {
  const probe = document.createElement('canvas');
  probe.width = image.naturalWidth || image.width; probe.height = image.naturalHeight || image.height;
  const pc = probe.getContext('2d', { willReadFrequently: true });
  pc.drawImage(image, 0, 0);
  const { data } = pc.getImageData(0, 0, probe.width, probe.height);
  // 清除与透明背景相连的浅色残边，避免素材自带白色底座。
  const visited = new Uint8Array(probe.width * probe.height), queue = new Int32Array(visited.length);
  let head = 0, tail = 0;
  const enqueue = index => {
    if (visited[index]) return;
    const i = index * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    if (data[i + 3] === 0 || (r >= 232 && g >= 232 && b >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 20)) {
      visited[index] = 1; queue[tail++] = index;
    }
  };
  for (let x = 0; x < probe.width; x++) { enqueue(x); enqueue((probe.height - 1) * probe.width + x); }
  for (let y = 0; y < probe.height; y++) { enqueue(y * probe.width); enqueue(y * probe.width + probe.width - 1); }
  while (head < tail) {
    const index = queue[head++], x = index % probe.width, y = Math.floor(index / probe.width), i = index * 4;
    if (data[i + 3] !== 0) data[i + 3] = 0;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < probe.width) enqueue(index + 1);
    if (y > 0) enqueue(index - probe.width);
    if (y + 1 < probe.height) enqueue(index + probe.width);
  }
  pc.putImageData(new ImageData(new Uint8ClampedArray(data), probe.width, probe.height), 0, 0);
  let minX = probe.width, minY = probe.height, maxX = -1, maxY = -1;
  for (let y = 0; y < probe.height; y++) for (let x = 0; x < probe.width; x++) {
    if (data[(y * probe.width + x) * 4 + 3] > 24) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 220;
  const c = canvas.getContext('2d');
  const bw = maxX - minX + 1, bh = maxY - minY + 1, scale = fit.height / bh, dw = bw * scale;
  c.drawImage(image, minX, minY, bw, bh, 128 - dw / 2, fit.bottom - fit.height, dw, fit.height);
  return canvas;
}
export class View {
  constructor(canvas, minimap) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.minimap = minimap; this.mctx = minimap.getContext('2d');
    this.camera = { x: 0, y: 0, zoom: 1 }; this.grid = false; this.supply = false; this.routes = true; this.hover = null;
    this.stack = null; this.stackBubbles = []; this.hoverBubble = null;
    this.sprites = Object.fromEntries(Object.keys(ASSET_PATHS).map(name => [name, bakeAsset(makeSprite(name), ASSET_FIT[name])]));
    this.portraits = Object.fromEntries(Object.entries(this.sprites).map(([key, value]) => [key, value.toDataURL()]));
    this.assetsReady = Promise.all(Object.entries(ASSET_PATHS).map(([type, path]) => new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const sprite = bakeAsset(image, ASSET_FIT[type]);
          this.sprites[type] = sprite; this.portraits[type] = sprite.toDataURL();
        } catch (error) { console.warn(`素材 ${type} 处理失败，沿用程序绘制：`, error); }
        resolve();
      };
      image.onerror = () => { console.warn(`素材加载失败：${path}，沿用程序绘制。`); resolve(); };
      image.src = path;
    })));
    this.tileImages = {};
    this.tilesReady = Promise.all(Object.entries(TILE_PATHS).map(([type, path]) => new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const scaled = document.createElement('canvas'); scaled.width = scaled.height = TILE_SIZE;
        scaled.getContext('2d').drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE);
        this.tileImages[type] = scaled;
        resolve();
      };
      image.onerror = () => { console.warn(`地块贴图加载失败：${path}，沿用底色。`); resolve(); };
      image.src = path;
    }))).then(() => { if (this.mapState) this.buildMap(this.mapState); });
    this.resize(); new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }
  resize() {
    this.width = this.canvas.clientWidth; this.height = this.canvas.clientHeight; this.dpr = Math.min(devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.minimap.width = Math.round(this.minimap.clientWidth * this.dpr); this.minimap.height = Math.round(this.minimap.clientHeight * this.dpr);
  }
  point(tile) { return { x: SQRT3 * R * (tile.q + tile.r / 2) + R, y: 1.5 * R * tile.r * Y + R * 2 }; }
  screen(tile) { const p = this.point(tile); return { x: (p.x - this.camera.x) * this.camera.zoom + this.width / 2, y: (p.y - this.camera.y) * this.camera.zoom + this.height / 2 }; }
  focus(tile, zoom = this.camera.zoom) { Object.assign(this.camera, this.point(tile), { zoom }); }
  fit(state) { this.camera = { x: this.mapWidth / 2, y: this.mapHeight / 2, zoom: Math.min((this.width - 60) / this.mapWidth, (this.height - 130) / this.mapHeight) }; }
  zoom(factor, x = this.width / 2, y = this.height / 2) {
    const z = this.camera.zoom, next = Math.max(.3, Math.min(2, z * factor));
    this.camera.x += (x - this.width / 2) * (1 / z - 1 / next); this.camera.y += (y - this.height / 2) * (1 / z - 1 / next); this.camera.zoom = next;
  }
  pick(state, x, y) {
    const wx = (x - this.width / 2) / this.camera.zoom + this.camera.x - R;
    const wy = ((y - this.height / 2) / this.camera.zoom + this.camera.y - R * 2) / Y;
    const r = wy / (R * 1.5), q = wx / (SQRT3 * R) - r / 2;
    let a = Math.round(q), b = Math.round(r), c = Math.round(-q - r);
    const da = Math.abs(a - q), db = Math.abs(b - r), dc = Math.abs(c + q + r);
    if (da > db && da > dc) a = -b - c; else if (db > dc) b = -a - c;
    const xoff = a + Math.floor(b / 2);
    return b >= 0 && b < state.height && xoff >= 0 && xoff < state.width ? b * state.width + xoff : null;
  }
  hex(c, x, y, scale = 1) {
    c.beginPath(); for (let i = 0; i < 6; i++) { const a = (i * 60 - 30) * Math.PI / 180; const px = x + Math.cos(a) * R * scale, py = y + Math.sin(a) * R * Y * scale; i ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath();
  }
  buildMap(state) {
    this.mapState = state; this.mapVersion = state.infrastructureVersion; this.mapWidth = SQRT3 * R * (state.width + .5) + R * 2; this.mapHeight = 1.5 * R * state.height * Y + R * 3;
    this.coordIndex = new Map(state.tiles.map(t => [`${t.q},${t.r}`, t.id]));
    this.waterTiles = state.tiles.filter(t => t.terrain === 'water').map(t => t.id);
    this.ground = document.createElement('canvas'); this.ground.width = Math.ceil(this.mapWidth * 2); this.ground.height = Math.ceil(this.mapHeight * 2);
    const c = this.ground.getContext('2d'); c.scale(2, 2);
    const cx = this.mapWidth / 2, cy = this.mapHeight / 2, span = Math.hypot(cx, cy);
    const patterns = Object.fromEntries(Object.entries(this.tileImages).map(([type, image]) => [type, c.createPattern(image, 'repeat')]));
    // 第一遍：地形贴图打底（同地形跨格连续） + 统一光照与暗角，让实体棋子保持视觉焦点。
    for (const t of state.tiles) {
      const p = this.point(t), kind = TERRAIN[t.terrain];
      c.save(); this.hex(c, p.x, p.y, 1.012); c.clip(); c.fillStyle = kind.color; c.fill();
      const pattern = patterns[t.terrain];
      if (pattern) {
        c.globalAlpha = .78; c.fillStyle = pattern; c.fillRect(p.x - R, p.y - R, R * 2, R * 2); c.globalAlpha = 1;
      }
      const wash = c.createLinearGradient(p.x - R, p.y - R, p.x + R, p.y + R);
      wash.addColorStop(0, BOARD.washLight); wash.addColorStop(1, BOARD.washShade);
      c.fillStyle = wash; c.fillRect(p.x - R, p.y - R, R * 2, R * 2);
      const d = Math.hypot(p.x - cx, p.y - cy) / span;
      if (d > .42) { c.fillStyle = `rgba(5,15,19,${Math.min(.13, (d - .42) * .24)})`; c.fillRect(p.x - R, p.y - R, R * 2, R * 2); }
      c.restore();
    }
    // 第二遍：格缝、受光/背光倒角、海岸线与棋盘外框，统一保持低对比。
    for (const t of state.tiles) {
      const p = this.point(t);
      this.hex(c, p.x, p.y, 1.005); c.strokeStyle = BOARD.seam; c.lineWidth = .85; c.stroke();
      for (const i of [4, 5]) this.edge(c, p, i, BOARD.bevelLight, .9);
      for (const i of [1, 2]) this.edge(c, p, i, BOARD.bevelShade, 1.1);
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = DIRS[i], id = this.coordIndex.get(`${t.q + dq},${t.r + dr}`);
        if (id === undefined) {
          this.edge(c, p, i, BOARD.rimDark, 3.4);
          this.edge(c, p, i, BOARD.rimLight, 1);
        } else if (t.terrain === 'water' && state.tiles[id].terrain !== 'water') {
          this.edge(c, p, i, BOARD.coast, 2.4);
        }
      }
    }
  }
  edge(c, p, i, color, width) {
    const a = (i * 60 - 30) * Math.PI / 180, b = a + Math.PI / 3;
    c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R * Y); c.lineTo(p.x + Math.cos(b) * R, p.y + Math.sin(b) * R * Y); c.stroke();
  }
  openStack(tile, unitId) { this.stack = { tile, unitId, openedAt: performance.now() }; }
  closeStack() { this.stack = null; this.stackBubbles = []; this.hoverBubble = null; }
  pickBubble(x, y) {
    for (let i = this.stackBubbles.length - 1; i >= 0; i--) {
      const bubble = this.stackBubbles[i];
      if (Math.hypot(x - bubble.x, y - bubble.y) <= bubble.r + 5) return bubble.id;
    }
    return null;
  }
  drawWater(c, visible, time) {
    const image = this.tileImages.water;
    if (!image) return;
    if (!this.waterPatterns) this.waterPatterns = [c.createPattern(image, 'repeat'), c.createPattern(image, 'repeat')];
    for (const tile of visible) {
      if (tile.terrain !== 'water') continue;
      const p = this.point(tile);
      c.save(); this.hex(c, p.x, p.y, 1.014); c.clip();
      c.globalCompositeOperation = 'screen';
      for (let layer = 0; layer < 2; layer++) {
        const direction = layer ? -1 : 1;
        const dx = direction * (time * (layer ? 5.4 : 8)) % TILE_SIZE;
        const dy = Math.sin(time * (layer ? .31 : .24) + layer * 2) * 18;
        this.waterPatterns[layer].setTransform(new DOMMatrix().translate(dx, dy));
        c.globalAlpha = layer ? .065 : .115; c.fillStyle = this.waterPatterns[layer];
        c.fillRect(p.x - R, p.y - R, R * 2, R * 2);
      }
      c.globalAlpha = 1; c.lineWidth = .72;
      for (let band = 0; band < 4; band++) {
        c.beginPath();
        for (let x = -R - 8; x <= R + 8; x += 5) {
          const gx = p.x + x;
          const y = p.y - 27 + band * 17 + Math.sin(time * 1.1 + gx * .045 + band * 1.3) * 1.7
            + Math.sin(gx * .13 - time * 1.55 + band * 1.4) * 1.4;
          x === -R - 8 ? c.moveTo(gx, y) : c.lineTo(gx, y);
        }
        c.strokeStyle = `rgba(178,216,220,${.05 + .022 * Math.sin(time * 1.1 + band + p.y * .06)})`;
        c.stroke();
      }
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
      c.setLineDash([7, 11]); c.lineDashOffset = -time * 5;
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = DIRS[i], id = this.coordIndex.get(`${tile.q + dq},${tile.r + dr}`);
        if (id !== undefined && this.mapState.tiles[id].terrain !== 'water') this.edge(c, p, i, '#c4e0dc38', 1.15);
      }
      c.setLineDash([]); c.restore();
    }
  }
  drawInfrastructure(c, state, visible, z) {
    for (const tile of visible) {
      if (!tile.road) continue;
      const p = this.point(tile), color = FACTIONS[tile.road.owner].color;
      c.save();
      if (tile.road.kind === 'bridge') {
        c.translate(p.x, p.y); c.rotate(-.12);
        c.fillStyle = '#182b30'; c.fillRect(-R * .76, -10, R * 1.52, 20);
        c.fillStyle = '#8f8065'; c.fillRect(-R * .7, -7, R * 1.4, 14);
        c.strokeStyle = '#4e5147'; c.lineWidth = 1.4 / z;
        for (let x = -R * .65; x < R * .7; x += 8) { c.beginPath(); c.moveTo(x, -7); c.lineTo(x, 7); c.stroke(); }
        c.strokeStyle = color; c.lineWidth = 2 / z; c.beginPath(); c.moveTo(-R * .72, -8); c.lineTo(R * .72, -8); c.moveTo(-R * .72, 8); c.lineTo(R * .72, 8); c.stroke();
      } else {
        const links = [];
        for (let i = 0; i < 6; i++) {
          const [dq, dr] = DIRS[i], id = this.coordIndex.get(`${tile.q + dq},${tile.r + dr}`);
          if (id !== undefined && state.tiles[id].road) {
            const angle = i * Math.PI / 3;
            links.push([p.x + Math.cos(angle) * R * .9, p.y + Math.sin(angle) * R * Y * .9]);
          }
        }
        if (!links.length) links.push([p.x - R * .7, p.y], [p.x + R * .7, p.y]);
        c.lineCap = 'round';
        for (const [x, y] of links) {
          c.strokeStyle = '#17282bd9'; c.lineWidth = 11 / z; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(x, y); c.stroke();
          c.strokeStyle = color; c.lineWidth = 6 / z; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(x, y); c.stroke();
          c.strokeStyle = '#e7dec06b'; c.lineWidth = 1.2 / z; c.setLineDash([5 / z, 8 / z]); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
        }
      }
      c.restore();
    }
    for (const unit of state.units) {
      if (!unit.work) continue;
      const tile = state.tiles[unit.work.tile], p = this.point(tile), progress = 1 - unit.work.remaining / unit.work.duration;
      c.save(); this.hex(c, p.x, p.y, .9); c.strokeStyle = '#e5c680'; c.lineWidth = 2 / z; c.stroke();
      c.strokeStyle = '#13242b'; c.lineWidth = 5 / z; c.beginPath(); c.arc(p.x, p.y, 20 / z, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#e5c680'; c.lineWidth = 3 / z; c.beginPath(); c.arc(p.x, p.y, 20 / z, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); c.stroke();
      c.restore();
    }
  }
  routeCurve(points) {
    const path = new Path2D(), segments = [], samples = [{ ...points[0], d: 0 }];
    path.moveTo(points[0].x, points[0].y);
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], a = points[i], d = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const b = { x: a.x + (d.x - p0.x) / 7, y: a.y + (d.y - p0.y) / 7 };
      const c = { x: d.x - (p3.x - a.x) / 7, y: d.y - (p3.y - a.y) / 7 };
      const segment = { a, b, c, d };
      segments.push(segment); path.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
      let previous = a;
      for (let step = 1; step <= 24; step++) {
        const point = this.routeSegmentPoint(segment, step / 24);
        length += Math.hypot(point.x - previous.x, point.y - previous.y);
        samples.push({ ...point, d: length }); previous = point;
      }
    }
    return { path, segments, samples, length };
  }
  routeSegmentPoint(segment, t) {
    const k = 1 - t;
    return {
      x: k ** 3 * segment.a.x + 3 * k ** 2 * t * segment.b.x + 3 * k * t ** 2 * segment.c.x + t ** 3 * segment.d.x,
      y: k ** 3 * segment.a.y + 3 * k ** 2 * t * segment.b.y + 3 * k * t ** 2 * segment.c.y + t ** 3 * segment.d.y,
    };
  }
  routePoint(route, distance) {
    let low = 0, high = route.samples.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (route.samples[middle].d < distance) low = middle + 1; else high = middle;
    }
    const b = route.samples[low], a = route.samples[Math.max(0, low - 1)];
    const t = Math.max(0, Math.min(1, (distance - a.d) / (b.d - a.d || 1)));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  drawRoutes(c, state, selectedUnit, time) {
    const z = this.camera.zoom;
    for (const unit of state.units) {
      if (!unit.path.length) continue;
      const selected = unit.id === selectedUnit?.id;
      const points = [unit.tile, ...unit.path].map(id => this.point(state.tiles[id]));
      const route = this.routeCurve(points), color = unit.owner === 0 ? '#8edce5' : '#df8b7d';
      const width = (selected ? 15 : 9) / z;
      const headLength = Math.min((selected ? 34 : 26) / z, route.length * .58);
      const headWidth = Math.min((selected ? 34 : 25) / z, headLength * 1.3);
      const end = points.at(-1), base = this.routePoint(route, route.length - headLength * .72);
      const nx = -Math.sin(base.angle), ny = Math.cos(base.angle);
      const head = [
        [base.x + nx * headWidth / 2, base.y + ny * headWidth / 2],
        [end.x, end.y],
        [base.x - nx * headWidth / 2, base.y - ny * headWidth / 2],
      ];
      c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
      c.globalAlpha = selected ? .96 : .46;
      c.shadowColor = color; c.shadowBlur = (selected ? 12 : 5) * z;
      c.strokeStyle = '#071820e8'; c.lineWidth = width + 5 / z; c.stroke(route.path);
      c.strokeStyle = color; c.lineWidth = width; c.stroke(route.path);
      c.shadowBlur = 0;
      c.setLineDash([19 / z, 29 / z]); c.lineDashOffset = -time * 34 / z;
      c.globalAlpha = selected ? .78 : .38; c.strokeStyle = '#efffff'; c.lineWidth = width * .46; c.stroke(route.path);
      c.setLineDash([]);
      const spacing = (selected ? 92 : 110) / z, offset = (time * 28 / z) % spacing;
      c.globalAlpha = selected ? .92 : .5; c.strokeStyle = '#f2ffff'; c.lineWidth = 3.4 / z;
      for (let d = offset; d < route.length - headLength; d += spacing) {
        const p = this.routePoint(route, d), size = 9 / z;
        c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
        c.beginPath(); c.moveTo(-size * .55, -size * .78); c.lineTo(size * .6, 0); c.lineTo(-size * .55, size * .78); c.stroke();
        c.restore();
      }
      polygon(c, head.map(([x, y]) => [x + nx * 2.5 / z, y + ny * 2.5 / z]), '#071820e8');
      polygon(c, head, color);
      const shineBase = this.routePoint(route, route.length - headLength * .36);
      const shine = [
        [shineBase.x + nx * headWidth * .22, shineBase.y + ny * headWidth * .22],
        [end.x, end.y],
        [shineBase.x - nx * headWidth * .22, shineBase.y - ny * headWidth * .22],
      ];
      c.globalAlpha = selected ? .55 : .25; polygon(c, shine, '#f2ffff');
      const duration = UNITS[unit.type].moveTime * movementCost(state, unit.path[0])
        / (this.supplied(state, unit.owner).has(unit.tile) ? 1 : .6)
        * (state.factions[unit.owner].techs.includes('mobility') ? .85 : 1);
      const progress = Math.max(0, Math.min(1, unit.progress / duration));
      if (progress > 0) {
        const progressDistance = route.samples[24].d * progress, point = this.routePoint(route, progressDistance);
        c.globalAlpha = 1; c.strokeStyle = '#f4ffff'; c.lineWidth = width * .38; c.beginPath(); c.moveTo(points[0].x, points[0].y);
        for (let step = 1; step <= Math.floor(progress * 24); step++) {
          const p = this.routePoint(route, progressDistance * step / 24); c.lineTo(p.x, p.y);
        }
        c.lineTo(point.x, point.y); c.stroke();
        c.shadowColor = '#c9ffff'; c.shadowBlur = 10 * z; ellipse(c, point.x, point.y, 3.5 / z, 3.5 / z, '#f4ffff'); c.shadowBlur = 0;
      }
      const pulse = 8 + Math.sin(time * 4 + unit.id) * 1.4;
      c.globalAlpha = selected ? .72 : .28; c.strokeStyle = color; c.lineWidth = 1.7 / z;
      c.beginPath(); c.ellipse(end.x, end.y, pulse / z, pulse * Y / z, 0, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
  }
  drawStackBubbles(state, selection, groups) {
    this.stackBubbles = [];
    if (!this.stack || selection?.kind !== 'unit') return;
    const list = groups.get(this.stack.tile);
    const anchor = state.units.find(u => u.id === selection.id && u.tile === this.stack.tile);
    if (!anchor || !list || list.length < 2) { this.closeStack(); return; }
    const others = list.filter(u => u.id !== anchor.id);
    const base = this.screen(state.tiles[anchor.tile]);
    const city = state.cities.some(city => city.tile === anchor.tile);
    base.y += (city ? 17 : 0) * this.camera.zoom; base.x -= (city ? 12 : 0) * this.camera.zoom;
    const c = this.ctx, time = performance.now(), radius = 22;
    const opening = Math.min(1, (time - this.stack.openedAt) / 240), ease = 1 - (1 - opening) ** 3;
    others.forEach((unit, i) => {
      const angle = -Math.PI / 2 + (i - (others.length - 1) / 2) * Math.min(.72, 2.5 / Math.max(1, others.length));
      const distance = 70 + Math.floor(i / 5) * 24;
      const target = { x: base.x + Math.cos(angle) * distance, y: base.y + Math.sin(angle) * distance - 8 };
      const x = base.x + (target.x - base.x) * ease, y = base.y + (target.y - base.y) * ease + Math.sin(time / 480 + i) * 1.5;
      const color = FACTIONS[unit.owner].color, hovered = this.hoverBubble === unit.id;
      c.save(); c.globalAlpha = ease;
      c.strokeStyle = `${color}70`; c.lineWidth = 1; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(base.x, base.y); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
      c.shadowColor = '#000a'; c.shadowBlur = hovered ? 15 : 8; c.fillStyle = hovered ? '#29434c' : '#10242cf2';
      c.beginPath(); c.arc(x, y, radius * (.7 + .3 * ease), 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
      c.strokeStyle = hovered ? '#f2d79d' : color; c.lineWidth = hovered ? 2.5 : 1.8; c.stroke();
      c.fillStyle = color; c.font = 'bold 17px "Microsoft YaHei",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(UNITS[unit.type].short, x, y - 2);
      c.fillStyle = '#dce5df'; c.font = '9px sans-serif'; c.fillText(`#${unit.id}`, x, y + 13);
      c.fillStyle = '#08171d'; c.fillRect(x - 14, y + radius - 3, 28, 2);
      c.fillStyle = color; c.fillRect(x - 14, y + radius - 3, 28 * unit.hp / UNITS[unit.type].hp, 2);
      c.restore();
      this.stackBubbles.push({ id: unit.id, x, y, r: radius });
    });
    c.textBaseline = 'alphabetic';
  }
  supplied(state, owner) {
    const key = `${state.territoryVersion}:${state.infrastructureVersion}:${state.factions.map(f => f.techs.join(',')).join('|')}`;
    if (this.supplyState !== state || this.supplyKey !== key) { this.supplySets = [computeSupply(state, 0), computeSupply(state, 1)]; this.supplyKey = key; this.supplyState = state; }
    return this.supplySets[owner];
  }
  contactShadow(c, x, y, rx, ry, opacity = .5) {
    c.save(); c.translate(x, y); c.scale(1, ry / rx);
    const gradient = c.createRadialGradient(0, 0, 0, 0, 0, rx);
    gradient.addColorStop(0, `rgba(3,10,12,${opacity})`);
    gradient.addColorStop(.55, `rgba(3,10,12,${opacity * .72})`);
    gradient.addColorStop(1, 'rgba(3,10,12,0)');
    c.fillStyle = gradient; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill(); c.restore();
  }
  sprite(c, type, x, y, width) {
    const image = this.sprites[type], bottom = ASSET_FIT[type].bottom, height = width * 220 / 256;
    c.drawImage(image, x - width / 2, y - bottom / 256 * width, width, height);
  }
  flag(c, x, y, owner) {
    c.strokeStyle = '#e3d7b0'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 31); c.stroke();
    const color = owner < 0 ? '#c6a56a' : FACTIONS[owner].color;
    polygon(c, [[x, y - 31], [x + 20, y - 28], [x + 19, y - 14], [x, y - 16]], color);
    c.fillStyle = '#122730'; c.font = 'bold 11px Georgia'; c.textAlign = 'center'; c.fillText(owner === 0 ? 'Ⅰ' : owner === 1 ? 'Ⅱ' : '·', x + 9, y - 19);
  }
  label(c, text, x, y, color = '#e9e3d4', size = 12) {
    c.font = `${size}px "Microsoft YaHei",sans-serif`; c.textAlign = 'center'; const w = c.measureText(text).width;
    c.fillStyle = '#10212de8'; c.fillRect(x - w / 2 - 7, y - size + 1, w + 14, size + 8); c.fillStyle = color; c.fillText(text, x, y + 1);
  }
  draw(state, selection) {
    if (this.dpr !== Math.min(devicePixelRatio || 1, 3)) this.resize();
    if (this.mapState !== state || this.mapVersion !== state.infrastructureVersion) this.buildMap(state);
    const c = this.ctx, z = this.camera.zoom, time = performance.now() / 1000;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = BOARD.void; c.fillRect(0, 0, this.width, this.height);
    c.save(); c.translate(this.width / 2, this.height / 2); c.scale(z, z); c.translate(-this.camera.x, -this.camera.y);
    c.shadowColor = 'rgba(3,10,13,.72)'; c.shadowBlur = 40; c.shadowOffsetY = 14; c.drawImage(this.ground, 0, 0, this.mapWidth, this.mapHeight); c.shadowBlur = 0; c.shadowOffsetY = 0;
    const selectedUnit = selection?.kind === 'unit' ? state.units.find(u => u.id === selection.id) : null;
    const selectedCity = selection?.kind === 'city' ? state.cities.find(city => city.id === selection.id) : null;
    const selectedTile = selectedUnit?.tile ?? selectedCity?.tile ?? (selection?.kind === 'tile' ? selection.id : null);
    const visible = state.tiles.filter(t => { const p = this.screen(t); return p.x > -120 && p.x < this.width + 120 && p.y > -80 && p.y < this.height + 150; });
    this.drawWater(c, visible, time);
    for (const t of visible) {
      const p = this.point(t);
      if (t.owner >= 0) {
        this.hex(c, p.x, p.y); c.fillStyle = `${FACTIONS[t.owner].color}13`; c.fill();
        for (let i = 0; i < 6; i++) { const [dq, dr] = DIRS[i], id = this.coordIndex.get(`${t.q + dq},${t.r + dr}`); if (id === undefined || state.tiles[id].owner !== t.owner) this.edge(c, p, i, `${FACTIONS[t.owner].color}c9`, 2 / Math.sqrt(z)); }
      }
      if (this.supply && this.supplied(state, state.playerFaction).has(t.id)) { this.hex(c, p.x, p.y, .95); c.fillStyle = '#92d2bf40'; c.fill(); }
      if (this.grid) { this.hex(c, p.x, p.y); c.strokeStyle = '#e9e3d42f'; c.lineWidth = .7 / z; c.stroke(); }
      if (selectedUnit && this.grid && distance(state, selectedUnit.tile, t.id) <= UNITS[selectedUnit.type].range) { this.hex(c, p.x, p.y, .86); c.strokeStyle = '#e4c18688'; c.lineWidth = 1 / z; c.stroke(); }
    }
    this.drawInfrastructure(c, state, visible, z);
    if (this.routes) this.drawRoutes(c, state, selectedUnit, time);
    for (const t of visible) {
      const p = this.point(t);
      if (t.id === selectedTile || t.id === this.hover) { this.hex(c, p.x, p.y, .94); c.fillStyle = t.id === selectedTile ? '#e9cc8627' : '#ffffff15'; c.fill(); c.strokeStyle = t.id === selectedTile ? '#e3c184' : '#eee3c780'; c.lineWidth = (t.id === selectedTile ? 2.2 : 1) / z; c.stroke(); }
    }
    for (const t of visible) {
      const p = this.point(t), city = state.cities.find(city => city.tile === t.id);
      if (city) {
        const spriteType = city.capitalOf !== null ? 'capital' : city.kind === 'fortress' ? 'fortress' : 'town';
        const groundY = p.y + 9, shadowWidth = city.capitalOf !== null ? 38 : city.kind === 'fortress' ? 34 : 31;
        this.contactShadow(c, p.x + 2, groundY, shadowWidth, 10, .52);
        this.sprite(c, spriteType, p.x, groundY, city.capitalOf !== null ? 90 : city.kind === 'fortress' ? 84 : 77);
        this.flag(c, p.x + 23, p.y - 27, city.owner);
      }
      else if (t.terrain === 'forest' || t.terrain === 'mountain') {
        const groundY = p.y + 9, mountain = t.terrain === 'mountain';
        this.contactShadow(c, p.x + 2, groundY, mountain ? 37 : 32, mountain ? 10 : 8, .42);
        this.sprite(c, t.terrain, p.x, groundY, mountain ? 92 : 77);
      }
    }
    const groups = new Map();
    for (const u of state.units) { if (!groups.has(u.tile)) groups.set(u.tile, []); groups.get(u.tile).push(u); }
    for (const [tile, list] of groups) {
      const u = list.find(u => u.id === selectedUnit?.id) || list[0]; const p = this.point(state.tiles[tile]);
      const city = state.cities.some(city => city.tile === tile), y = p.y + (city ? 17 : 0), x = p.x + (city ? -12 : 0), groundY = y + 3;
      this.contactShadow(c, x, groundY, 24, 8, .62);
      c.strokeStyle = selectedUnit?.id === u.id ? '#eed198' : FACTIONS[u.owner].color; c.lineWidth = 2 / z; c.beginPath(); c.ellipse(x, groundY, 23, 10, 0, 0, Math.PI * 2); c.stroke();
      if (z >= .65) this.sprite(c, u.type, x, groundY, 61);
      else { c.fillStyle = FACTIONS[u.owner].color; c.font = 'bold 19px sans-serif'; c.textAlign = 'center'; c.fillText(UNITS[u.type].short, x, y); }
    }
    c.restore();
    for (const city of state.cities) {
      const p = this.screen(state.tiles[city.tile]); if (p.x < -100 || p.x > this.width + 100 || p.y < -100 || p.y > this.height + 100) continue;
      const labelSize = city.capitalOf !== null ? 13 : 12;
      // Keep the fixed-size background at least 4px below the garrison HP bar.
      const labelY = p.y + (groups.has(city.tile) ? Math.max(43 * z, 29 * z + labelSize + 6) : 28 * z);
      const labelPrefix = city.capitalOf !== null ? '♜ ' : city.kind === 'fortress' ? '▣ ' : '';
      this.label(c, `${labelPrefix}${city.name}`, p.x, labelY, city.owner < 0 ? '#d6c393' : FACTIONS[city.owner].color, labelSize);
      if (city.hp < city.maxHp && city.owner >= 0) { c.fillStyle = '#0e1e25'; c.fillRect(p.x - 22, labelY + 11, 44, 3); c.fillStyle = FACTIONS[city.owner].color; c.fillRect(p.x - 22, labelY + 11, 44 * city.hp / city.maxHp, 3); }
      if (z >= .85) Object.entries(city.buildings).filter(([, level]) => level).forEach(([type, level], i) => {
        this.label(c, `${BUILDINGS[type].name[0]}${level}`, p.x + 43 * z, p.y + (i * 14 - 12) * z, type === 'farm' ? '#b8c59a' : type === 'factory' ? '#d2b783' : '#9ec5d0', 10);
      });
    }
    for (const [tile, list] of groups) {
      const u = list.find(u => u.id === selectedUnit?.id) || list[0], p = this.screen(state.tiles[tile]);
      const city = state.cities.some(city => city.tile === tile); p.y += (city ? 17 : 0) * z; p.x -= (city ? 12 : 0) * z;
      if (z >= .65 || selectedUnit?.id === u.id) {
        const short = `${FACTIONS[u.owner].mark} ${UNITS[u.type].short}${list.length > 1 ? ' ×' + list.length : ''}`;
        this.label(c, short, p.x, p.y - 35 * z, FACTIONS[u.owner].color, 11);
        c.fillStyle = '#102028'; c.fillRect(p.x - 17, p.y + 12 * z, 34, 3); c.fillStyle = FACTIONS[u.owner].color; c.fillRect(p.x - 17, p.y + 12 * z, 34 * u.hp / UNITS[u.type].hp, 3);
      }
      else this.label(c, `${FACTIONS[u.owner].mark}${list.length > 1 ? ' ×' + list.length : ''}`, p.x, p.y - 22 * z, FACTIONS[u.owner].color, 10);
      if (u.work && (z >= .65 || selectedUnit?.id === u.id)) this.label(c, `工程 ${Math.round((1 - u.work.remaining / u.work.duration) * 100)}%`, p.x, p.y - 50 * z, '#e5c680', 10);
      if (!this.supplied(state, u.owner).has(u.tile)) this.label(c, '断', p.x + 23 * z, p.y - 8, '#edb970', 11);
      if (u.hp < UNITS[u.type].hp * .3 && (z >= .65 || selectedUnit?.id === u.id)) this.label(c, '危', p.x - 23 * z, p.y - 8, '#efb078', 11);
    }
    if (selectedUnit?.path.length) {
      const p = this.screen(state.tiles[selectedUnit.tile]);
      const duration = UNITS[selectedUnit.type].moveTime * movementCost(state, selectedUnit.path[0])
        / (this.supplied(state, selectedUnit.owner).has(selectedUnit.tile) ? 1 : .6)
        * (state.factions[selectedUnit.owner].techs.includes('mobility') ? .85 : 1);
      this.label(c, `行军 ${Math.round(Math.min(1, selectedUnit.progress / duration) * 100)}%`, p.x + 48, p.y + 27, '#bcebef', 10);
    }
    if (selectedUnit?.order) {
      const p = this.screen(state.tiles[selectedUnit.order.tile]);
      c.strokeStyle = selectedUnit.order.kind === 'attack' ? '#efb078' : '#e5c68a'; c.lineWidth = 2;
      c.beginPath(); c.arc(p.x, p.y, 15, 0, Math.PI * 2); c.moveTo(p.x - 21, p.y); c.lineTo(p.x - 9, p.y); c.moveTo(p.x + 9, p.y); c.lineTo(p.x + 21, p.y); c.moveTo(p.x, p.y - 21); c.lineTo(p.x, p.y - 9); c.moveTo(p.x, p.y + 9); c.lineTo(p.x, p.y + 21); c.stroke();
    }
    for (const effect of state.effects) {
      const age = state.time - effect.time; if (age > .6) continue;
      const from = this.screen(state.tiles[effect.from]), to = this.screen(state.tiles[effect.to]); const k = Math.min(1, age / .25);
      c.strokeStyle = `rgba(255,217,143,${1 - age / .6})`; c.lineWidth = effect.type === 'artillery' ? 3 : 1.5;
      c.beginPath();
      if (effect.type === 'artillery') {
        const start = Math.max(0, k - .3), height = Math.max(24, Math.hypot(to.x - from.x, to.y - from.y) * .25);
        const point = t => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - 4 * height * t * (1 - t) });
        const a = point(start), b = point(k), mid = point((start + k) / 2);
        // Fit the moving trail segment to the same muzzle-to-impact parabola.
        c.moveTo(a.x, a.y); c.quadraticCurveTo((a.x + b.x) / 2, 2 * mid.y - (a.y + b.y) / 2, b.x, b.y);
      } else { c.moveTo(from.x + (to.x - from.x) * Math.max(0, k - .3), from.y + (to.y - from.y) * Math.max(0, k - .3)); c.lineTo(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k); }
      c.stroke();
      ellipse(c, from.x, from.y, 4 * (1 - k), 4 * (1 - k), '#ffe3a6'); if (k >= 1) ellipse(c, to.x, to.y, 6 + age * 12, 3 + age * 7, `rgba(188,175,146,${(.6 - age) * .7})`);
    }
    this.drawStackBubbles(state, selection, groups);
    $('zoom-label').textContent = `${Math.round(z * 100)}%`; this.drawMinimap(state);
  }
  drawMinimap(state) {
    const c = this.mctx, w = this.minimap.width / this.dpr, h = this.minimap.height / this.dpr;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = '#0f1e24'; c.fillRect(0, 0, w, h);
    const scale = Math.min((w - 12) / this.mapWidth, (h - 10) / this.mapHeight), ox = (w - this.mapWidth * scale) / 2, oy = (h - this.mapHeight * scale) / 2;
    this.miniTransform = { scale, ox, oy }; c.save(); c.translate(ox, oy); c.scale(scale, scale);
    for (const t of state.tiles) { const p = this.point(t); this.hex(c, p.x, p.y); c.fillStyle = t.owner < 0 ? TERRAIN[t.terrain].color : FACTIONS[t.owner].dark; c.fill(); }
    for (const t of state.tiles) if (t.road) { const p = this.point(t); c.strokeStyle = FACTIONS[t.road.owner].color; c.lineWidth = (t.road.kind === 'bridge' ? 4 : 2.5) / scale; c.beginPath(); c.moveTo(p.x - 9, p.y); c.lineTo(p.x + 9, p.y); c.stroke(); }
    for (const city of state.cities) {
      const p = this.point(state.tiles[city.tile]), size = city.kind === 'fortress' ? 30 : city.capitalOf !== null ? 28 : 24;
      c.fillStyle = city.owner < 0 ? '#dcc08a' : FACTIONS[city.owner].color;
      c.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      if (city.kind === 'fortress') { c.strokeStyle = '#f0d99b'; c.lineWidth = 2 / scale; c.strokeRect(p.x - size / 2, p.y - size / 2, size, size); }
    }
    c.strokeStyle = '#e3d6b6'; c.lineWidth = 1 / scale; c.strokeRect(this.camera.x - this.width / (2 * this.camera.zoom), this.camera.y - this.height / (2 * this.camera.zoom), this.width / this.camera.zoom, this.height / this.camera.zoom); c.restore();
  }
  portrait(type) { return `<div class="detail-portrait"><img src="${this.portraits[type]}" alt="${type === 'capital' ? '首都模型' : type === 'fortress' ? '要塞模型' : type === 'town' ? '城市模型' : UNITS[type]?.name || TERRAIN[type]?.name}"></div>`; }
}
export function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
export function modal(title, body, className = '') { $('modal').className = className; $('modal-title').textContent = title; $('modal-body').innerHTML = body; if (!$('modal').open) $('modal').showModal(); }

const cityListCache = new WeakMap();
export function updatePanels(state, selection, view, income = { food: 1.4, industry: 1.2, science: .7, manpower: .8 }) {
  const player = state.playerFaction, enemy = 1 - player, faction = state.factions[player];
  $('resources').innerHTML = Object.entries(RESOURCES).map(([key, name]) => `<div class="resource"><span class="resource-icon">${icon(key)}</span><div><span class="resource-label">${name}</span><strong>${Math.floor(faction.resources[key])}</strong><small>+${income[key].toFixed(1)}/秒</small></div></div>`).join('');
  const cities = state.cities.filter(c => c.owner === player), units = state.units.filter(u => u.owner === player);
  $('campaign-stats').innerHTML = `<div><strong>${cities.length}</strong><span> 座城市</span></div><div><strong>${units.length}</strong><span> 支部队</span></div>`;
  $('city-count').textContent = cities.length;
  document.querySelector('.faction-name').textContent = FACTIONS[player].name;
  document.querySelector('.faction-name').style.color = FACTIONS[player].color;
  document.querySelector('.brand>b').textContent = FACTIONS[player].mark;
  if ($('objective-title')) $('objective-title').textContent = `攻占${FACTIONS[enemy].name}首都`;
  if ($('objective-detail')) $('objective-detail').textContent = `发展工业，确保补给。让${FACTIONS[player].name}的旗帜抵达${FACTIONS[enemy].name}首都。`;
  const cityList = $('city-list');
  const cityHTML = cities.map(city => `<button class="city-card ${selection?.kind === 'city' && selection.id === city.id ? 'selected' : ''}" data-city="${city.id}"><span class="city-symbol">${city.capitalOf !== null ? '♜' : city.kind === 'fortress' ? '▣' : '▥'}</span><strong>${escapeHTML(city.name)}</strong><small>${city.production ? '正在生产 · ' + (BUILDINGS[city.production.item] || UNITS[city.production.item]).name : city.capitalOf !== null ? `${FACTIONS[player].short}首都 · 生产空闲` : city.kind === 'fortress' ? '要塞 · 生产空闲' : '直属城市 · 生产空闲'}</small>${city.production ? `<div class="mini-progress"><i style="width:${100 * (1 - city.production.remaining / city.production.duration)}%"></i></div>` : ''}</button>`).join('');
  if (cityListCache.get(cityList) !== cityHTML) {
    const focusedCity = cityList.contains(document.activeElement) ? document.activeElement.dataset.city : undefined;
    cityList.innerHTML = cityHTML;
    cityListCache.set(cityList, cityHTML);
    if (focusedCity !== undefined) cityList.querySelector(`[data-city="${CSS.escape(focusedCity)}"]`)?.focus({ preventScroll: true });
  }
  const research = faction.research;
  $('research-summary').innerHTML = research ? `<p class="description">${TECHS[research.tech].name} · ${Math.ceil(research.remaining)}秒</p><div class="progress"><i style="width:${100 * (1 - research.remaining / research.duration)}%"></i></div>` : '<p class="description">研究槽空闲，选择发展方向。</p>';
  $('game-clock').textContent = clock(state.time); $('pause').textContent = state.paused ? '继续' : '暂停';
  $('map-status').textContent = state.paused ? '战役暂停 · 可下达指令' : `实时推演 · ${state.speed}×`;
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === state.speed));
  $('latest-event').textContent = state.events.at(-1)?.text || '指挥部已就绪。';
}
export function showGuide(view) {
  modal('指挥官手册', `<div class="guide-grid"><section><h3>01 / 建设与科研</h3><p>选择己方城市，建造农场、工厂和研究所，或征召部队。每城只有一个生产槽；取消返还一半费用。科研独立计时，工业科技是装甲的前置。</p></section><section><h3>02 / 指挥与战斗</h3><p>左键选择，右键移动或攻击。也可使用右侧下令按钮。重复点击同格切换单位。可占领部队驻留占地；击破守备、清除敌军后进入城市完成占领。</p></section><section><h3>03 / 工兵与道路</h3><p>工兵行军经过无公路的平原时会自动铺路且不中断移动。也可选择工兵后点击“建设 / 改造”，再指定地块。平原铺路和清理森林各30秒，夷平丘陵60秒，架桥120秒；森林奖励科研，丘陵奖励工业。工兵可用拆除按钮摧毁敌方道路和桥梁。道路提供移速加成。</p></section><section><h3>04 / 补给与扩张</h3><p>补给从城市沿连续己方领土扩散八格，后勤与战略运输科技可分别扩展至十格和十二格。桥梁计入通路。断供降低移速和伤害；有己方驻军的补给平原可建立城市，须距其他城市至少四格。</p></section><section><h3>05 / 随机战区</h3><p>每局地图随机生成三至五条通道，每条通道设有一座中立要塞；普通中立城市不属于要塞。地形、通道与中立城市采用旋转对称布局，同距领土保持中立，双方获得对等机会。</p></section><section><h3>06 / 操作与胜负</h3><p>滚轮缩放，拖动地图。空格暂停，Esc取消选择。占领敌方首都获胜；失去己方首都失败。切至后台自动暂停。菜单提供本机单槽存读档。</p></section></div><div class="guide-units">${Object.entries(UNITS).map(([key, u]) => `<div class="guide-unit"><img src="${view.portraits[key]}" alt="${u.name}"><h3>${u.name}</h3><p>${u.hp} 生命 · 射程 ${u.range}<br>${key === 'engineer' ? '工程 · 可占领区块' : u.canCapture ? '可以占领' : '远程支援'}</p></div>`).join('')}</div>`);
}
