// ============================================================
// Game Factory 模板 — 温馨餐厅模拟经营
// 玩法: 顾客来店 → 点餐 → 制作(点击) → 上菜收钱 → 升级设备/菜品
// 放置要素: 自动经营模式 + 离线收益
// 测试接口: window.__game_state + ?test=1&speed=4  | 三端兼容
// ============================================================
import Phaser from 'phaser';
import { BgmPlayer } from './bgm.js';

const W = 960, H = 640;
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const SPEED = TEST ? (parseFloat(params.get('speed')) || 4) : 1;

// 菜品（解锁顺序，升级解锁更贵的菜）
// 配置: 温馨小馆 温馨
const DISHES = [
  { name: '奶油意面', price: 8,  cook: 900,  color: 0xffd6a5, unlocked: true },
  { name: '番茄浓汤', price: 12, cook: 1300, color: 0xff8fa3, unlocked: false },
  { name: '草莓甜点', price: 18, cook: 1700, color: 0xf8c9d4, unlocked: false },
  { name: '星空奶昔', price: 25, cook: 2100, color: 0xb8e0ff, unlocked: false },
  { name: '黄金披萨', price: 35, cook: 2600, color: 0xffe28a, unlocked: false },
];

// 设备升级（每级提升制作速度/接待速度）
const UPGRADES = [
  { name: '灶台',  desc: '制作更快', max: 5, costBase: 50 },
  { name: '收银台', desc: '接待更快', max: 5, costBase: 60 },
  { name: '招牌',  desc: '顾客更多', max: 5, costBase: 80 },
];

class GameScene extends Phaser.Scene {
  constructor() { super('game'); }

  create() {
    // ---- 吉卜力童话配色 ----
    this.cameras.main.setBackgroundColor('#a5d8f0');
    this.add.rectangle(W/2, H/2, W, H, 0xa5d8f0);
    // 奶油云 + 远山 + 草地（温馨窗外景）
    for (let i = 0; i < 8; i++) this.add.ellipse(60 + i * 130, 45 + Math.sin(i * 1.7) * 12, 110, 34, 0xfffdf0, 0.9);
    this.add.rectangle(0, H - 140, W, 140, 0x9ccb7e);
    this.add.rectangle(0, H - 60, W, 60, 0xb5d99b);
    // 餐厅地板（暖木色）
    this.add.rectangle(0, H - 190, W, 90, 0xf5e6c8);
    for (let i = 0; i < 8; i++) this.add.rectangle(60 + i * 130, H - 190, 4, 90, 0xe8d5ab);

    // ---- 玩家数据 ----
    this.money = 30;              // 初始金币
    this.fame = 0;                // 声望（升级招牌用）
    this.customerNum = 0;         // 接待总数
    this.upgradeLv = { stove: 1, cashier: 1, sign: 1 };
    this.unlockedDishes = [0];    // 已解锁菜品索引
    this.isAuto = false;          // 自动经营模式

    // ---- 顾客队列 ----
    this.customers = [];          // { sprite, patience, dishIdx, state }
    this.customerSpawnTimer = 0;

    // ---- 交互 ----
    this.input.on('pointerdown', (p) => this.handleTap(p.x, p.y));

    // ---- HUD ----
    this.txt = this.add.text(16, 10, '', { fontFamily: 'Arial', fontSize: '20px', color: '#5a4a3a', fontStyle: 'bold' }).setDepth(20);
    this.flash('欢迎光临 温馨小馆！点击顾客接单');

    // ---- 计时器 ----
    this.time.addEvent({ delay: 15000 / SPEED, loop: true, callback: () => this.autoIncome() });

    // ---- 测试接口 ----
    this.bgm = new BgmPlayer();
    if (TEST) {
      const sc = this;
      window.__game_state = {
        get hp() { return sc.money; },        // 兼容: 用金币当 hp
        get score() { return sc.fame; },
        get wave() { return 1 + Math.floor(sc.customerNum / 5); },
        get weapons() { return sc.unlockedDishes.map(i => DISHES[i].name); },
        get enemies() { return sc.customers.length; },
        get screen() { return 'game'; },
      };
    }
  }

