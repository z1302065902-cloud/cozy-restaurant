// ============================================================
// 温馨小馆 3D — Three.js 餐厅模拟经营（3D 动漫角色 + 3D 餐厅场景）
// 玩法: 顾客进店点餐 → 点击顾客制作 → 收钱 → 升级设备/解锁菜品
// 素材: Kenney CC0 家具/食物 + manneko 3D 角色（全部真实模型）
// 测试接口: window.__game_state + ?test=1&speed=4 | 三端触控
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BgmPlayer } from './bgm.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const SPEED = TEST ? (parseFloat(params.get('speed')) || 4) : 1;

// ---- 菜品（解锁顺序）----
const DISHES = [
  { name: '奶油意面', price: 8,  cook: 900,  food: 'spaghetti',  color: 0xffd6a5, unlocked: true },
  { name: '番茄浓汤', price: 12, cook: 1300, food: 'soup',       color: 0xff8fa3, unlocked: false },
  { name: '草莓甜点', price: 18, cook: 1700, food: 'cake',       color: 0xf8c9d4, unlocked: false },
  { name: '星空奶昔', price: 25, cook: 2100, food: 'coffee',     color: 0xb8e0ff, unlocked: false },
  { name: '黄金披萨', price: 35, cook: 2600, food: 'pizza',      color: 0xffe28a, unlocked: false },
];
const UPGRADES = [
  { key: 'stove', name: '灶台', desc: '制作更快', max: 5, costBase: 50 },
  { key: 'cashier', name: '收银台', desc: '接待更快', max: 5, costBase: 60 },
  { key: 'sign', name: '招牌', desc: '顾客更多', max: 5, costBase: 80 },
];

// 资源目录
const BASE = import.meta.env?.BASE_URL || './';
const ASSETS = `${BASE}assets/3d/`;
const FOOD_FILES = {
  spaghetti: 'bowl-broth.glb', soup: 'bowl-soup.glb', cake: 'cake.glb',
  coffee: 'cup-coffee.glb', pizza: 'pizza.glb',
};

// ---- 渲染器/场景 ----
const canvas = document.querySelector('canvas') || document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa5d8f0);
scene.fog = new THREE.Fog(0xa5d8f0, 30, 60);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(12, 10, 14);
camera.lookAt(0, 1.2, 0);

