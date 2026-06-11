/* render.js — Canvas 描画（ネオン盤面 / ピース / HUD / ガーベジ予告 / カウントダウン）
   レイアウトは可変:
   ・横画面 対戦   = 2盤面を横並び（1600x900）
   ・縦画面 対戦   = 相手を上に小さく、自分を下に大きく縦積み（900x1600）
   ・ソロ          = 中央1盤面（横/縦それぞれ最適化） */
(function (root) {
  "use strict";

  const Core = root.Core;
  const FX = root.FX;

  const ACCENTS = [
    { accent: "#19c8ff", accentDim: "rgba(25,200,255,0.35)" },
    { accent: "#ff5a3c", accentDim: "rgba(255,90,60,0.35)" },
  ];

  function makeLayout(o) {
    const L = Object.assign({
      cell: 32, panels: "full",
      holdX: null, holdY: null, holdSize: 96,
      nextX: null, nextY: null, nextCount: 5, nextStep: 76, nextW: 88,
      meterX: null, statsX: null, statsY: null,
    }, o);
    L.boardW = Core.COLS * L.cell;
    L.boardH = Core.VISIBLE_ROWS * L.cell;
    L.fs = L.cell / 32; // フォント等の縮尺
    Object.assign(L, ACCENTS[L.accentIdx]);
    return L;
  }

  function cellColor(v) {
    if (v === "G") return "#7c8699";
    const def = Core.PIECES[v];
    return def ? def.color : "#ffffff";
  }

  function drawBlock(ctx, px, py, size, color, opt) {
    opt = opt || {};
    ctx.fillStyle = color;
    if (opt.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = opt.glow;
    }
    ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
    ctx.shadowBlur = 0;
    const hl = Math.max(2, size * 0.16);
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fillRect(px + 1, py + 1, size - 2, hl);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(px + 1, py + 1, Math.max(2, size * 0.12), size - 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(px + 1, py + size - hl - 1, size - 2, hl);
    if (opt.flash) {
      ctx.fillStyle = `rgba(255,255,255,${opt.flash})`;
      ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
    }
  }

  function drawMiniPiece(ctx, type, cx, cy, scale, dim) {
    const def = Core.PIECES[type];
    const cells = def.rotations[0];
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const [x, y] of cells) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const w = (maxX - minX + 1) * scale;
    const h = (maxY - minY + 1) * scale;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.35;
    for (const [x, y] of cells) {
      drawBlock(ctx, cx - w / 2 + (x - minX) * scale, cy - h / 2 + (y - minY) * scale, scale, def.color, { glow: 6 });
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPanel(ctx, x, y, w, h, accent) {
    ctx.save();
    ctx.fillStyle = "rgba(6, 8, 26, 0.78)";
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();
  }

  function drawBoardFrame(ctx, L, player, t) {
    const x = L.boardX, y = L.boardY;
    ctx.fillStyle = "rgba(3, 4, 16, 0.88)";
    ctx.fillRect(x, y, L.boardW, L.boardH);

    ctx.save();
    ctx.strokeStyle = "rgba(120, 160, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < Core.COLS; i++) {
      ctx.beginPath(); ctx.moveTo(x + i * L.cell, y); ctx.lineTo(x + i * L.cell, y + L.boardH); ctx.stroke();
    }
    for (let i = 1; i < Core.VISIBLE_ROWS; i++) {
      ctx.beginPath(); ctx.moveTo(x, y + i * L.cell); ctx.lineTo(x + L.boardW, y + i * L.cell); ctx.stroke();
    }
    ctx.restore();

    // 枠（危機時は赤く脈動 / 大技後は虹色パルス）
    ctx.save();
    let borderColor = L.accent;
    let blur = (14 + FX.beatPulse * 8) * L.fs;
    if (player.fxBorder > 0) {
      const hue = (FX.time * 420) % 360;
      borderColor = `hsl(${hue}, 100%, 62%)`;
      blur = (18 + player.fxBorder * 26) * L.fs;
    } else if (player.danger) {
      const p = 0.5 + 0.5 * Math.sin(t * 9);
      borderColor = `rgb(255, ${40 + p * 60 | 0}, ${50 + p * 40 | 0})`;
      blur = (16 + p * 18) * L.fs;
    }
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(2, 3 * L.fs);
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = blur;
    ctx.strokeRect(x - 2, y - 2, L.boardW + 4, L.boardH + 4);
    ctx.restore();

    if (player.danger && !player.dead) {
      const p = 0.25 + 0.2 * Math.sin(t * 9);
      const g = ctx.createLinearGradient(0, y, 0, y + L.boardH * 0.5);
      g.addColorStop(0, `rgba(255, 30, 50, ${p})`);
      g.addColorStop(1, "rgba(255,30,50,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, L.boardW, L.boardH * 0.5);
    }
  }

  function drawCells(ctx, L, player) {
    for (let y = Core.HIDDEN_ROWS; y < Core.ROWS; y++) {
      for (let x = 0; x < Core.COLS; x++) {
        const v = player.board[y][x];
        if (!v) continue;
        drawBlock(ctx, L.boardX + x * L.cell, L.boardY + (y - Core.HIDDEN_ROWS) * L.cell, L.cell, cellColor(v));
      }
    }
  }

  function drawActive(ctx, L, player) {
    const a = player.active;
    if (!a) return;
    const color = Core.PIECES[a.type].color;

    const gy = player.ghostY();
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (const [cx, cy] of Core.cellsOf(a.type, a.rot, a.x, gy)) {
      if (cy < Core.HIDDEN_ROWS) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const inset = Math.max(2, 3 * L.fs);
      ctx.strokeRect(L.boardX + cx * L.cell + inset, L.boardY + (cy - Core.HIDDEN_ROWS) * L.cell + inset, L.cell - inset * 2, L.cell - inset * 2);
    }
    ctx.restore();

    const lockFlash = player.grounded ? Math.min(0.55, player.lockTimer * 1.1) : 0;
    for (const [cx, cy] of Core.cellsOf(a.type, a.rot, a.x, a.y)) {
      if (cy < Core.HIDDEN_ROWS) continue;
      drawBlock(ctx, L.boardX + cx * L.cell, L.boardY + (cy - Core.HIDDEN_ROWS) * L.cell, L.cell, color, { glow: 14 * L.fs, flash: lockFlash });
    }
  }

  function drawSidePanels(ctx, L, player, t, solo, matchTime) {
    ctx.textAlign = "center";

    // ホールド
    if (L.holdX !== null) {
      drawPanel(ctx, L.holdX, L.holdY, L.holdSize, L.holdSize, L.accentDim);
      ctx.fillStyle = "rgba(200, 225, 255, 0.8)";
      ctx.font = `700 ${Math.max(10, 15 * L.fs)}px sans-serif`;
      ctx.fillText("HOLD", L.holdX + L.holdSize / 2, L.holdY - 6);
      if (player.holdType) drawMiniPiece(ctx, player.holdType, L.holdX + L.holdSize / 2, L.holdY + L.holdSize * 0.52, L.holdSize * 0.21, !player.canHold);
    }

    // ネクスト
    if (L.nextX !== null) {
      drawPanel(ctx, L.nextX, L.nextY, L.nextW, L.nextCount * L.nextStep + 16, L.accentDim);
      ctx.fillStyle = "rgba(200, 225, 255, 0.8)";
      ctx.font = `700 ${Math.max(10, 15 * L.fs)}px sans-serif`;
      ctx.fillText("NEXT", L.nextX + L.nextW / 2, L.nextY - 6);
      for (let i = 0; i < L.nextCount; i++) {
        drawMiniPiece(ctx, player.queue[i], L.nextX + L.nextW / 2, L.nextY + L.nextStep * 0.6 + i * L.nextStep, (i === 0 ? 0.25 : 0.2) * L.nextStep);
      }
    }

    // ガーベジ予告メーター
    if (L.meterX !== null) {
      const mw = Math.max(7, 10 * L.fs);
      ctx.save();
      ctx.fillStyle = "rgba(10, 10, 24, 0.8)";
      ctx.fillRect(L.meterX, L.boardY, mw, L.boardH);
      const n = Math.min(player.pendingGarbage, 20);
      if (n > 0) {
        const danger = player.pendingGarbage >= 4;
        const p = danger ? 0.6 + 0.4 * Math.sin(t * 12) : 1;
        ctx.fillStyle = danger ? `rgba(255, 45, 60, ${p})` : "rgba(255, 130, 60, 0.95)";
        ctx.shadowColor = "#ff3344";
        ctx.shadowBlur = danger ? 18 : 8;
        const hh = n * L.cell;
        ctx.fillRect(L.meterX, L.boardY + L.boardH - hh, mw, hh);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 0;
        for (let i = 1; i < n; i++) {
          ctx.fillRect(L.meterX, L.boardY + L.boardH - i * L.cell, mw, 2);
        }
      }
      ctx.restore();
    }

    // 統計
    if (L.statsX !== null) {
      const sx = L.statsX, lh = 17;
      let sy = L.statsY;
      ctx.textAlign = "left";
      const rows = solo
        ? [["SCORE", String(player.stats.score), "#fff"],
           ["LINES", String(player.stats.cleared), "#fff"],
           ["LEVEL", String(player.level), "#7df9ff"],
           ["TIME", fmtTime(matchTime), "#cfe7ff"]]
        : [["SCORE", String(player.stats.score), "#fff"],
           ["攻撃", player.stats.sent + " 列", "#ffd24d"],
           ["LINES", String(player.stats.cleared), "#fff"]];
      for (const [label, value, color] of rows) {
        ctx.fillStyle = "rgba(170, 200, 255, 0.75)";
        ctx.font = "700 14px sans-serif";
        ctx.fillText(label, sx, sy);
        ctx.fillStyle = color;
        ctx.font = "800 19px sans-serif";
        ctx.fillText(value, sx, sy + 22);
        sy += lh + 24;
      }
      sy += 18;
      if (player.combo >= 1) {
        ctx.fillStyle = "#ffe14d";
        ctx.shadowColor = "#ffb700";
        ctx.shadowBlur = 14;
        ctx.font = "900 26px sans-serif";
        ctx.fillText(player.combo + " REN", sx, sy);
        ctx.shadowBlur = 0;
        sy += 32;
      }
      if (player.prevDifficult) {
        ctx.fillStyle = "#7df9ff";
        ctx.shadowColor = "#00f6ff";
        ctx.shadowBlur = 10;
        ctx.font = "900 18px sans-serif";
        ctx.fillText("B2B", sx, sy);
        ctx.shadowBlur = 0;
      }
    }
  }

  function drawNameTag(ctx, L, label) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = `900 ${Math.max(15, 30 * L.fs)}px sans-serif`;
    ctx.fillStyle = L.accent;
    ctx.shadowColor = L.accent;
    ctx.shadowBlur = 16 * L.fs;
    ctx.fillText(label, L.boardX + L.boardW / 2, L.boardY - 22 * L.fs - 2);
    ctx.restore();
  }

  function fmtTime(sec) {
    const s = Math.floor(sec);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  const Renderer = {
    W: 1600, H: 900,
    layouts: [],
    hud: { type: "vs-landscape" },
    solo: false,
    portrait: false,

    // モードと向きに応じてレイアウトを再構築
    configure(opts) {
      const players = opts.players || 2;
      const portrait = !!opts.portrait;
      this.solo = players === 1;
      this.portrait = portrait;

      if (!portrait && !this.solo) {
        this.W = 1600; this.H = 900;
        this.layouts = [
          makeLayout({ accentIdx: 0, cell: 32, boardX: 230, boardY: 170, holdX: 110, holdY: 170, nextX: 566, nextY: 170, meterX: 212, statsX: 110, statsY: 300 }),
          makeLayout({ accentIdx: 1, cell: 32, boardX: 1050, boardY: 170, holdX: 1394, holdY: 170, nextX: 946, nextY: 170, meterX: 1378, statsX: 1394, statsY: 300 }),
        ];
        this.hud = { type: "vs-landscape" };
      } else if (!portrait && this.solo) {
        this.W = 1600; this.H = 900;
        this.layouts = [
          makeLayout({ accentIdx: 0, cell: 32, boardX: 640, boardY: 170, holdX: 520, holdY: 170, nextX: 976, nextY: 170, meterX: null, statsX: 520, statsY: 300 }),
        ];
        this.hud = { type: "solo-landscape" };
      } else if (portrait && !this.solo) {
        this.W = 900; this.H = 1600;
        this.layouts = [
          // 自分: 下に大きく
          makeLayout({
            accentIdx: 0, cell: 26, boardX: 320, boardY: 560,
            holdX: 222, holdY: 560, holdSize: 78,
            nextX: 594, nextY: 560, nextCount: 4, nextStep: 66, nextW: 72,
            meterX: 306, statsX: 222, statsY: 690,
          }),
          // 相手: 上にコンパクト
          makeLayout({
            accentIdx: 1, cell: 17, boardX: 365, boardY: 110,
            holdX: 290, holdY: 110, holdSize: 56,
            nextX: 555, nextY: 110, nextCount: 2, nextStep: 50, nextW: 52,
            meterX: 541, statsX: null,
          }),
        ];
        this.hud = { type: "vs-portrait", y: 510 };
      } else {
        // 縦ソロ
        this.W = 900; this.H = 1600;
        this.layouts = [
          makeLayout({
            accentIdx: 0, cell: 36, boardX: 270, boardY: 190,
            holdX: 158, holdY: 190, holdSize: 98,
            nextX: 644, nextY: 190, nextCount: 5, nextStep: 80, nextW: 92,
            meterX: null, statsX: null,
          }),
        ];
        this.hud = { type: "solo-portrait" };
      }
      if (root.FX) root.FX.stars = null; // 背景の星を新サイズで再生成
    },

    boardRect(idx) {
      const L = this.layouts[idx];
      return { x: L.boardX, y: L.boardY, w: L.boardW, h: L.boardH };
    },
    cellSize(idx) { return this.layouts[idx].cell; },
    rowToScreenY(idx, rowIdx) {
      const L = this.layouts[idx];
      return L.boardY + (rowIdx - Core.HIDDEN_ROWS) * L.cell;
    },
    cellToScreen(idx, cx, cy) {
      const L = this.layouts[idx];
      return { x: L.boardX + cx * L.cell, y: L.boardY + (cy - Core.HIDDEN_ROWS) * L.cell };
    },
    meterPos(idx) {
      const L = this.layouts[idx];
      if (L.meterX === null) return { x: L.boardX + L.boardW / 2, y: L.boardY + 10 };
      return { x: L.meterX + 5, y: L.boardY + L.boardH - 30 };
    },

    drawHUD(ctx, state, t) {
      const cx = this.W / 2;
      const type = this.hud.type;

      if (type === "vs-landscape") {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 64px sans-serif";
        const hue = (t * 40) % 360;
        ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
        ctx.shadowBlur = 26 + FX.beatPulse * 16;
        const sc = 1 + FX.beatPulse * 0.08;
        ctx.translate(cx, 250);
        ctx.scale(sc, sc);
        ctx.fillText("VS", 0, 0);
        ctx.restore();

        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 38px sans-serif";
        ctx.fillStyle = "#ffe14d";
        ctx.shadowColor = "#ffb700";
        ctx.shadowBlur = 12;
        ctx.fillText(state.wins[0] + "  -  " + state.wins[1], cx, 320);
        ctx.font = "800 30px monospace";
        ctx.fillStyle = "rgba(220, 240, 255, 0.9)";
        ctx.shadowBlur = 0;
        ctx.fillText(fmtTime(state.matchTime), cx, 400);
        ctx.font = "900 24px sans-serif";
        ctx.fillStyle = "#7df9ff";
        ctx.shadowColor = "#00f6ff";
        ctx.shadowBlur = 10;
        ctx.fillText("LEVEL " + state.level, cx, 450);
        ctx.restore();
      } else if (type === "vs-portrait") {
        const y = this.hud.y;
        ctx.save();
        ctx.textAlign = "center";
        const hue = (t * 40) % 360;
        ctx.font = "900 26px sans-serif";
        ctx.fillStyle = `hsl(${hue}, 100%, 65%)`;
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
        ctx.shadowBlur = 14 + FX.beatPulse * 10;
        ctx.fillText("VS", cx, y - 28);
        ctx.font = "900 34px sans-serif";
        ctx.fillStyle = "#ffe14d";
        ctx.shadowColor = "#ffb700";
        ctx.shadowBlur = 10;
        ctx.fillText(state.wins[0] + " - " + state.wins[1], cx, y + 8);
        ctx.font = "800 22px monospace";
        ctx.fillStyle = "rgba(220, 240, 255, 0.9)";
        ctx.shadowBlur = 0;
        ctx.textAlign = "left";
        ctx.fillText(fmtTime(state.matchTime), 110, y);
        ctx.textAlign = "right";
        ctx.font = "900 20px sans-serif";
        ctx.fillStyle = "#7df9ff";
        ctx.shadowColor = "#00f6ff";
        ctx.shadowBlur = 8;
        ctx.fillText("LV " + state.level, this.W - 110, y);
        ctx.restore();
      } else if (type === "solo-portrait") {
        const p = state.players[0];
        ctx.save();
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(170, 200, 255, 0.75)";
        ctx.font = "700 20px sans-serif";
        ctx.fillText("SCORE", cx, 70);
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "#00f6ff";
        ctx.shadowBlur = 12;
        ctx.font = "900 52px sans-serif";
        ctx.fillText(String(p.stats.score), cx, 122);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(170, 200, 255, 0.75)";
        ctx.font = "700 17px sans-serif";
        ctx.fillText("LINES", 160, 70);
        ctx.fillText("LEVEL", this.W - 160, 70);
        ctx.fillStyle = "#fff";
        ctx.font = "900 34px sans-serif";
        ctx.fillText(String(p.stats.cleared), 160, 112);
        ctx.fillStyle = "#7df9ff";
        ctx.fillText(String(p.level), this.W - 160, 112);
        ctx.fillStyle = "rgba(220, 240, 255, 0.7)";
        ctx.font = "800 18px monospace";
        ctx.fillText(fmtTime(state.matchTime), cx, 156);
        // REN / B2B
        const by = this.layouts[0].boardY + this.layouts[0].boardH + 40;
        if (p.combo >= 1) {
          ctx.fillStyle = "#ffe14d";
          ctx.shadowColor = "#ffb700";
          ctx.shadowBlur = 14;
          ctx.font = "900 30px sans-serif";
          ctx.fillText(p.combo + " REN", cx - 80, by);
          ctx.shadowBlur = 0;
        }
        if (p.prevDifficult) {
          ctx.fillStyle = "#7df9ff";
          ctx.shadowColor = "#00f6ff";
          ctx.shadowBlur = 10;
          ctx.font = "900 24px sans-serif";
          ctx.fillText("B2B", cx + 100, by);
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
      // solo-landscape はサイドパネルの統計だけで完結
    },

    drawCountdown(ctx, state) {
      if (state.phase !== "countdown") return;
      const remain = state.countdown;
      const n = Math.ceil(remain);
      const frac = n - remain;
      const label = n > 0 ? String(n) : "GO!";
      ctx.save();
      ctx.translate(this.W / 2, this.H / 2 - 40);
      const sc = 1 + frac * 0.9;
      ctx.scale(sc, sc);
      ctx.globalAlpha = Math.max(0, 1 - frac * 0.9);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "900 150px sans-serif";
      ctx.fillStyle = n > 0 ? "#ffffff" : "#ffe14d";
      ctx.shadowColor = n > 0 ? "#00f6ff" : "#ffb700";
      ctx.shadowBlur = 50;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    },

    draw(ctx, state) {
      const t = FX.time;
      ctx.clearRect(0, 0, this.W, this.H);
      FX.drawBackground(ctx, this.W, this.H);

      ctx.save();
      ctx.translate(FX.shakeX, FX.shakeY);

      for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        const L = this.layouts[i];
        if (!L) continue;
        ctx.save();
        if (p.fxJolt) ctx.translate((Math.random() - 0.5) * p.fxJolt, p.fxJolt * 0.6);
        drawBoardFrame(ctx, L, p, t);
        if (!p.hideBoard) {
          drawCells(ctx, L, p);
          drawActive(ctx, L, p);
        }
        drawSidePanels(ctx, L, p, t, this.solo, state.matchTime);
        if (!this.solo) drawNameTag(ctx, L, state.names[i]);
        ctx.restore();
      }

      FX.draw(ctx);
      this.drawHUD(ctx, state, t);
      ctx.restore();

      FX.drawOverlay(ctx, this.W, this.H);
      this.drawCountdown(ctx, state);
    },
  };

  // 初期レイアウト
  Renderer.configure({ players: 2, portrait: false });

  root.Renderer = Renderer;
  if (typeof module !== "undefined" && module.exports) module.exports = Renderer;
})(typeof window !== "undefined" ? window : globalThis);
