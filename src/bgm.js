// ============================================================
// 程序化 BGM（Web Audio 合成）— 温馨餐厅风钢琴循环
// 无需外部文件，三端通用
// ============================================================
export class BgmPlayer {
  constructor() {
    this.ctx = null;
    this.playing = false;
    // 温馨 C 大调琶音
    this.notes = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63]; // C4 E4 G4 C5 G4 E4
  }

  ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { this.ctx = null; }
  }

  play() {
    this.ensure();
    if (!this.ctx || this.playing) return;
    this.playing = true;
    const tick = () => {
      if (!this.playing) return;
      const t = this.ctx.currentTime;
      const note = this.notes[Math.floor((t / 0.45)) % this.notes.length];
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = note;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.45);
      setTimeout(tick, 400);
    };
    tick();
  }

  stop() { this.playing = false; }
}
