/* ai.js — CPU プレイヤー
   全配置を列挙して盤面評価で選択。難易度で思考速度・操作速度・ミス率・戦略が変化。
   「つよい」以上はテトリス（4列消し）を狙って井戸を温存する */
(function (root) {
  "use strict";

  const Core = root.Core || require("./core.js");

  const DIFFICULTIES = [
    {
      name: "やさしい", key: "easy",
      decide: 0.8, step: 0.17, blunderTop: 6, blunderP: 0.5,
      useHold: false, wellStrategy: false, misdropP: 0.07, softDrop: true,
      wHole: 0.55, replan: false,
    },
    {
      name: "ふつう", key: "normal",
      decide: 0.42, step: 0.1, blunderTop: 3, blunderP: 0.2,
      useHold: true, wellStrategy: false, misdropP: 0.02, softDrop: false,
      wHole: 1.0, replan: false,
    },
    {
      name: "つよい", key: "hard",
      decide: 0.2, step: 0.055, blunderTop: 2, blunderP: 0.07,
      useHold: true, wellStrategy: true, misdropP: 0, softDrop: false,
      wHole: 1.3, replan: true,
    },
    {
      name: "鬼", key: "oni",
      decide: 0.06, step: 0.02, blunderTop: 1, blunderP: 0,
      useHold: true, wellStrategy: true, misdropP: 0, softDrop: false,
      wHole: 1.45, replan: true,
    },
  ];

  function columnHeights(board) {
    const h = new Array(Core.COLS).fill(0);
    for (let x = 0; x < Core.COLS; x++) {
      for (let y = 0; y < Core.ROWS; y++) {
        if (board[y][x]) { h[x] = Core.ROWS - y; break; }
      }
    }
    return h;
  }

  function countHoles(board) {
    let holes = 0;
    for (let x = 0; x < Core.COLS; x++) {
      let roof = false;
      for (let y = 0; y < Core.ROWS; y++) {
        if (board[y][x]) roof = true;
        else if (roof) holes++;
      }
    }
    return holes;
  }

  function evaluate(board, lines, cfg, ctx) {
    const h = columnHeights(board);
    const maxH = Math.max.apply(null, h);
    let agg = 0;
    for (const v of h) agg += v;

    const wellCol = cfg.wellStrategy ? Core.COLS - 1 : -1;
    let bump = 0;
    const lastCmp = wellCol >= 0 ? Core.COLS - 2 : Core.COLS - 1;
    for (let x = 0; x < lastCmp; x++) bump += Math.abs(h[x] - h[x + 1]);

    const holes = countHoles(board);

    let score = 0;
    score -= 0.51 * agg;
    score -= cfg.wHole * 10 * holes;
    score -= 0.18 * bump;

    // ライン消去の価値
    const danger = maxH > 12 || ctx.pendingGarbage >= 4;
    if (cfg.wellStrategy && !danger) {
      // 4列消し狙い: 小さく消すのは損、テトリスは大正義
      score += [0, -2, -1, 1, 60][lines] || 0;
      // 井戸（最右列）を深く保つほど加点
      let minNb = Infinity;
      for (let x = 0; x < Core.COLS - 1; x++) minNb = Math.min(minNb, h[x]);
      const wellDepth = Math.max(0, minNb - h[wellCol]);
      score += Math.min(wellDepth, 5) * 3.4;
      // 井戸にブロックを置いたら減点
      if (h[wellCol] > 0) score -= 7;
    } else {
      score += [0, 4, 9, 15, 60][lines] || lines * 8;
    }

    // 高く積み上がるほど危険
    if (maxH > 14) score -= (maxH - 14) * 16;
    else if (maxH > 10) score -= (maxH - 10) * 2.5;

    return score;
  }

  function enumeratePlacements(board, type, cfg, ctx) {
    const results = [];
    const distinctRots = type === "O" ? 1 : (type === "I" || type === "S" || type === "Z") ? 2 : 4;
    for (let rot = 0; rot < distinctRots; rot++) {
      for (let x = -2; x < Core.COLS; x++) {
        if (Core.collides(board, type, rot, x, 0)) continue;
        const y = Core.dropY(board, type, rot, x, 0);
        const sim = Core.cloneBoard(board);
        Core.lockPiece(sim, type, rot, x, y);
        const full = Core.findFullRows(sim);
        Core.clearRows(sim, full);
        const score = evaluate(sim, full.length, cfg, ctx);
        results.push({ rot, x, score, lines: full.length });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  function AIController(difficultyIdx) {
    this.cfg = DIFFICULTIES[Math.max(0, Math.min(3, difficultyIdx))];
    this.plan = null;
    this.planSerial = -1;
    this.planBoardSerial = -1;
    this.thinkT = 0;
    this.stepT = 0;
    this.holdSent = false;
  }

  AIController.prototype.makePlan = function (player) {
    const cfg = this.cfg;
    const ctx = { pendingGarbage: player.pendingGarbage || 0 };
    const type = player.active.type;
    const board = player.board;

    let candidates = enumeratePlacements(board, type, cfg, ctx);
    let useHold = false;

    if (cfg.useHold && player.canHold) {
      const altType = player.holdType || (player.queue && player.queue[0]);
      if (altType && altType !== type) {
        const altCands = enumeratePlacements(board, altType, cfg, ctx);
        if (altCands.length && candidates.length &&
            altCands[0].score > candidates[0].score + 1.5) {
          useHold = true;
          candidates = altCands;
        } else if (!candidates.length && altCands.length) {
          useHold = true;
          candidates = altCands;
        }
      }
    }

    if (!candidates.length) {
      // 置ける場所がない → そのまま落とす
      this.plan = { useHold: false, rot: player.active.rot, x: player.active.x, dropped: false };
      return;
    }

    let pick = candidates[0];
    if (cfg.blunderP > 0 && Math.random() < cfg.blunderP) {
      const n = Math.min(cfg.blunderTop, candidates.length);
      pick = candidates[(Math.random() * n) | 0];
    }
    let targetX = pick.x;
    if (cfg.misdropP > 0 && Math.random() < cfg.misdropP) {
      targetX += Math.random() < 0.5 ? -1 : 1;
    }
    this.plan = { useHold, rot: pick.rot, x: targetX, dropped: false };
    this.holdSent = false;
  };

  AIController.prototype.poll = function (dt, player) {
    const idle = { left: false, right: false, soft: false, hard: false, rotCW: false, rotCCW: false, hold: false };
    if (!player || !player.active || player.dead) return idle;
    const cfg = this.cfg;

    // 新しいピース → 考え直す
    if (player.pieceSerial !== this.planSerial) {
      this.planSerial = player.pieceSerial;
      this.planBoardSerial = player.boardSerial;
      this.plan = null;
      this.thinkT = cfg.decide * (0.7 + Math.random() * 0.6);
      this.stepT = 0;
    }
    // 盤面が変わった（ガーベジせり上がり）→ 上位CPUは再計画
    if (cfg.replan && this.plan && player.boardSerial !== this.planBoardSerial && !this.plan.dropped) {
      this.planBoardSerial = player.boardSerial;
      this.makePlan(player);
    }

    if (this.thinkT > 0) {
      this.thinkT -= dt;
      return idle;
    }
    if (!this.plan) {
      this.makePlan(player);
      this.planBoardSerial = player.boardSerial;
    }

    this.stepT -= dt;
    if (this.stepT > 0) {
      // 「やさしい」は目標到達後ソフトドロップで落とす
      if (cfg.softDrop && this.plan && !this.plan.useHold &&
          player.active.rot === this.plan.rot && player.active.x === this.plan.x) {
        return Object.assign(idle, { soft: true });
      }
      return idle;
    }
    this.stepT = cfg.step * (0.8 + Math.random() * 0.4);

    const plan = this.plan;
    if (plan.useHold && !this.holdSent) {
      this.holdSent = true;
      return Object.assign(idle, { hold: true });
    }

    const a = player.active;
    const rotDiff = (plan.rot - a.rot) & 3;
    if (rotDiff !== 0) {
      if (rotDiff === 3) return Object.assign(idle, { rotCCW: true });
      return Object.assign(idle, { rotCW: true });
    }
    if (a.x < plan.x) return Object.assign(idle, { right: true });
    if (a.x > plan.x) return Object.assign(idle, { left: true });

    if (cfg.softDrop) return Object.assign(idle, { soft: true });
    if (!plan.dropped) {
      plan.dropped = true;
      return Object.assign(idle, { hard: true });
    }
    return idle;
  };

  root.AIController = AIController;
  root.AI_DIFFICULTIES = DIFFICULTIES;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { AIController, DIFFICULTIES, evaluate, enumeratePlacements };
  }
})(typeof window !== "undefined" ? window : globalThis);
