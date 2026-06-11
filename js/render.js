/* render.js — Canvas 描画（ネオン盤面 / ピース / HUD / ガーベジ予告 / カウントダウン） */
(function (root) {
  "use strict";

  const Core = root.Core;
  const FX = root.FX;

  const W = 1600, H = 900;
  const CELL = 32;
  const BOARD_W = Core.COLS * CELL;          // 320
  const BOARD_H = Core.VISIBLE_ROWS * CELL;  // 640
  const BOARD_Y = 170;

  const LAYOUTS = [
    { boardX: 230, holdX: 110, nextX: 566, meterX: 212, accent: "#19c8ff", accentDim: "rgba(25,200,255,0.35)", name: "1P" },
    { boardX: 1050, holdX: 1394, nextX: 946, meterX: 1378, accent: "#ff5a3c", accentDim: "rgba(255,90,60,0.35)", name: "2P" },
  ];

  function cellColor(v) {
    if (v === "G") return "#7c8699";
    const def = Core.PIECES[v];
    return def ? def.color : "#ffffff";
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * f)) | 0;
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f)) | 0;
    const b = Math.min(255, Math.max(0, (n & 255) * f)) | 0;
    return `rgb(${r},${g},${b})`;
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
    // 上面ハイライトと下面シェード
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.fillRect(px + 1, py + 1, size - 2, 5);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(px + 1, py + 1, 4, size - 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(px + 1, py + size - 6, size - 2, 5);
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
    const x = L.boardX, y = BOARD_Y;
    // 背景
    ctx.fillStyle = "rgba(3, 4, 16, 0.88)";
    ctx.fillRect(x, y, BOARD_W, BOARD_H);
    // グリッド
    ctx.save();
    ctx.strokeStyle = "rgba(120, 160, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < Core.COLS; i++) {
      ctx.beginPath(); ctx.moveTo(x + i * CELL, y); ctx.lineTo(x + i * CELL, y + BOARD_H); ctx.stroke();
    }
    for (let i = 1; i < Core.VISIBLE_ROWS; i++) {
      ctx.beginPath(); ctx.moveTo(x, y + i * CELL); ctx.lineTo(x + BOARD_W, y + i * CELL); ctx.stroke();
    }
    ctx.restore();

    // 枠（危機時は赤く脈動 / 大技後は虹色パルス）
    ctx.save();
    let borderColor = L.accent;
    let blur = 14 + FX.beatPulse * 8;
    if (player.fxBorder > 0) {
      const hue = (FX.time * 420) % 360;
      borderColor = `hsl(${hue}, 100%, 62%)`;
      blur = 18 + player.fxBorder * 26;
    } else if (player.danger) {
      const p = 0.5 + 0.5 * Math.sin(t * 9);
      borderColor = `rgb(255, ${40 + p * 60 | 0}, ${50 + p * 40 | 0})`;
      blur = 16 + p * 18;
    }
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = blur;
    ctx.strokeRect(x - 2, y - 2, BOARD_W + 4, BOARD_H + 4);
    ctx.restore();

    // 危機時の赤ビネット
    if (player.danger && !player.dead) {
      const p = 0.25 + 0.2 * Math.sin(t * 9);
      const g = ctx.createLinearGradient(0, y, 0, y + BOARD_H * 0.5);
      g.addColorStop(0, `rgba(255, 30, 50, ${p})`);
      g.addColorStop(1, "rgba(255,30,50,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, BOARD_W, BOARD_H * 0.5);
    }
  }

  function drawCells(ctx, L, player) {
    const x0 = L.boardX, y0 = BOARD_Y;
    for (let y = Core.HIDDEN_ROWS; y < Core.ROWS; y++) {
      for (let x = 0; x < Core.COLS; x++) {
        const v = player.board[y][x];
        if (!v) continue;
        drawBlock(ctx, x0 + x * CELL, y0 + (y - Core.HIDDEN_ROWS) * CELL, CELL, cellColor(v));
      }
    }
  }

  function drawActive(ctx, L, player) {
    const a = player.active;
    if (!a) return;
    const x0 = L.boardX, y0 = BOARD_Y;
    const color = Core.PIECES[a.type].color;

    // ゴースト
    const gy = player.ghostY();
    ctx.save();
    ctx.globalAlpha = 0.28;
    for (const [cx, cy] of Core.cellsOf(a.type, a.rot, a.x, gy)) {
      if (cy < Core.HIDDEN_ROWS) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + cx * CELL + 3, y0 + (cy - Core.HIDDEN_ROWS) * CELL + 3, CELL - 6, CELL - 6);
    }
    ctx.restore();

    // 本体（接地中は白く点滅してロックが近いことを示す）
    const lockFlash = player.grounded ? Math.min(0.55, player.lockTimer * 1.1) : 0;
    for (const [cx, cy] of Core.cellsOf(a.type, a.rot, a.x, a.y)) {
      if (cy < Core.HIDDEN_ROWS) continue;
      drawBlock(ctx, x0 + cx * CELL, y0 + (cy - Core.HIDDEN_ROWS) * CELL, CELL, color, { glow: 14, flash: lockFlash });
    }
  }

  function drawSidePanels(ctx, L, player, t) {
    // ホールド
    const hx = L.holdX, hy = BOARD_Y;
    drawPanel(ctx, hx, hy, 96, 96, L.accentDim);
    ctx.fillStyle = "rgba(200, 225, 255, 0.8)";
    ctx.font = "700 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HOLD", hx + 48, hy - 8);
    if (player.holdType) drawMiniPiece(ctx, player.holdType, hx + 48, hy + 50, 20, !player.canHold);

    // ネクスト
    const nx = L.nextX, ny = BOARD_Y;
    drawPanel(ctx, nx, ny, 88, 5 * 76 + 16, L.accentDim);
    ctx.fillStyle = "rgba(200, 225, 255, 0.8)";
    ctx.fillText("NEXT", nx + 44, ny - 8);
    for (let i = 0; i < 5; i++) {
      drawMiniPiece(ctx, player.queue[i], nx + 44, ny + 46 + i * 76, i === 0 ? 19 : 15);
    }

    // ガーベジ予告メーター
    const mx = L.meterX;
    ctx.save();
    ctx.fillStyle = "rgba(10, 10, 24, 0.8)";
    ctx.fillRect(mx, BOARD_Y, 10, BOARD_H);
    const n = Math.min(player.pendingGarbage, 20);
    if (n > 0) {
      const danger = player.pendingGarbage >= 4;
      const p = danger ? 0.6 + 0.4 * Math.sin(t * 12) : 1;
      ctx.fillStyle = danger ? `rgba(255, 45, 60, ${p})` : "rgba(255, 130, 60, 0.95)";
      ctx.shadowColor = "#ff3344";
      ctx.shadowBlur = danger ? 18 : 8;
      const hh = n * CELL;
      ctx.fillRect(mx, BOARD_Y + BOARD_H - hh, 10, hh);
      // 1ラインごとの目盛り
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 0;
      for (let i = 1; i < n; i++) {
        ctx.fillRect(mx, BOARD_Y + BOARD_H - i * CELL, 10, 2);
      }
    }
    ctx.restore();

    // 統計（ホールド下）
    const sx = hx, sy = hy + 130;
    ctx.textAlign = L.name === "1P" ? "left" : "left";
    ctx.font = "700 14px sans-serif";
    ctx.fillStyle = "rgba(170, 200, 255, 0.75)";
    ctx.fillText("SCORE", sx, sy);
    ctx.fillStyle = "#fff";
    ctx.font = "800 19px sans-serif";
    ctx.fillText(String(player.stats.score), sx, sy + 24);
    ctx.fillStyle = "rgba(170, 200, 255, 0.75)";
    ctx.font = "700 14px sans-serif";
    ctx.fillText("攻撃", sx, sy + 58);
    ctx.fillStyle = "#ffd24d";
    ctx.font = "800 19px sans-serif";
    ctx.fillText(player.stats.sent + " 列", sx, sy + 82);
    ctx.fillStyle = "rgba(170, 200, 255, 0.75)";
    ctx.font = "700 14px sans-serif";
    ctx.fillText("LINES", sx, sy + 116);
    ctx.fillStyle = "#fff";
    ctx.font = "800 19px sans-serif";
    ctx.fillText(String(player.stats.cleared), sx, sy + 140);

    // REN / B2B 表示
    let by = sy + 186;
    if (player.combo >= 1) {
      ctx.fillStyle = "#ffe14d";
      ctx.shadowColor = "#ffb700";
      ctx.shadowBlur = 14;
      ctx.font = "900 26px sans-serif";
      ctx.fillText(player.combo + " REN", sx, by);
      ctx.shadowBlur = 0;
      by += 34;
    }
    if (player.prevDifficult) {
      ctx.fillStyle = "#7df9ff";
      ctx.shadowColor = "#00f6ff";
      ctx.shadowBlur = 10;
      ctx.font = "900 18px sans-serif";
      ctx.fillText("B2B", sx, by);
      ctx.shadowBlur = 0;
    }
  }

  function drawNameTag(ctx, L, label, isCom) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 30px sans-serif";
    ctx.fillStyle = L.accent;
    ctx.shadowColor = L.accent;
    ctx.shadowBlur = 16;
    ctx.fillText(label, L.boardX + BOARD_W / 2, BOARD_Y - 24);
    ctx.restore();
  }

  function drawCenterHUD(ctx, state, t) {
    const cx = W / 2;
    // VS ロゴ
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

    // 勝利数
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 38px sans-serif";
    ctx.fillStyle = "#ffe14d";
    ctx.shadowColor = "#ffb700";
    ctx.shadowBlur = 12;
    ctx.fillText(state.wins[0] + "  -  " + state.wins[1], cx, 320);
    ctx.restore();

    // タイマーとレベル
    const sec = Math.floor(state.matchTime);
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "800 30px monospace";
    ctx.fillStyle = "rgba(220, 240, 255, 0.9)";
    ctx.fillText(mm + ":" + ss, cx, 400);
    ctx.font = "900 24px sans-serif";
    ctx.fillStyle = "#7df9ff";
    ctx.shadowColor = "#00f6ff";
    ctx.shadowBlur = 10;
    ctx.fillText("LEVEL " + state.level, cx, 450);
    ctx.restore();
  }

  function drawCountdown(ctx, state) {
    if (state.phase !== "countdown") return;
    const remain = state.countdown;
    const n = Math.ceil(remain);
    const frac = n - remain; // 0..1 各数字の経過
    const label = n > 0 ? String(n) : "GO!";
    ctx.save();
    ctx.translate(W / 2, H / 2 - 40);
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
  }

  const Renderer = {
    W, H, CELL, BOARD_W, BOARD_H, BOARD_Y, LAYOUTS,

    boardRect(idx) {
      return { x: LAYOUTS[idx].boardX, y: BOARD_Y, w: BOARD_W, h: BOARD_H };
    },
    rowToScreenY(rowIdx) {
      return BOARD_Y + (rowIdx - Core.HIDDEN_ROWS) * CELL;
    },
    cellToScreen(idx, cx, cy) {
      return {
        x: LAYOUTS[idx].boardX + cx * CELL,
        y: BOARD_Y + (cy - Core.HIDDEN_ROWS) * CELL,
      };
    },
    meterPos(idx) {
      return { x: LAYOUTS[idx].meterX + 5, y: BOARD_Y + BOARD_H - 30 };
    },

    draw(ctx, state) {
      const t = FX.time;
      ctx.clearRect(0, 0, W, H);
      FX.drawBackground(ctx, W, H);

      ctx.save();
      ctx.translate(FX.shakeX, FX.shakeY);

      for (let i = 0; i < 2; i++) {
        const p = state.players[i];
        const L = LAYOUTS[i];
        ctx.save();
        if (p.fxJolt) ctx.translate((Math.random() - 0.5) * p.fxJolt, p.fxJolt * 0.6);
        drawBoardFrame(ctx, L, p, t);
        if (!p.hideBoard) {
          drawCells(ctx, L, p);
          drawActive(ctx, L, p);
        }
        drawSidePanels(ctx, L, p, t);
        drawNameTag(ctx, L, state.names[i]);
        ctx.restore();
      }

      FX.draw(ctx);
      drawCenterHUD(ctx, state, t);
      ctx.restore();

      FX.drawOverlay(ctx, W, H);
      drawCountdown(ctx, state);
    },
  };

  root.Renderer = Renderer;
  if (typeof module !== "undefined" && module.exports) module.exports = Renderer;
})(typeof window !== "undefined" ? window : globalThis);