const loader = new GLTFLoader();
const models = {};   // 已加载模型模板
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// 灯光（暖光温馨）
scene.add(new THREE.HemisphereLight(0xfff8ec, 0x9ccb7e, 1.2));
const sun = new THREE.DirectionalLight(0xfff2d0, 1.5);
sun.position.set(10, 16, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
scene.add(sun);

function loadModel(path) {
  return loader.loadAsync(path).then(g => {
    const m = g.scene;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return m;
  }).catch(e => { console.warn('模型加载失败:', path); return null; });
}
async function ensure(name, path) {
  if (!(name in models)) models[name] = await loadModel(path);
  return models[name];
}
function place(name, x, y, z, scale = 1, rotY = 0) {
  const tpl = models[name];
  if (!tpl) return null;
  const m = tpl.clone();
  m.position.set(x, y, z);
  m.scale.setScalar(scale);
  m.rotation.y = rotY;
  m.userData.placed = true;
  scene.add(m);
  return m;
}

// ---- 游戏状态 ----
const game = {
  money: 30, fame: 0, customersServed: 0,
  upgradeLv: { stove: 1, cashier: 1, sign: 1 },
  unlockedDishes: [0],
  customers: [],          // { group, patience, maxPatience, dishIdx, state, bar }
  clickables: [],         // 可点击 3D 物体
  nextSpawn: 0, lastTime: 0,
};

// ---- 音乐/音效 ----
const bgm = new BgmPlayer();
let audioReady = false;
function ensureAudio() {
  if (!audioReady) { bgm.ensure(); bgm.play(); audioReady = true; }
}
function sfx(freq, dur = 0.15, type = 'sine') {
  try {
    const ctx = bgm.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch (e) {}
}

// ---- 测试接口 ----
if (TEST) {
  window.__game_state = {
    get hp() { return game.money; },
    get score() { return game.fame; },
    get wave() { return 1 + Math.floor(game.customersServed / 5); },
    get weapons() { return game.unlockedDishes.map(i => DISHES[i].name); },
    get enemies() { return game.customers.length; },
    get screen() { return 'game'; },
  };
}

// ---- 场景搭建（餐厅 + 锅碗瓢盆 3D）----
async function buildScene() {
  // 地板（暖木）
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.2, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9b380, roughness: 0.9 })
  );
  floor.position.set(0, -0.1, 0); floor.receiveShadow = true;
  scene.add(floor);
  // 地砖线
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xc9a06a });
  for (let i = -7; i <= 7; i += 2) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 12), lineMat);
    l.position.set(i, 0.06, 0); scene.add(l);
  }
  for (let j = -5; j <= 5; j += 2) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(16, 0.01, 0.06), lineMat);
    l.position.set(0, 0.06, j); scene.add(l);
  }
  // 后墙（奶油色）+ 窗户
  const wall = await ensure('wall', `${ASSETS}furniture/wall.glb`);
  place('wall', 0, 3, -6, 1.2, 0);
  place('wall', -8, 3, 0, 1.2, Math.PI / 2);
  place('wall', 8, 3, 0, 1.2, -Math.PI / 2);
  // 窗（浅蓝透光板模拟）
  const win = new THREE.Mesh(new THREE.BoxGeometry(4, 1.8, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.85, emissive: 0xa5d8f0, emissiveIntensity: 0.3 }));
  win.position.set(0, 3.2, -5.9); scene.add(win);

  // 家具：餐桌 + 椅子 + 沙发 + 冰箱 + 吧台 + 灶台（厨房区）
  await ensure('table', `${ASSETS}furniture/tableCloth.glb`);
  await ensure('stove', `${ASSETS}furniture/kitchenStove.glb`);
  await ensure('fridge', `${ASSETS}furniture/kitchenFridgeBuiltIn.glb`);
  await ensure('chair', `${ASSETS}furniture/chair.glb`);
  await ensure('sofa', `${ASSETS}furniture/loungeSofaOttoman.glb`);
  await ensure('bar', `${ASSETS}furniture/kitchenBarEnd.glb`);
  await ensure('lamp', `${ASSETS}furniture/lampRoundTable.glb`);

  // 厨房区（右侧）: 灶台 + 冰箱 + 吧台 + 锅碗瓢盆
  place('stove', 5.5, 0.6, -3.5, 1, -Math.PI / 2);
  place('fridge', 6.8, 0.9, -4.5, 1, -Math.PI / 2);
  place('bar', -6.5, 0.7, -4, 1.1, 0);
  // 吧台上的锅碗瓢盆（food-kit）
  await ensure('pot', `${ASSETS}food/pot.glb`);
  await ensure('pan', `${ASSETS}food/pan.glb`);
  await ensure('knife', `${ASSETS}food/knife-block.glb`);
  await ensure('plate', `${ASSETS}food/plate-rectangle.glb`);
  await ensure('panstew', `${ASSETS}food/pan-stew.glb`);
  await ensure('cup', `${ASSETS}food/cup-coffee.glb`);
  place('pot', 6.4, 1.4, -3.6, 1.1, 0);
  place('pan', 5.4, 1.35, -2.8, 1, 0);
  place('panstew', 6.0, 1.35, -3.1, 1, 0.3);
  place('knife', -5.6, 1.3, -4.2, 1, 0);
  place('plate', -5.9, 1.2, -3.8, 1, 0.2);
  place('cup', 7.0, 1.3, -3.9, 1, 0);
  // 餐桌 + 椅子（就餐区，中央两桌）
  place('table', -2, 0.7, 0.5, 1.1, 0);
  place('table', 2, 0.7, 0.5, 1.1, 0);
  place('chair', -3, 0.5, -0.8, 1, Math.PI);
  place('chair', -1, 0.5, -0.8, 1, Math.PI);
  place('chair', 1, 0.5, -0.8, 1, Math.PI);
  place('chair', 3, 0.5, -0.8, 1, Math.PI);
  place('chair', -3, 0.5, 1.8, 1, 0);
  place('chair', -1, 0.5, 1.8, 1, 0);
  place('chair', 1, 0.5, 1.8, 1, 0);
  place('chair', 3, 0.5, 1.8, 1, 0);
  // 沙发（休息区）+ 吊灯
  place('sofa', -6.5, 0.5, 2.5, 1, Math.PI / 2);
  place('lamp', 0, 2.6, -2, 1.2, 0);
  place('lamp', -4, 2.6, 2, 1.2, 0);

  // 顾客 3D 角色（manneko 动漫女孩）
  await ensure('customer', `${ASSETS}characters/manneko_low_poly_girl.glb`);
}