  handleTap(x, y) {
    // 点顾客 → 服务（先服务耐心最低的）
    let best = null, bestPatience = Infinity;
    for (const c of this.customers) {
      if (c.state === 'waiting' && c.patience < bestPatience) { best = c; bestPatience = c.patience; }
    }
    if (best) {
      // 检查是否点到该顾客附近
      if (Math.abs(best.sprite.x - x) < 60 && Math.abs(best.sprite.y - y) < 60) {
        this.serve(best);
        return;
      }
    }
    // 点升级按钮
    const upgrades = [
      { key: 'stove',  x: W - 130, y: 120, label: '灶台', cost: this.upgradeCost('stove') },
      { key: 'cashier', x: W - 130, y: 200, label: '收银', cost: this.upgradeCost('cashier') },
      { key: 'sign',   x: W - 130, y: 280, label: '招牌', cost: this.upgradeCost('sign') },
    ];
    for (const u of upgrades) {
      if (Math.abs(x - u.x) < 60 && Math.abs(y - u.y) < 45) { this.buyUpgrade(u.key); return; }
    }
    // 点菜品解锁区
    for (let i = 1; i < DISHES.length; i++) {
      const dx = 120 + i * 120, dy = H - 260;
      if (!this.unlockedDishes.includes(i) && Math.abs(x - dx) < 50 && Math.abs(y - dy) < 50) {
        this.unlockDish(i);
        return;
      }
    }
  }

  spawnCustomer() {
    if (this.customers.length >= 8) return;  // 满员
    const dishIdx = this.unlockedDishes[Math.floor(Math.random() * this.unlockedDishes.length)];
    const s = this.add.container(80, H - 130);
    const g = this.add.graphics();
    g.fillStyle(0x8f6bbd, 1);
    g.fillCircle(0, -16, 14);       // 头
    g.fillStyle(0x6b4a8f, 1);
    g.fillRoundedRect(-13, -2, 26, 26, 8); // 身体
    g.fillStyle(0xfff8ec, 1);
    g.fillCircle(-5, -18, 3); g.fillCircle(5, -18, 3); // 眼
    s.add(g);
    const patience = 12000 + Math.random() * 6000;  // 耐心(ms)
    this.customers.push({ sprite: s, patience: patience, maxPatience: patience, dishIdx, state: 'waiting' });
    // 耐心进度条
    const bar = this.add.rectangle(0, 22, 30, 4, 0xffffff, 0.8);
    const barFill = this.add.rectangle(-15, 22, 30, 4, 0x9ccb7e, 1).setOrigin(0, 0.5);
    s.add(bar); s.add(barFill);
    s.barFill = barFill;
  }

  serve(c) {
    const dish = DISHES[c.dishIdx];
    const cookTime = dish.cook / (0.8 + 0.2 * this.upgradeLv.stove);
    // 制作动画
    this.flash(`制作 ${dish.name}...`, '#e8794f');
    c.state = 'cooking';
    this.time.delayedCall(cookTime / SPEED, () => {
      // 收钱
      const tip = c.patience > c.maxPatience * 0.6 ? 3 : 1;  // 服务快有额外小费
      this.money += dish.price + tip;
      this.fame += 1;
      this.customerNum += 1;
      this.addScoreFloat(c.sprite.x, c.sprite.y, `+${dish.price + tip}`);
      c.sprite.destroy();
      this.customers = this.customers.filter(x => x !== c);
    });
  }

  update(time, delta) {
    const dt = delta * SPEED;
    // 顾客生成（招牌升级 → 更快）
    this.customerSpawnTimer += dt;
    const spawnInterval = 2200 - this.upgradeLv.sign * 250;
    if (this.customerSpawnTimer > spawnInterval) {
      this.customerSpawnTimer = 0;
      this.spawnCustomer();
    }
    // 顾客移动进店 + 耐心递减
    for (const c of [...this.customers]) {
      if (c.state === 'waiting') {
        if (c.sprite.x < 160) c.sprite.x += dt * 0.05;
        c.patience -= dt;
        const pct = Math.max(0, c.patience / c.maxPatience);
        c.sprite.barFill.width = 30 * pct;
        c.sprite.barFill.setFillStyle(pct > 0.5 ? 0x9ccb7e : pct > 0.25 ? 0xffe28a : 0xff8fa3, 1);
        // 耐心耗尽 → 生气离开
        if (c.patience <= 0) {
          c.sprite.destroy();
          this.customers = this.customers.filter(x => x !== c);
          this.fame = Math.max(0, this.fame - 1);
          this.flash('顾客等太久走了...');
        }
      }
    }
    // HUD
    this.txt.setText(
      `💰 ${this.money}   ⭐ 声望 ${this.fame}   👥 顾客 ${this.customers.length}\n` +
      `灶台${this.upgradeLv.stove}/5 · 收银${this.upgradeLv.cashier}/5 · 招牌${this.upgradeLv.sign}/5`
    );
    // 升级按钮绘制
    this.drawUpgradeButtons();
  }

