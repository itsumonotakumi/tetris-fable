/* fx.js — 演出エンジン
   パーティクル / ビーム / 衝撃波 / 画面シェイク / ヒットストップ / バナー /
   ガーベジ弾 / 背景（ネオングリッド + 星 + ビートパルス） */
(function (root) {
  "use strict";

  const FX = {
    particles: [],
    rings: [],
    beams: [],
    bolts: [],
    banners: [],
    floats: [],
    comets: [],
    flashes: [],
    shakeAmp: 0,
    shakeDur: 0,
    shakeX: 0,
    shakeY: 0,
    hitstopT: 0,
    energy: 0,        // 背景の盛り上がり 0..1
    hueBase: 200,
    stars: null,
    time: 0,
    beatPulse: 0,
    bpm: 150,
    musicOn: false,

    reset() {
      this.particles.length = 0;
      this.rings.length = 0;
      this.beams.length = 0;
      this.bolts.length = 0;
      this.banners.length = 0;
      this.floats.length = 0;
      this.comets.length = 0;
      this.flashes.length = 0;
      this.shakeAmp = 0;
      this.hitstopT = 0;
      this.energy = 0;
    },

    hitstop(sec) { this.hitstopT = Math.max(this.hitstopT, sec); },
    addEnergy(v) { this.energy = Math.min(1, this.energy + v); },

    shake(mag, dur) {
      if (mag >= this.shakeAmp) { this.shakeAmp = mag; this.shakeDur = dur; }
    },

    flash(color, alpha, dur) {
      this.flashes.push({ color, alpha, t: 0, dur });
    },

    spawnParticle(p) { if (this.particles.length < 1600) this.particles.push(p); },

    burst(x, y, color, count, speed, opt) {
      opt = opt || {};
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.3 + Math.random() * 0.9);
        this.spawnParticle({
          x, y,
          vx: Math.cos(a) * sp + (opt.vx || 0),
          vy: Math.sin(a) * sp + (opt.vy || 0),
          g: opt.g !== undefined ? opt.g : 900,
          drag: opt.drag || 0.5,
          life: 0,
          maxLife: (opt.life || 0.7) * (0.6 + Math.random() * 0.8),
          size: (opt.size || 5) * (0.5 + Math.random()),
          color: Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color,
          spark: Math.random() < (opt.sparkRatio !== undefined ? opt.sparkRatio : 0.3),
        });
      }
    },

    // セル崩壊（ライン消去時、各セルから破片を飛ばす）
    cellShatter(px, py, cellSize, color, power) {
      const n = 3 + ((power * 3) | 0);
      for (let i = 0; i < n; i++) {
        this.spawnParticle({
          x: px + Math.random() * cellSize,
          y: py + Math.random() * cellSize,
          vx: (Math.random() - 0.5) * 320 * power,
          vy: -Math.random() * 320 * power - 60,
          g: 1050,
          drag: 0.25,
          life: 0,
          maxLife: 0.5 + Math.random() * 0.7,
          size: 3 + Math.random() * (3 + power * 2),
          color,
          spark: Math.random() < 0.25,
        });
      }
    },

    ringShock(x, y, color, maxR, width) {
      this.rings.push({ x, y, color, r: 8, maxR: maxR || 320, w: width || 7, t: 0, dur: 0.55 });
    },

    beam(x0, x1, y, h, color) {
      this.beams.push({ x0, x1, y, h, color, t: 0, dur: 0.45 });
    },

    lightning(x0, y0, x1, y1, color) {
      const pts = [[x0, y0]];
      const seg = 9;
      for (let i = 1; i < seg; i++) {
        const t = i / seg;
        pts.push([
          x0 + (x1 - x0) * t + (Math.random() - 0.5) * 70,
          y0 + (y1 - y0) * t + (Math.random() - 0.5) * 70,
        ]);
      }
      pts.push([x1, y1]);
      this.bolts.push({ pts, color, t: 0, dur: 0.22 });
    },

    banner(text, opt) {
      opt = opt || {};
      this.banners.push({
        text,
        sub: opt.sub || "",
        x: opt.x, y: opt.y,
        size: opt.size || 90,
        color: opt.color || "#ffffff",
        glow: opt.glow || "#00f6ff",
        rainbow: !!opt.rainbow,
        t: 0,
        dur: opt.dur || 1.15,
        rot: (Math.random() - 0.5) * 0.06,
      });
    },

    floatText(x, y, text, color, size) {
      this.floats.push({ x, y, text, color: color || "#fff", size: size || 26, t: 0, dur: 0.9 });
    },

    comet(x0, y0, x1, y1, color, dur, onArrive) {
      this.comets.push({ x0, y0, x1, y1, color, t: 0, dur: dur || 0.55, onArrive, x: x0, y: y0 });
    },

    // ===== 大技演出 =====

    // テトリス（4列消し）大爆発
    tetrisBlast(rect, rowsY, cellSize, colors, opts) {
      opts = opts || {};
      const cx = rect.x + rect.w / 2;
      const cy = rowsY.reduce((a, b) => a + b, 0) / rowsY.length + cellSize / 2;
      this.hitstop(0.14);
      this.shake(opts.b2b ? 26 : 20, 0.65);
      this.flash("#ffffff", opts.b2b ? 0.85 : 0.7, 0.3);
      this.flash(opts.b2b ? "#ffb700" : "#00f6ff", 0.35, 0.55);
      for (const y of rowsY) this.beam(rect.x - 260, rect.x + rect.w + 260, y, cellSize, "#aef6ff");
      this.ringShock(cx, cy, "#7df9ff", 460, 10);
      this.ringShock(cx, cy, "#ff2bd6", 360, 6);
      this.ringShock(cx, cy, "#ffe14d", 560, 4);
      this.burst(cx, cy, ["#ffffff", "#aef6ff", "#ffe14d", "#ff2bd6"], 90, 700, { g: 500, life: 1.1, size: 6, sparkRatio: 0.55 });
      this.burst(cx, cy, colors, 70, 480, { g: 800, life: 0.9, size: 7 });
      for (let i = 0; i < 4; i++) {
        this.lightning(cx, cy, rect.x - 200 + Math.random() * (rect.w + 400), cy - 260 + Math.random() * 520, "#9ef3ff");
      }
      this.banner(opts.b2b ? "TETRIS!" : "TETRIS!", {
        x: cx, y: cy - 60,
        sub: opts.b2b ? "BACK-TO-BACK" : "",
        size: opts.b2b ? 112 : 96,
        rainbow: true,
        glow: opts.b2b ? "#ffb700" : "#00f6ff",
        dur: 1.3,
      });
      this.addEnergy(0.8);
    },

    // KO: 盤面全体が砕け散る
    koBlast(rect, cellColors, cellSize) {
      this.hitstop(0.2);
      this.shake(30, 0.9);
      this.flash("#ffffff", 0.9, 0.4);
      this.flash("#ff3355", 0.4, 0.8);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      this.ringShock(cx, cy, "#ffffff", 700, 12);
      this.ringShock(cx, cy, "#ff3355", 520, 8);
      for (const c of cellColors) {
        this.spawnParticle({
          x: c.x + cellSize / 2, y: c.y + cellSize / 2,
          vx: (c.x + cellSize / 2 - cx) * (1.5 + Math.random() * 2) + (Math.random() - 0.5) * 200,
          vy: (c.y + cellSize / 2 - cy) * (1.5 + Math.random() * 2) - 250 - Math.random() * 300,
          g: 1100, drag: 0.2,
          life: 0, maxLife: 1.2 + Math.random() * 0.8,
          size: cellSize * (0.3 + Math.random() * 0.4),
          color: c.color, spark: Math.random() < 0.2,
        });
      }
      this.addEnergy(1);
    },

    // ===== 更新 =====
    update(dt) {
      this.time += dt;
      if (this.musicOn) {
        const beatLen = 60 / this.bpm;
        const ph = (this.time % beatLen) / beatLen;
        this.beatPulse = Math.max(0, 1 - ph * 3);
      } else {
        this.beatPulse *= Math.max(0, 1 - dt * 4);
      }
      this.energy = Math.max(0, this.energy - dt * 0.35);

      if (this.shakeDur > 0) {
        this.shakeDur -= dt;
        const a = this.shakeAmp * Math.max(0, this.shakeDur) * 2.2;
        this.shakeX = (Math.random() - 0.5) * 2 * Math.min(a, this.shakeAmp);
        this.shakeY = (Math.random() - 0.5) * 2 * Math.min(a, this.shakeAmp);
        if (this.shakeDur <= 0) { this.shakeAmp = 0; this.shakeX = 0; this.shakeY = 0; }
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) { this.particles.splice(i, 1); continue; }
        p.vy += p.g * dt;
        p.vx *= Math.max(0, 1 - p.drag * dt);
        p.vy *= Math.max(0, 1 - p.drag * dt * 0.5);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      const adv = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          arr[i].t += dt;
          if (arr[i].t >= arr[i].dur) arr.splice(i, 1);
        }
      };
      adv(this.rings); adv(this.beams); adv(this.bolts);
      adv(this.banners); adv(this.floats); adv(this.flashes);

      for (let i = this.comets.length - 1; i >= 0; i--) {
        const c = this.comets[i];
        c.t += dt;
        const k = Math.min(1, c.t / c.dur);
        const e = k * k * (3 - 2 * k);
        const arcY = -Math.sin(k * Math.PI) * 130;
        c.x = c.x0 + (c.x1 - c.x0) * e;
        c.y = c.y0 + (c.y1 - c.y0) * e + arcY;
        if (Math.random() < 0.8) {
          this.spawnParticle({
            x: c.x, y: c.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60,
            g: 0, drag: 1.2, life: 0, maxLife: 0.35, size: 4 + Math.random() * 4,
            color: c.color, spark: true,
          });
        }
        if (k >= 1) {
          this.burst(c.x1, c.y1, [c.color, "#ffffff"], 24, 260, { g: 500, life: 0.5, size: 4, sparkRatio: 0.5 });
          this.ringShock(c.x1, c.y1, c.color, 130, 5);
          if (c.onArrive) c.onArrive();
          this.comets.splice(i, 1);
        }
      }
    },

    // ===== 背景描画（最背面） =====
    drawBackground(ctx, W, H) {
      const t = this.time;
      const energy = this.energy;
      const pulse = this.beatPulse * (0.5 + energy * 0.5);
      const hue = (this.hueBase + t * 6 + energy * 60) % 360;

      const grad = ctx.createRadialGradient(W / 2, H * 0.42, 80, W / 2, H * 0.5, H * 0.95);
      grad.addColorStop(0, `hsl(${hue}, 70%, ${10 + pulse * 6 + energy * 8}%)`);
      grad.addColorStop(0.6, `hsl(${(hue + 50) % 360}, 75%, ${6 + energy * 5}%)`);
      grad.addColorStop(1, "#020108");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // 星
      if (!this.stars) {
        this.stars = [];
        for (let i = 0; i < 130; i++) {
          this.stars.push({
            x: Math.random() * W, y: Math.random() * H,
            z: 0.3 + Math.random() * 0.9, tw: Math.random() * Math.PI * 2,
          });
        }
      }
      ctx.save();
      for (const s of this.stars) {
        s.y += (22 + energy * 240) * s.z * (1 / 60);
        if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
        const a = 0.25 + 0.5 * Math.abs(Math.sin(t * 1.8 + s.tw)) * s.z;
        ctx.fillStyle = `rgba(190, 225, 255, ${a})`;
        const sz = s.z * (1.6 + pulse * 1.6);
        ctx.fillRect(s.x, s.y, sz, sz + energy * 7 * s.z);
      }
      ctx.restore();

      // パース付きネオングリッド（床）
      ctx.save();
      ctx.globalAlpha = 0.16 + pulse * 0.1 + energy * 0.12;
      ctx.strokeStyle = `hsl(${(hue + 120) % 360}, 100%, 60%)`;
      ctx.lineWidth = 1.5;
      const horizon = H * 0.62;
      const speed = (t * (60 + energy * 320)) % 64;
      for (let i = 0; i < 14; i++) {
        const yy = horizon + Math.pow((i * 64 + speed) / (14 * 64), 1.7) * (H - horizon) * 1.6;
        if (yy > H + 40) continue;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
      }
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * 60, horizon);
        ctx.lineTo(W / 2 + i * 260, H + 60);
        ctx.stroke();
      }
      ctx.restore();
    },

    // ===== 前面エフェクト描画 =====
    draw(ctx) {
      // ビーム
      for (const b of this.beams) {
        const k = b.t / b.dur;
        const grow = k < 0.25 ? k / 0.25 : 1;
        const fade = k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75;
        const hh = b.h * (0.4 + grow * 2.6) * (1 - k * 0.5);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createLinearGradient(b.x0, 0, b.x1, 0);
        g.addColorStop(0, "rgba(140,240,255,0)");
        g.addColorStop(0.5, `rgba(230, 252, 255, ${0.9 * fade})`);
        g.addColorStop(1, "rgba(140,240,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(b.x0, b.y + b.h / 2 - hh / 2, b.x1 - b.x0, hh);
        ctx.restore();
      }

      // 稲妻
      for (const bo of this.bolts) {
        const a = 1 - bo.t / bo.dur;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = bo.color;
        ctx.shadowColor = bo.color;
        ctx.shadowBlur = 16;
        ctx.globalAlpha = a;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        bo.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.restore();
      }

      // 衝撃波リング
      for (const r of this.rings) {
        const k = r.t / r.dur;
        const rr = r.r + (r.maxR - r.r) * (1 - Math.pow(1 - k, 2.2));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.lineWidth = r.w * (1 - k * 0.6);
        ctx.shadowColor = r.color;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(r.x, r.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // パーティクル
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of this.particles) {
        const k = 1 - p.life / p.maxLife;
        ctx.globalAlpha = Math.min(1, k * 1.4);
        ctx.fillStyle = p.color;
        if (p.spark) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 12;
          const s = p.size * k;
          ctx.fillRect(p.x - s / 2, p.y - s * 1.6, s, s * 3.2);
          ctx.shadowBlur = 0;
        } else {
          const s = p.size * (0.4 + k * 0.6);
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
      }
      ctx.restore();

      // ガーベジ弾
      for (const c of this.comets) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = c.color;
        ctx.shadowBlur = 26;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 浮遊テキスト
      for (const f of this.floats) {
        const k = f.t / f.dur;
        ctx.save();
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = f.color;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 14;
        ctx.font = `900 ${f.size}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y - k * 46);
        ctx.restore();
      }
    },

    // 最前面（フラッシュ・バナー）
    drawOverlay(ctx, W, H) {
      for (const f of this.flashes) {
        const a = f.alpha * (1 - f.t / f.dur);
        if (a <= 0) continue;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      for (const b of this.banners) {
        const k = b.t / b.dur;
        let scale, alpha;
        if (k < 0.18) {
          const q = k / 0.18;
          scale = 3 - 2.2 * (1 - Math.pow(1 - q, 3));
          alpha = q;
        } else if (k < 0.82) {
          scale = 0.8 + 0.04 * Math.sin((k - 0.18) * 18);
          alpha = 1;
        } else {
          const q = (k - 0.82) / 0.18;
          scale = 0.8 + q * 0.5;
          alpha = 1 - q;
        }
        const x = b.x !== undefined ? b.x : W / 2;
        const y = b.y !== undefined ? b.y : H * 0.4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(b.rot * (1 - k));
        ctx.scale(scale, scale);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (b.sub) {
          ctx.font = `900 ${b.size * 0.34}px sans-serif`;
          ctx.fillStyle = "#ffe14d";
          ctx.shadowColor = "#ffb700";
          ctx.shadowBlur = 24;
          ctx.globalAlpha = alpha;
          ctx.fillText(b.sub, 0, -b.size * 0.74);
        }
        ctx.font = `900 ${b.size}px sans-serif`;
        ctx.globalAlpha = alpha;
        if (b.rainbow) {
          const hue = (this.time * 240) % 360;
          const g = ctx.createLinearGradient(-b.size * 2, 0, b.size * 2, 0);
          g.addColorStop(0, `hsl(${hue}, 100%, 65%)`);
          g.addColorStop(0.5, "#ffffff");
          g.addColorStop(1, `hsl(${(hue + 120) % 360}, 100%, 65%)`);
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = b.color;
        }
        ctx.shadowColor = b.glow;
        ctx.shadowBlur = 34;
        ctx.lineWidth = b.size * 0.07;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(b.text, 0, 0);
        ctx.fillText(b.text, 0, 0);
        ctx.restore();
      }
    },
  };

  root.FX = FX;
  if (typeof module !== "undefined" && module.exports) module.exports = FX;
})(typeof window !== "undefined" ? window : globalThis);