// ---- 顾客生成 ----
function spawnCustomer() {
  if (game.customers.length >= 6) return;
  const dishIdx = game.unlockedDishes[Math.floor(Math.random() * game.unlockedDishes.length)];
  const group = new THREE.Group();
  const model = place('customer', 7, 0, 3.2, 0.9, Math.PI);
  if (!model) return;
  // 随机换色（区分顾客）
  model.traverse(o => {
    if (o.isMesh && o.material) {
      const hue = Math.random();
      const c = new THREE.Color().setHSL(hue, 0.6, 0.75);
      o.material = o.material.clone ? o.material.clone() : o.material;
      if (o.material.color) o.material.color.copy(c);
    }
  });
  group.add(model);
  // 食物气泡（点的菜）
  const dish = DISHES[dishIdx];
  const patience = 15000 + Math.random() * 5000;
  const cust = { group, model, dishIdx, patience, maxPatience: patience, state: 'waiting', x: 7, targetX: -2 + Math.random() * 4, bar: null };
  // 耐心条（sprite）
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  barBg.position.y = 2.3; group.add(barBg);
  const barFill = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x9ccb7e }));
  barFill.position.y = 2.3; group.add(barFill);
  cust.bar = barFill;
  // 可点击
  group.userData.customer = cust;
  scene.add(group);
  game.customers.push(cust);
}