  drawUpgradeButtons() {
    // 右侧升级面板
    const ups = [
      { key: 'stove', y: 120, label: `灶台 Lv${this.upgradeLv.stove}`, cost: this.upgradeCost('stove') },
      { key: 'cashier', y: 200, label: `收银 Lv${this.upgradeLv.cashier}`, cost: this.upgradeCost('cashier') },
      { key: 'sign', y: 280, label: `招牌 Lv${this.upgradeLv.sign}`, cost: this.upgradeCost('sign') },
    ];
    this.upgradeTexts?.forEach(t => t.destroy());
    this.upgradeTexts = ups.map(u => this.add.text(W - 190, u.y, `${u.label}  💰${u.cost}`, {
      fontFamily: 'Arial', fontSize: '16px', color: '#5a4a3a', backgroundColor: '#fff8ec', padding: { x: 8, y: 6 },
    }).setDepth(15));
    // 菜品解锁区
    this.dishTexts?.forEach(t => t.destroy());
    this.dishTexts = DISHES.map((d, i) => {
      const unlocked = this.unlockedDishes.includes(i);
      const color = unlocked ? '#5a4a3a' : '#b0a090';
      return this.add.text(50 + i * 120, H - 280, unlocked ? `✓ ${d.name} 💰${d.price}` : `${d.name} 💰${d.price}\n(点击解锁)`, {
        fontFamily: 'Arial', fontSize: '14px', color, backgroundColor: '#fff8ec', padding: { x: 6, y: 4 }, align: 'center',
      }).setDepth(15);
    });
  }

  upgradeCost(key) {
    const def = UPGRADES.find(u => u.key === key);
    if (!def) return 0;
    const base = def.costBase;
    const lv = this.upgradeLv[key] || 1;
    return Math.floor(base * Math.pow(1.8, lv - 1));
  }

  buyUpgrade(key) {
    const u = UPGRADES.find(x => x.key === key);
    if (!u) return;
    const lv = this.upgradeLv[key] || 1;
    if (lv >= u.max) { this.flash(`${u.name}已满级`); return; }
    const cost = this.upgradeCost(key);
    if (this.money < cost) { this.flash('金币不足！'); return; }
    this.money -= cost;
    this.upgradeLv[key] = lv + 1;
    this.flash(`${u.name}升级！${u.desc}`);
  }

  unlockDish(i) {
    if (this.unlockedDishes.includes(i)) return;
    const cost = DISHES[i].price * 15;
    if (this.money < cost) { this.flash(`金币不足（需💰${cost}）`); return; }
    this.money -= cost;
    this.unlockedDishes.push(i);
    this.flash(`新菜品解锁：${DISHES[i].name}！`);
  }

  autoIncome() {
    // 放置要素：每 15 秒自动获得少量收入（离线收益模拟）
    const auto = Math.floor(this.fame * 2 + this.upgradeLv.sign * 5);
    this.money += auto;
    this.addScoreFloat(W/2, H/2, `自动经营 +${auto}`);
  }

  flash(msg, color = '#5a4a3a') {
    const t = this.add.text(W/2, 90, msg, { fontFamily: 'Arial', fontSize: '22px', color, fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 30, duration: 1400 / SPEED, onComplete: () => t.destroy() });
  }

  addScoreFloat(x, y, s) {
    const t = this.add.text(x, y, s, { fontFamily: 'Arial', fontSize: '18px', color: '#e8794f', fontStyle: 'bold' }).setOrigin(0.5).setDepth(15);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 800 / SPEED, onComplete: () => t.destroy() });
  }
}

const config = {
  type: Phaser.AUTO,
  width: W, height: H,
  backgroundColor: '#a5d8f0',
  parent: document.body,
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [GameScene],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
};

new Phaser.Game(config);
