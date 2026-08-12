// ============================================================
// 温馨小馆 3D — Three.js 餐厅模拟经营
// 玩法: 顾客进店 → 点菜 → 制作(点击顾客) → 收钱 → 升级设备/解锁菜品
// 素材: Kenney CC0 (家具/食物) + manneko 角色, 全部真实 3D 模型
// 测试接口: window.__game_state + ?test=1&speed=4 | 三端触控
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BgmPlayer } from './bgm.js';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const SPEED = TEST ? (parseFloat(params.get('speed')) || 4) : 1;

// ---- 菜品（解锁顺序）----
const DISHES = [
  { name: '奶油意面', price: 8,  cook: 900,  model: 'spaghetti',  color: 0xffd6a5, unlocked: true },
  { name: '番茄浓汤', price: 12, cook: 1300, model: 'soup',       color: 0xff8fa3, unlocked: false },
  { name: '草莓甜点', price: 18, cook: 1700, model: 'cake',       color: 0xf8c9d4, unlocked: false },
  { name: '星空奶昔', price: 25, cook: 2100, model: 'coffee',     color: 0xb8e0ff, unlocked: false },
  { name: '黄金披萨', price: 35, cook: 2600, model: 'pizza',      color: 0xffe28a, unlocked: false },
];

const UPGRADES = [
  { key: 'stove', name: '灶台', desc: '制作更快', max: 5, costBase: 50 },
  { key: 'cashier', name: '收银台', desc: '接待更快', max: 5, costBase: 60 },
  { key: 'sign', name: '招牌', desc: '顾客更多', max: 5, costBase: 80 },
];

// 食物模型映射（food-kit 里的文件）
const FOOD_MODELS = {
  spaghetti: 'spaghetti.glb', soup: 'soup.glb', cake: 'cake.glb',
  coffee: 'coffee-cup.glb', pizza: 'pizza.glb',
};
const FALLBACK_FOOD = 'plate-rectangle.glb';

// ---- 3D 场景 ----
class Restaurant3D {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa5d8f0);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(14, 12, 16);
    this.camera.lookAt(0, 1, 0);
    this.clock = new THREE.Clock();
    this.models = {};
    this.loader = new GLTFLoader();
    // 灯光（暖光温馨）
    this.scene.add(new THREE.HemisphereLight(0xfff8ec, 0x9ccb7e, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.4);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    this.scene.add(sun);
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async loadModel(path, name, onLoad) {
    const cache = this.models[name];
    if (cache) return cache;
    try {
      const gltf = await this.loader.loadAsync(path);
      const model = gltf.scene;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.models[name] = model;
      if (onLoad) onLoad(model);
      return model;
    } catch (e) { console.warn('模型加载失败:', path, e.message); return null; }
  }

  placeModel(name, x, y, z, scale = 1, rotY = 0) {
    const m = this.models[name];
    if (!m) return null;
    const clone = m.clone();
    clone.position.set(x, y, z);
    clone.scale.setScalar(scale);
    clone.rotation.y = rotY;
    this.scene.add(clone);
    return clone;
  }
}

export { THREE, GLTFLoader, BgmPlayer, DISHES, UPGRADES, FOOD_MODELS, FALLBACK_FOOD, Restaurant3D, TEST, SPEED };