// ---- 交互（点击/触摸）----
let touchStart = null;
function onPointer(x, y) {
  pointer.x = (x / renderer.domElement.clientWidth) * 2 - 1;
  pointer.y = -(y / renderer.domElement.clientHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // 先检测顾客
  const groups = game.customers.map(c => c.group);
  const hits = raycaster.intersectObjects(groups, true);
  if (hits.length) {
    const cust = hits[0].object.userData.customer || findOwner(hits[0].object);
    if (cust && cust.state === 'waiting') { serve(cust); return; }
  }
  // 再检测升级按钮（3D 方块）
  const upHits = raycaster.intersectObjects(game.clickables, false);
  if (upHits.length) {
    const u = upHits[0].object.userData;
    if (u && u.key) { buyUpgrade(u.key); return; }
    if (u && u.dish !== undefined) { tryUnlock(u.dish); return; }
  }
  ensureAudio();  // 任意点击激活音乐
}
function findOwner(obj) {
  let o = obj;
  while (o) { if (o.userData && o.userData.customer) return o.userData.customer; o = o.parent; }
  return null;
}

renderer.domElement.addEventListener('pointerdown', e => {
  ensureAudio();
  touchStart = { x: e.clientX, y: e.clientY, t: Date.now() };
});
renderer.domElement.addEventListener('pointerup', e => {
  if (touchStart && Date.now() - touchStart.t < 400) {
    onPointer(e.clientX, e.clientY);
  }
  touchStart = null;
});

// ---- 制作/上菜 ----
function serve(cust) {
  const dish = DISHES[cust.dishIdx];
  const cookTime = dish.cook / (0.8 + 0.2 * game.upgradeLv.stove);
  cust.state = 'cooking';
  sfx(660, 0.2, 'triangle');
  flash(`制作 ${dish.name}...`);
  setTimeout(() => {
    const tip = cust.patience > cust.maxPatience * 0.6 ? 3 : 1;
    game.money += dish.price + tip;
    game.fame += 1;
    game.customersServed += 1;
    // 上菜食物 3D 模型到桌上
    spawnDish(cust.model.position.x, dish);
    sfx(880, 0.2, 'sine');
    scoreFloat(cust.model.position.x, 2.4, `+${dish.price + tip}`);
    scene.remove(cust.group);
    game.customers = game.customers.filter(c => c !== cust);
  }, cookTime / SPEED);
}

// 上菜（桌上放食物 3D）
function spawnDish(x, dish) {
  const file = FOOD_FILES[dish.food];
  const name = 'dish_' + dish.food + '_' + Math.random();
  ensure(name, `${ASSETS}food/${file}`).then(m => {
    if (!m) return;
    const d = m.clone();
    d.position.set(x, 0.75, 0.6);
    d.scale.setScalar(0.9);
    d.rotation.y = Math.random() * 3;
    scene.add(d);
    setTimeout(() => { scene.remove(d); d.traverse(o => { if (o.isMesh) o.geometry?.dispose?.(); }); }, 8000 / SPEED);
  });
}

// ---- 升级/解锁（3D 按钮 + 明确金币校验）----
function upgradeCost(key) {
  const def = UPGRADES.find(u => u.key === key);
  if (!def) return 0;
  return Math.floor(def.costBase * Math.pow(1.8, (game.upgradeLv[key] || 1) - 1));
}
function buildButtons() {
  // 清除旧按钮
  game.clickables.forEach(c => scene.remove(c));
  game.clickables = [];
  // 升级按钮（3D 面板）
  const makeBtn = (key, label, x, z, color) => {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.3),
      new THREE.MeshStandardMaterial({ color }));
    const text = makeText(label);
    text.position.z = 0.2;
    g.add(bg); g.add(text);
    g.position.set(x, 0.6, z);
    g.userData.key = key;
    game.clickables.push(g);
    scene.add(g);
  };
  makeBtn('stove', `灶台💰${upgradeCost('stove')}`, -6.8, -1.2, 0xe8794f);
  makeBtn('cashier', `收银💰${upgradeCost('cashier')}`, -6.8, -0.2, 0xff9f43);
  makeBtn('sign', `招牌💰${upgradeCost('sign')}`, -6.8, 0.8, 0x6eb5ff);
  // 菜品解锁按钮（后面柜台上）
  DISHES.forEach((d, i) => {
    if (i === 0 || game.unlockedDishes.includes(i)) return;
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xb8a0c8 }));
    const t = makeText(`${d.name}💰${d.price * 15}`);
    t.position.z = 0.2;
    g.add(bg); g.add(t);
    g.position.set(-4.5 + i * 1.8, 1.1, -4.5);
    g.userData.dish = i;
    game.clickables.push(g);
    scene.add(g);
  });
}
function makeText(str) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center';
  ctx.fillText(str, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}
function buyUpgrade(key) {
  const u = UPGRADES.find(x => x.key === key);
  if (!u) return;
  const lv = game.upgradeLv[key] || 1;
  if (lv >= u.max) { flash(`${u.name}已满级`); return; }
  const cost = upgradeCost(key);
  if (game.money < cost) { flash('金币不足！'); sfx(200, 0.2); return; }
  game.money -= cost;
  game.upgradeLv[key] = lv + 1;
  sfx(1000, 0.25, 'triangle');
  flash(`${u.name}升级！${u.desc}`);
  buildButtons();
}
function tryUnlock(i) {
  if (game.unlockedDishes.includes(i)) return;
  const cost = DISHES[i].price * 15;
  if (game.money < cost) { flash(`金币不足（需💰${cost}）`); sfx(200, 0.2); return; }
  game.money -= cost;
  game.unlockedDishes.push(i);
  sfx(1200, 0.3, 'triangle');
  flash(`新菜品解锁：${DISHES[i].name}！`);
  buildButtons();
}

