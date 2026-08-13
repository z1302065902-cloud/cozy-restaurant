// ============================================================
// ui-kit.js — 加载进度条 + 收款入口（所有游戏共享）
// 用法: import { loadingUI, donateButtons } from './ui-kit.js'
// ============================================================

// 加载进度条
export function loadingUI(gameTitle = '游戏') {
  const wrap = document.createElement('div');
  wrap.id = 'loading-ui';
  wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#2a2a3a;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999';
  wrap.innerHTML = `<div style="color:#fff;font:bold 18px Arial;margin-bottom:12px">🎮 ${gameTitle} 加载中...</div>
    <div style="width:260px;height:10px;background:#444;border-radius:5px;overflow:hidden"><div id="loading-bar" style="width:0%;height:100%;background:#e8794f;border-radius:5px;transition:width .3s"></div></div>
    <div id="loading-pct" style="color:#aaa;font:12px Arial;margin-top:8px">0%</div>`;
  document.body.appendChild(wrap);
  return {
    set(pct) {
      const bar = document.getElementById('loading-bar');
      const pctEl = document.getElementById('loading-pct');
      if (bar) bar.style.width = pct + '%';
      if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    },
    done() {
      const el = document.getElementById('loading-ui');
      if (el) { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }
    }
  };
}

// 收款入口（itch $1 + 爱发电）
export function donateButtons(slug, afdianUrl = 'https://afdian.com/a/zsy2026') {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;bottom:10px;right:10px;display:flex;gap:8px;z-index:98';
  const mk = (text, url, bg) => {
    const a = document.createElement('a');
    a.textContent = text;
    a.href = url;
    a.target = '_blank';
    a.style.cssText = `background:${bg};color:#fff;font:bold 12px Arial;padding:8px 14px;border-radius:10px;text-decoration:none;box-shadow:0 2px 6px rgba(0,0,0,.3)`;
    return a;
  };
  wrap.appendChild(mk('💝 完整版 $1', `https://zsy2026.itch.io/${slug}`, '#e8794f'));
  wrap.appendChild(mk('⚡ 爱发电赞助', afdianUrl, '#6eb5ff'));
  document.body.appendChild(wrap);
  // 退款声明小字
  const note = document.createElement('div');
  note.textContent = '数字商品 · 售出不退';
  note.style.cssText = 'position:fixed;bottom:10px;right:10px;color:rgba(255,255,255,0.55);font:10px Arial;z-index:97;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.5)';
  wrap.appendChild(note);
  note.style.cssText += ';margin-top:4px;text-align:right;width:100%';
}
