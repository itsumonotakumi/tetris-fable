/* player.js — 1人分のテトリス状態機械
   重力 / DAS・ARR / ロック遅延 / ホールド / B2B / REN / おじゃま送受信
   描画や音には直接触れず、events コールバックで通知する */
(function (root) {
  "use strict";

  const Core = root.Core || require("./core.js");

  const DAS = 0.15;       // 横溜め開始
  const ARR = 0.033;      // 連続横移動間隔
  const LOCK_DELAY = 0.5;
  const MAX_LOCK_RESETS = 15;
  const SOFT_MULT = 20;
  const GARBAGE_CAP = 8;  // 一度にせり上がる最大行数

  function gravityForLevel(lv) {
    return Math.max(0.045, 1.0 * Math.pow(0.72, lv - 1));
  }

  function Player(opts) {
    this.index = opts.index;
    this.controller = opts.controller;
    this.events = opts.events || {};
    this.rng = Core.mulberry32(opts.seed);
    this.garbageRng = Core.mulberry32((opts.seed ^ 0x9e3779b9) >>> 0);
    this.reset();
  }

  Player.prototype.reset = function () {
    this.board = Core.createBoard();
    this.bagQueue = [];
    this.queue = [];
    while (this.queue.length < 5) this.queue.push(this.nextFromBag());
    this.active = null;
    this.holdType = null;
    this.canHold = true;
    this.dead = false;

    this.level = 1;
    this.gravityInterval = gravityForLevel(1);
    this.gravityAcc = 0;

    this.dasDir = 0;
    this.dasTimer = 0;
    this.arrTimer = 0;

    this.lockTimer = 0;
    this.lockResets = 0;
    this.grounded = false;

    this.spawnTimer = 0.4;
    this.pieceSerial = 0;
    this.boardSerial = 0;

    this.pendingGarbage = 0;
    this.garbageHole = (this.garbageRng() * Core.COLS) | 0;

    this.combo = -1;
    this.prevDifficult = false;

    this.lastMoveWasRotation = false;
    this.lastKickIndex = 0;

    this.stats = { sent: 0, cleared: 0, tetris: 0, maxRen: 0, score: 0, pieces: 0 };
    this.danger = false;
  };

  Player.prototype.nextFromBag = function () {
    if (this.bagQueue.length === 0) this.bagQueue = Core.makeBag(this.rng);
    return this.bagQueue.shift();
  };

  Player.prototype.setLevel = function (lv) {
    this.level = lv;
    this.gravityInterval = gravityForLevel(lv);
  };

  Player.prototype.spawn = function (type) {
    const t = type || this.queue.shift();
    while (this.queue.length < 5) this.queue.push(this.nextFromBag());
    this.active = { type: t, rot: 0, x: 3, y: 1 };
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.grounded = false;
    this.lastMoveWasRotation = false;
    this.pieceSerial++;
    this.stats.pieces++;
    if (Core.collides(this.board, t, 0, 3, 1)) {
      this.die();
      return;
    }
    if (this.events.onSpawn) this.events.onSpawn(this);
  };

  Player.prototype.die = function () {
    if (this.dead) return;
    this.dead = true;
    this.active = null;
    if (this.events.onDeath) this.events.onDeath(this);
  };

  Player.prototype.tryMove = function (dx) {
    const a = this.active;
    if (!a) return false;
    if (!Core.collides(this.board, a.type, a.rot, a.x + dx, a.y)) {
      a.x += dx;
      this.lastMoveWasRotation = false;
      this.onSuccessfulShift();
      if (this.events.onMove) this.events.onMove(this);
      return true;
    }
    return false;
  };

  Player.prototype.tryRotate = function (dir) {
    const a = this.active;
    if (!a) return false;
    const from = a.rot & 3;
    const to = (a.rot + dir + 4) & 3;
    const kicks = Core.getKicks(a.type, from, to);
    for (let i = 0; i < kicks.length; i++) {
      const [dx, dy] = kicks[i];
      if (!Core.collides(this.board, a.type, to, a.x + dx, a.y + dy)) {
        a.rot = to;
        a.x += dx;
        a.y += dy;
        this.lastMoveWasRotation = true;
        this.lastKickIndex = i;
        this.onSuccessfulShift();
        if (this.events.onRotate) this.events.onRotate(this);
        return true;
      }
    }
    return false;
  };

  Player.prototype.onSuccessfulShift = function () {
    if (this.grounded && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  };

  Player.prototype.holdPiece = function () {
    if (!this.canHold || !this.active) return;
    const cur = this.active.type;
    const swap = this.holdType;
    this.holdType = cur;
    this.canHold = false;
    if (this.events.onHold) this.events.onHold(this);
    this.spawn(swap || undefined);
  };

  Player.prototype.ghostY = function () {
    const a = this.active;
    if (!a) return 0;
    return Core.dropY(this.board, a.type, a.rot, a.x, a.y);
  };

  Player.prototype.hardDrop = function () {
    const a = this.active;
    if (!a) return;
    const gy = this.ghostY();
    const dist = gy - a.y;
    a.y = gy;
    if (this.events.onHardDrop) this.events.onHardDrop(this, dist);
    this.lockNow();
  };

  Player.prototype.receiveGarbage = function (n) {
    if (n <= 0 || this.dead) return;
    this.pendingGarbage += n;
    if (this.events.onGarbageQueued) this.events.onGarbageQueued(this, n);
  };

  Player.prototype.riseGarbage = function () {
    if (this.pendingGarbage <= 0) return;
    const n = Math.min(this.pendingGarbage, GARBAGE_CAP);
    this.pendingGarbage -= n;
    for (let i = 0; i < n; i++) {
      if (this.garbageRng() < 0.25) this.garbageHole = (this.garbageRng() * Core.COLS) | 0;
      Core.addGarbage(this.board, 1, this.garbageHole);
    }
    this.boardSerial++;
    if (this.events.onGarbageRise) this.events.onGarbageRise(this, n);
    this.updateDanger();
  };

  Player.prototype.updateDanger = function () {
    const d = Core.stackHeight(this.board) >= 14;
    if (d !== this.danger) {
      this.danger = d;
      if (this.events.onDangerChange) this.events.onDangerChange(this, d);
    }
  };

  Player.prototype.lockNow = function () {
    const a = this.active;
    if (!a) return;
    const tspinInfo = Core.detectTSpin(this.board, a.type, a.rot, a.x, a.y, this.lastMoveWasRotation, this.lastKickIndex);
    const lockout = Core.lockPiece(this.board, a.type, a.rot, a.x, a.y);
    this.boardSerial++;
    this.active = null;
    this.canHold = true;

    const rows = Core.findFullRows(this.board);
    const lines = rows.length;

    if (lines > 0) {
      this.combo++;
      const difficult = lines === 4 || tspinInfo.tspin;
      const b2b = difficult && this.prevDifficult;
      this.prevDifficult = difficult;
      const rowsData = rows.map((y) => this.board[y].slice());
      Core.clearRows(this.board, rows);
      const perfectClear = Core.isBoardEmpty(this.board);
      const info = {
        lines,
        tspin: tspinInfo.tspin,
        mini: tspinInfo.mini,
        b2b,
        combo: this.combo,
        perfectClear,
      };
      info.attack = Core.attackOf(info);
      this.stats.cleared += lines;
      this.stats.score += Core.scoreOf(info, this.level);
      if (lines === 4) this.stats.tetris++;
      this.stats.maxRen = Math.max(this.stats.maxRen, this.combo);

      // 相殺: まず自分の予告おじゃまを打ち消す
      let atk = info.attack;
      if (this.pendingGarbage > 0 && atk > 0) {
        const cancel = Math.min(this.pendingGarbage, atk);
        this.pendingGarbage -= cancel;
        atk -= cancel;
      }
      info.attackAfterCancel = atk;
      this.stats.sent += atk;

      if (this.events.onClear) this.events.onClear(this, info, rows, rowsData);
      this.spawnTimer = lines === 4 || info.perfectClear ? 0.42 : 0.26;
    } else {
      this.combo = -1;
      if (tspinInfo.tspin && this.events.onClear) {
        // 0ライン Tスピン（演出のみ・B2B維持）
        this.prevDifficult = true;
      }
      if (this.events.onLock) this.events.onLock(this);
      if (this.pendingGarbage > 0) this.riseGarbage();
      this.spawnTimer = 0.06;
    }

    this.updateDanger();
    if (lockout) this.die();
  };

  Player.prototype.update = function (dt) {
    if (this.dead) return;

    if (!this.active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) this.spawn();
      return;
    }

    const c = this.controller ? this.controller.poll(dt, this) : {};
    const a = this.active;

    // ホールド
    if (c.hold) {
      this.holdPiece();
      if (!this.active) return;
    }

    // 回転
    if (c.rotCW) this.tryRotate(1);
    if (c.rotCCW) this.tryRotate(-1);

    // 横移動（DAS / ARR）
    let dir = 0;
    if (c.left && !c.right) dir = -1;
    else if (c.right && !c.left) dir = 1;
    else if (c.left && c.right) dir = this.dasDir || 0;

    if (dir !== 0) {
      if (this.dasDir !== dir) {
        this.dasDir = dir;
        this.dasTimer = 0;
        this.arrTimer = 0;
        this.tryMove(dir);
      } else {
        this.dasTimer += dt;
        if (this.dasTimer >= DAS) {
          this.arrTimer += dt;
          while (this.arrTimer >= ARR) {
            this.arrTimer -= ARR;
            if (!this.tryMove(dir)) break;
          }
        }
      }
    } else {
      this.dasDir = 0;
      this.dasTimer = 0;
    }

    // ハードドロップ
    if (c.hard) {
      this.hardDrop();
      return;
    }

    // 重力 + ソフトドロップ
    const interval = c.soft ? Math.min(this.gravityInterval / SOFT_MULT, 0.035) : this.gravityInterval;
    this.gravityAcc += dt;
    while (this.gravityAcc >= interval) {
      this.gravityAcc -= interval;
      if (!Core.collides(this.board, a.type, a.rot, a.x, a.y + 1)) {
        a.y++;
        this.lastMoveWasRotation = false;
        if (c.soft) this.stats.score += 1;
      } else {
        break;
      }
    }

    // 接地判定とロック遅延
    const onGround = Core.collides(this.board, a.type, a.rot, a.x, a.y + 1);
    if (onGround) {
      if (!this.grounded) { this.grounded = true; this.lockTimer = 0; }
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY) this.lockNow();
    } else {
      this.grounded = false;
      this.lockTimer = 0;
    }
  };

  root.Player = Player;
  if (typeof module !== "undefined" && module.exports) module.exports = Player;
})(typeof window !== "undefined" ? window : globalThis);