// ---- 飘字/提示（DOM 覆盖层）----
function flash(msg, color = '#5a4a3a') {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;top:15%;left:50%;transform:translateX(-50%);font:bold 22px Arial;color:${color};background:#fff8ec;padding:8px 16px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:99;pointer-events:none;transition:opacity .8s`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 900); }, 1400 / SPEED);
}
function scoreFloat(x, y, s) {
  const el = document.createElement('div');
  el.textContent = s;
  el.style.cssText = `position:fixed;left:${(x + 8) / 16 * 100}%;top:${40 - (y - 0) / 10 * 10}%;font:bold 18px Arial;color:#e8794f;z-index:99;pointer-events:none;transition:all .8s`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.transform = 'translateY(-30px)'; el.style.opacity = '0'; setTimeout(() => el.remove(), 900); }, 100);
}

// ---- HUD ----
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;top:10px;left:10px;font:bold 16px Arial;color:#5a4a3a;background:#fff8ec;padding:8px 14px;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,.12);z-index:99';
document.body.appendChild(hud);
function updateHUD() {
  hud.innerHTML = `💰 ${game.money} &nbsp;⭐ 声望 ${game.fame} &nbsp;👥 顾客 ${game.customers.length}<br>
  灶台${game.upgradeLv.stove}/5 · 收银${game.upgradeLv.cashier}/5 · 招牌${game.upgradeLv.sign}/5 · <span style="color:#b0a090">已解锁: ${game.unlockedDishes.map(i => DISHES[i].name).join('、')}</span>`;
}

// ---- 主循环 ----
function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (time - game.lastTime) / 1000) * SPEED;
  game.lastTime = time;

  // 顾客生成（招牌等级提速）
  game.nextSpawn -= dt;
  if (game.nextSpawn <= 0) { game.nextSpawn = (2.2 - game.upgradeLv.sign * 0.25) * 1000 / SPEED / 1000; spawnCustomer(); }

  // 顾客移动 + 耐心
  for (const c of [...game.customers]) {
    if (c.state === 'waiting') {
      c.x += (c.targetX - c.x) * dt * 0.5;
      c.group.position.x = c.x;
      c.group.rotation.y = Math.PI + (c.targetX - c.x) * 0.02;
      c.patience -= dt * 1000;
      const pct = Math.max(0, c.patience / c.maxPatience);
      if (c.bar) {
        c.bar.scale.x = pct;
        c.bar.material.color.set(pct > 0.5 ? 0x9ccb7e : pct > 0.25 ? 0xffe28a : 0xff8fa3);
      }
      if (c.patience <= 0) {  // 生气离开
        scene.remove(c.group);
        game.customers = game.customers.filter(x => x !== c);
        game.fame = Math.max(0, game.fame - 1);
        flash('顾客等太久走了...');
      }
    }
  }

  // 相机轻微晃动（生动）
  camera.position.x = 12 + Math.sin(time * 0.0003) * 0.4;
  camera.lookAt(0, 1.2, 0);

  updateHUD();
  renderer.render(scene, camera);
}

// ---- 启动 ----
async function start() {
  await buildScene();
  buildButtons();
  if (TEST) {
    // 测试模式：自动生成顾客 + 自动服务（保证状态活跃）
    setInterval(() => {
      game.customers.forEach(c => { if (c.state === 'waiting' && Math.random() < 0.3) serve(c); });
    }, 1500 / SPEED);
  }
  flash('欢迎光临温馨小馆！点击顾客接单');
  requestAnimationFrame(animate);
}
start();

// ---- 自适应 ----
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();
