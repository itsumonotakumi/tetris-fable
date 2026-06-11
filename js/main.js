/* main.js — 全体統括
   メニュー / マッチ進行 / プレイヤーイベント→演出&音の配線 / メインループ
   タイトル裏では COM vs COM のデモが流れる */
(function () {
  "use strict";

  const W = Renderer.W, H = Renderer.H, CELL = Renderer.CELL;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  function resize() {
    const scale = Math.min(innerWidth / W, innerHeight / H);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  addEventListener("resize", resize);
  resize();

  function cellColorOf(v) {
    return v === "G" ? "#7c8699" : (Core.PIECES[v] ? Core.PIECES[v].color : "#ffffff");
  }

  // ====== ゲーム状態 ======
  const Game = {
    mode: "attract",        // attract | com | human
    difficulty: 1,
    phase: "attract",       // attract | countdown | playing | over
    paused: false,
    silent: true,
    players: [],
    names: ["COM", "COM"],
    wins: [0, 0],
    matchTime: 0,
    level: 1,
    levelTimer: 0,
    countdown: 0,
    heartbeatT: 0,
    matchId: 0,
  };

  function sfx(name, ...args) {
    if (!Game.silent) AudioEngine.sfx(name, ...args);
  }

  function later(sec, fn) {
    const id = Game.matchId;
    setTimeout(() => { if (id === Game.matchId) fn(); }, sec * 1000);
  }

  // ====== プレイヤーイベント配線 ======
  function makeEvents(idx) {
    const oppIdx = 1 - idx;
    return {
      onMove(p) {
        if (FX.time - (p._sfxMoveT || 0) > 0.045) { p._sfxMoveT = FX.time; sfx("move"); }
      },
      onRotate(p) {
        if (FX.time - (p._sfxRotT || 0) > 0.06) { p._sfxRotT = FX.time; sfx("rotate"); }
      },
      onHold() { sfx("hold"); },
      onLock() { sfx("lock"); },
      onSpawn() {},

      onHardDrop(p, dist) {
        sfx("hardDrop");
        FX.shake(Math.min(2 + dist * 0.18, 5), 0.12);
        if (!p.active) return;
        const color = Core.PIECES[p.active.type].color;
        for (const [cx, cy] of Core.cellsOf(p.active.type, p.active.rot, p.active.x, p.active.y)) {
          if (cy < Core.HIDDEN_ROWS) continue;
          const s = Renderer.cellToScreen(idx, cx, cy);
          FX.burst(s.x + CELL / 2, s.y + CELL / 2, color, 3, 130, { g: -300, life: 0.3, size: 4, sparkRatio: 0.6 });
        }
      },

      onClear(p, info, rows, rowsData) {
        const rect = Renderer.boardRect(idx);
        const rowYs = rows.map((r) => Renderer.rowToScreenY(r));
        const colors = [];
        rowsData.forEach((row) => row.forEach((v) => { if (v) colors.push(cellColorOf(v)); }));
        const cx = rect.x + rect.w / 2;
        const cy = rowYs.reduce((a, b) => a + b, 0) / rowYs.length;

        if (info.perfectClear) {
          sfx("perfectClear");
          FX.hitstop(0.16);
          FX.shake(24, 0.7);
          FX.flash("#ffffff", 0.85, 0.35);
          FX.flash("#ffd700", 0.45, 0.7);
          FX.ringShock(cx, cy, "#ffd700", 600, 12);
          FX.burst(cx, cy, ["#ffd700", "#ffffff", "#ffe98a"], 140, 760, { g: 420, life: 1.3, size: 7, sparkRatio: 0.6 });
          FX.banner("PERFECT CLEAR!", { x: cx, y: rect.y + rect.h * 0.35, size: 64, color: "#ffe98a", glow: "#ffb700", dur: 1.5 });
          FX.addEnergy(1);
          p.fxBorder = 1.4;
        } else if (info.lines === 4) {
          sfx("tetris");
          if (info.b2b) sfx("b2b");
          FX.tetrisBlast(rect, rowYs, CELL, colors, { b2b: info.b2b });
          p.fxBorder = 1.2;
        } else if (info.tspin) {
          sfx("tspin", info.lines);
          FX.shake(8 + info.lines * 3, 0.4);
          FX.flash("#c238ff", 0.3, 0.4);
          FX.ringShock(cx, cy, "#c238ff", 320, 8);
          FX.burst(cx, cy, ["#c238ff", "#ff7df9", "#ffffff"], 50 + info.lines * 25, 480, { life: 0.9, size: 6, sparkRatio: 0.5 });
          FX.banner(Core.clearName(info) + "!", { x: cx, y: cy - 40, size: 52, color: "#e29bff", glow: "#c238ff", sub: info.b2b ? "BACK-TO-BACK" : "", dur: 1.2 });
          p.fxBorder = 1;
        } else {
          sfx("clear", info.lines, info.combo);
          FX.shake(2 + info.lines * 2.5, 0.25);
          rows.forEach((r, ri) => {
            const sy = rowYs[ri];
            rowsData[ri].forEach((v, xCol) => {
              if (!v) return;
              FX.cellShatter(rect.x + xCol * CELL, sy, CELL, cellColorOf(v), info.lines);
            });
          });
          if (info.lines >= 2) {
            FX.banner(info.lines === 2 ? "DOUBLE" : "TRIPLE", { x: cx, y: cy - 30, size: 44, color: "#bfeaff", glow: "#19c8ff", dur: 0.8 });
          }
        }

        if (info.combo >= 1) {
          FX.floatText(cx, rect.y + 60, info.combo + " REN!", "#ffe14d", 30 + Math.min(info.combo * 3, 24));
        }

        // おじゃま送信（コメットが相手のメーターへ飛ぶ）
        const atk = info.attackAfterCancel;
        if (atk > 0) {
          const target = Renderer.meterPos(oppIdx);
          const accent = Renderer.LAYOUTS[idx].accent;
          FX.floatText(cx, cy - 90, "+" + atk + " 攻撃!", accent, 30);
          const opp = Game.players[oppIdx];
          const mid = Game.matchId;
          FX.comet(cx, cy, target.x, target.y, accent, 0.55, () => {
            if (mid !== Game.matchId || !opp || opp.dead) return;
            opp.receiveGarbage(atk);
          });
        }
      },

      onGarbageQueued(p, n) {
        sfx("garbageWarn");
        const m = Renderer.meterPos(idx);
        FX.floatText(m.x, m.y - 20, "⚠ +" + n, "#ff5a3c", 26);
      },

      onGarbageRise(p, n) {
        sfx("garbageHit", n);
        p.fxJolt = 8 + n * 2;
        FX.shake(Math.min(3 + n * 1.5, 12), 0.3);
        const rect = Renderer.boardRect(idx);
        FX.burst(rect.x + rect.w / 2, rect.y + rect.h - 10, ["#7c8699", "#ff5a3c"], 8 + n * 6, 300, { life: 0.6, size: 5 });
      },

      onDangerChange() {
        if (Game.silent) return;
        const d = Game.players.some((pl) => pl.danger && !pl.dead);
        AudioEngine.setDanger(d);
      },

      onDeath(p) {
        koEffects(idx);
        if (Game.phase === "attract") {
          later(2.0, () => createMatch("attract"));
        } else if (Game.phase === "playing") {
          endMatch(oppIdx);
        }
      },
    };
  }

  function koEffects(idx) {
    const p = Game.players[idx];
    const rect = Renderer.boardRect(idx);
    const cells = [];
    for (let y = Core.HIDDEN_ROWS; y < Core.ROWS; y++) {
      for (let x = 0; x < Core.COLS; x++) {
        const v = p.board[y][x];
        if (!v) continue;
        const s = Renderer.cellToScreen(idx, x, y);
        cells.push({ x: s.x, y: s.y, color: cellColorOf(v) });
      }
    }
    FX.koBlast(rect, cells, CELL);
    p.hideBoard = true;
    sfx("ko");
    FX.banner("K.O.", { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 - 40, size: 120, color: "#ffffff", glow: "#ff3355", dur: 1.8 });
  }

  // ====== マッチ生成・進行 ======
  function createMatch(mode, difficulty) {
    Game.matchId++;
    Game.mode = mode;
    if (difficulty !== undefined) Game.difficulty = difficulty;
    Game.matchTime = 0;
    Game.level = 1;
    Game.levelTimer = 0;
    Game.paused = false;
    Game.heartbeatT = 0;
    FX.reset();
    AudioEngine.setDanger(false);

    const seed = (Math.random() * 0x7fffffff) | 0;
    const sameSeed = mode !== "attract";
    const seeds = [seed, sameSeed ? seed : (seed + 0x1234567) | 0];

    let controllers, names;
    if (mode === "com") {
      controllers = [new HumanController(0), new AIController(Game.difficulty)];
      names = ["1P", "COM·" + AI_DIFFICULTIES[Game.difficulty].name];
    } else if (mode === "human") {
      controllers = [new HumanController(0), new HumanController(1)];
      names = ["1P", "2P"];
    } else {
      controllers = [new AIController(2), new AIController(2)];
      names = ["COM", "COM"];
    }
    Game.names = names;

    Game.players = [0, 1].map((i) => {
      const p = new Player({ index: i, seed: seeds[i], controller: controllers[i], events: makeEvents(i) });
      p.fxJolt = 0;
      p.fxBorder = 0;
      p.hideBoard = false;
      return p;
    });

    if (mode === "attract") {
      Game.silent = true;
      Game.phase = "attract";
      FX.musicOn = false;
    } else {
      Game.silent = false;
      Game.phase = "countdown";
      Game.countdown = 3.0;
      AudioEngine.stopBGM();
      sfx("countdown");
    }
  }

  function endMatch(winnerIdx) {
    Game.phase = "over";
    Game.wins[winnerIdx]++;
    const winRect = Renderer.boardRect(winnerIdx);
    later(0.9, () => {
      FX.banner("WIN!", {
        x: winRect.x + winRect.w / 2, y: winRect.y + winRect.h / 2 - 40,
        size: 100, rainbow: true, glow: Renderer.LAYOUTS[winnerIdx].accent, dur: 2.0,
      });
      FX.burst(winRect.x + winRect.w / 2, winRect.y + winRect.h / 2, ["#ffe14d", "#ffffff", Renderer.LAYOUTS[winnerIdx].accent], 90, 600, { life: 1.2, size: 6, sparkRatio: 0.5 });
    });
    later(2.4, () => {
      AudioEngine.stopBGM();
      FX.musicOn = false;
      const loserIsHuman = !(Game.mode === "com" && winnerIdx === 1);
      AudioEngine.sfx(loserIsHuman ? "win" : "lose");
      const banner = document.getElementById("result-banner");
      banner.textContent = Game.names[winnerIdx] + " WIN!";
      banner.className = "result-banner " + (winnerIdx === 0 ? "p1" : "p2");
      document.getElementById("result-score").textContent = "★ " + Game.wins[0] + " - " + Game.wins[1] + " ★";
      show("result");
    });
  }

  // ====== 画面・メニュー ======
  const screens = {
    title: document.getElementById("screen-title"),
    difficulty: document.getElementById("screen-difficulty"),
    controls: document.getElementById("screen-controls"),
    pause: document.getElementById("screen-pause"),
    result: document.getElementById("screen-result"),
  };
  let currentScreen = "title";
  let focusIdx = 0;

  function menuButtons() {
    if (!currentScreen) return [];
    return Array.from(screens[currentScreen].querySelectorAll(".menu-btn"));
  }

  function applyFocus() {
    menuButtons().forEach((b, i) => b.classList.toggle("focused", i === focusIdx));
  }

  function show(name) {
    currentScreen = name;
    focusIdx = 0;
    for (const k in screens) screens[k].classList.toggle("active", k === name);
    if (name) applyFocus();
  }

  function goTitle() {
    Game.wins = [0, 0];
    createMatch("attract");
    show("title");
    if (AudioEngine.ready) { AudioEngine.startBGM("menu"); FX.musicOn = true; FX.bpm = 96; }
  }

  function startBattle(mode, difficulty) {
    show(null);
    createMatch(mode, difficulty);
  }

  const actions = {
    "vs-com": () => show("difficulty"),
    "vs-human": () => startBattle("human"),
    "controls": () => show("controls"),
    "diff-0": () => startBattle("com", 0),
    "diff-1": () => startBattle("com", 1),
    "diff-2": () => startBattle("com", 2),
    "diff-3": () => startBattle("com", 3),
    "back": () => { AudioEngine.sfx("menuBack"); show("title"); },
    "resume": () => resumeGame(),
    "retry": () => { startBattle(Game.mode, Game.difficulty); },
    "title": () => goTitle(),
    "rematch": () => startBattle(Game.mode, Game.difficulty),
  };

  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      AudioEngine.unlock();
      if (btn.dataset.action !== "back") AudioEngine.sfx("menuSelect");
      const fn = actions[btn.dataset.action];
      if (fn) fn();
    });
    btn.addEventListener("mouseenter", () => {
      const list = menuButtons();
      const i = list.indexOf(btn);
      if (i >= 0) { focusIdx = i; applyFocus(); }
    });
  });

  function pauseGame() {
    if (Game.phase !== "playing" || Game.paused) return;
    Game.paused = true;
    AudioEngine.setBgmVolume(0.12);
    show("pause");
  }
  function resumeGame() {
    Game.paused = false;
    AudioEngine.setBgmVolume(0.5);
    show(null);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && Game.phase === "playing" && !Game.paused && Game.mode !== "attract") pauseGame();
  });

  // 最初の操作で AudioContext を解錠
  let unlocked = false;
  function firstUnlock() {
    if (unlocked) return;
    unlocked = true;
    AudioEngine.unlock();
    if (currentScreen === "title" || currentScreen === "difficulty" || currentScreen === "controls") {
      AudioEngine.startBGM("menu");
      FX.musicOn = true;
      FX.bpm = 96;
    }
  }
  addEventListener("pointerdown", firstUnlock);
  addEventListener("keydown", firstUnlock);

  // ====== メニュー入力（キーボード / パッド） ======
  function handleMenuInput(ma) {
    if (Game.phase === "playing" && !Game.paused) {
      if (ma.pause) pauseGame();
      return;
    }
    if (!currentScreen) return;
    const list = menuButtons();
    if (!list.length) return;
    if (ma.up || ma.down) {
      focusIdx = (focusIdx + (ma.down ? 1 : -1) + list.length) % list.length;
      applyFocus();
      AudioEngine.sfx("menuMove");
    }
    if (ma.confirm) list[focusIdx].click();
    else if (ma.back) {
      if (currentScreen === "difficulty" || currentScreen === "controls") { AudioEngine.sfx("menuBack"); show("title"); }
      else if (currentScreen === "pause") resumeGame();
    }
  }

  // ====== パッド接続表示 ======
  const padStatus = document.getElementById("pad-status");
  let padStatusT = 0;
  function updatePadStatus(dt) {
    padStatusT -= dt;
    if (padStatusT > 0) return;
    padStatusT = 0.5;
    const n = Input.padCount();
    padStatus.textContent = n > 0 ? `🎮 コントローラー: ${n}台 接続中` : "🎮 コントローラー: 未接続（接続後にボタンを押してください）";
    padStatus.classList.toggle("on", n > 0);
  }

  // ====== メインループ ======
  let lastT = performance.now();
  let lastCountdownInt = 4;

  function frame(nowT) {
    const dt = Math.min(0.05, (nowT - lastT) / 1000);
    lastT = nowT;

    Input.update();
    handleMenuInput(Input.menuActions());
    updatePadStatus(dt);

    FX.update(dt);
    const hitstopped = FX.hitstopT > 0;
    FX.hitstopT = Math.max(0, FX.hitstopT - dt);

    if (Game.phase === "countdown") {
      Game.countdown -= dt;
      const n = Math.ceil(Game.countdown);
      if (n !== lastCountdownInt && n > 0) { sfx("countdown"); lastCountdownInt = n; }
      if (Game.countdown <= 0) {
        Game.phase = "playing";
        lastCountdownInt = 4;
        sfx("go");
        AudioEngine.startBGM("battle");
        FX.musicOn = true;
        FX.bpm = 150;
        FX.flash("#ffffff", 0.3, 0.25);
      }
    } else if ((Game.phase === "playing" || Game.phase === "attract") && !Game.paused) {
      if (!hitstopped) {
        for (const p of Game.players) p.update(dt);
      }
      if (Game.phase === "playing") {
        Game.matchTime += dt;
        Game.levelTimer += dt;
        if (Game.levelTimer >= 30 && Game.level < 12) {
          Game.levelTimer = 0;
          Game.level++;
          Game.players.forEach((p) => p.setLevel(Game.level));
          sfx("levelup");
          FX.floatText(W / 2, H / 2 - 120, "SPEED UP!", "#7df9ff", 36);
          FX.flash("#00f6ff", 0.12, 0.3);
        }
        const danger = Game.players.some((p) => p.danger && !p.dead);
        if (danger) {
          Game.heartbeatT += dt;
          if (Game.heartbeatT >= 0.95) { Game.heartbeatT = 0; sfx("heartbeat"); }
        }
      }
    }

    for (const p of Game.players) {
      if (p.fxJolt) p.fxJolt = Math.max(0, p.fxJolt - dt * 40);
      if (p.fxBorder) p.fxBorder = Math.max(0, p.fxBorder - dt);
    }

    Renderer.draw(ctx, Game);

    Input.endFrame();
    requestAnimationFrame(frame);
  }

  // ====== 起動 ======
  Input.init();
  createMatch("attract");
  show("title");
  requestAnimationFrame(frame);

  // デバッグ/検証用フック
  window.NTB_DEBUG = Game;
})();
