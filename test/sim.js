/* sim.js — ヘッドレス動作検証（Node）
   コア機能のユニット検証 + AI vs AI のフル対戦シミュレーション */
"use strict";

const Core = require("../js/core.js");
const Player = require("../js/player.js");
const { AIController, DIFFICULTIES } = require("../js/ai.js");

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ✓ " + msg); }
  else { failures++; console.error("  ✗ FAIL: " + msg); }
}

// ---- コア検証 ----
console.log("[core]");
{
  const b = Core.createBoard();
  assert(b.length === Core.ROWS && b[0].length === Core.COLS, "盤面サイズ");

  // 全ピース・全回転が4セル
  for (const name of Core.PIECE_NAMES) {
    for (let r = 0; r < 4; r++) {
      assert(Core.PIECES[name].rotations[r].length === 4, `${name} rot${r} は4セル`);
    }
  }

  // バッグは7種1巡
  const rng = Core.mulberry32(42);
  const bag = Core.makeBag(rng);
  assert(new Set(bag).size === 7, "バッグに7種すべて");

  // ライン消去
  const b2 = Core.createBoard();
  for (let x = 0; x < Core.COLS; x++) b2[Core.ROWS - 1][x] = "G";
  const full = Core.findFullRows(b2);
  assert(full.length === 1 && full[0] === Core.ROWS - 1, "満杯行の検出");
  Core.clearRows(b2, full);
  assert(Core.isBoardEmpty(b2), "消去後は空");

  // ガーベジ
  Core.addGarbage(b2, 3, 4);
  let g = 0, holes = 0;
  for (let y = Core.ROWS - 3; y < Core.ROWS; y++) {
    for (let x = 0; x < Core.COLS; x++) {
      if (b2[y][x] === "G") g++;
      else holes++;
    }
  }
  assert(g === 27 && holes === 3, "ガーベジ3行（穴1列）");

  // 攻撃テーブル
  assert(Core.attackOf({ lines: 4, combo: 0 }) === 4, "テトリス = 4攻撃");
  assert(Core.attackOf({ lines: 4, b2b: true, combo: 0 }) === 5, "B2Bテトリス = 5攻撃");
  assert(Core.attackOf({ lines: 2, tspin: true, combo: 0 }) === 4, "TSD = 4攻撃");
  assert(Core.attackOf({ lines: 1, combo: 0 }) === 0, "シングル = 0攻撃");
  assert(Core.attackOf({ lines: 1, combo: 0, perfectClear: true }) === 10, "パフェ = +10");

  // SRS: 空盤面で T を4回右回転すると元に戻る
  const b3 = Core.createBoard();
  let rot = 0, x = 3, y = 10;
  for (let i = 0; i < 4; i++) {
    const to = (rot + 1) & 3;
    const kicks = Core.getKicks("T", rot, to);
    let ok = false;
    for (const [dx, dy] of kicks) {
      if (!Core.collides(b3, "T", to, x + dx, y + dy)) { rot = to; x += dx; y += dy; ok = true; break; }
    }
    assert(ok, `T回転 ${i + 1}回目成功`);
  }
  assert(rot === 0 && x === 3 && y === 10, "4回転で原状復帰");
}

// ---- プレイヤー単体 ----
console.log("[player]");
{
  const events = { cleared: [], onClear(p, info) { this.cleared.push(info); } };
  const p = new Player({ index: 0, seed: 7, controller: null, events });
  // コントローラ無しで放置 → 重力で積もり続けいつか死ぬ
  let t = 0;
  while (!p.dead && t < 3600) { p.update(1 / 60); t += 1 / 60; }
  assert(p.dead, "放置プレイヤーはトップアウトする (t=" + t.toFixed(1) + "s)");

  // ガーベジ受信
  const p2 = new Player({ index: 0, seed: 8, controller: null, events: {} });
  p2.receiveGarbage(5);
  assert(p2.pendingGarbage === 5, "ガーベジ予告キュー");
  p2.riseGarbage();
  assert(p2.pendingGarbage === 0 && Core.stackHeight(p2.board) === 5, "せり上がり5行");
}

// ---- AI 配置探索 ----
console.log("[ai]");
{
  const { enumeratePlacements } = require("../js/ai.js");
  const b = Core.createBoard();
  const moves = enumeratePlacements(b, "I", DIFFICULTIES[1], { pendingGarbage: 0 });
  assert(moves.length > 10, "I ピースの配置候補が列挙される (" + moves.length + ")");

  // 9列埋めた盤面で I を縦に入れればテトリス → 上位候補が4ライン消し
  const b4 = Core.createBoard();
  for (let y = Core.ROWS - 4; y < Core.ROWS; y++) {
    for (let x = 0; x < Core.COLS - 1; x++) b4[y][x] = "J";
  }
  const m2 = enumeratePlacements(b4, "I", DIFFICULTIES[3], { pendingGarbage: 0 });
  assert(m2[0].lines === 4, "鬼AIはテトリスを最優先");
}

// ---- AI vs AI フル対戦 ----
console.log("[match] AI vs AI 対戦シミュレーション");
for (const [d1, d2] of [[1, 1], [3, 0], [2, 3]]) {
  const log = { attacks: [[], []], deaths: [] };
  const players = [];
  const mk = (idx, diff) => {
    const events = {
      onClear(p, info) {
        if (info.attackAfterCancel > 0) {
          log.attacks[idx].push(info.attackAfterCancel);
          players[1 - idx].receiveGarbage(info.attackAfterCancel);
        }
      },
      onDeath() { log.deaths.push(idx); },
    };
    return new Player({ index: idx, seed: 12345, controller: new AIController(diff), events });
  };
  players.push(mk(0, d1), mk(1, d2));

  let t = 0;
  const maxT = 600;
  while (log.deaths.length === 0 && t < maxT) {
    players[0].update(1 / 60);
    players[1].update(1 / 60);
    t += 1 / 60;
    if (t > 60 && Math.floor(t) % 30 === 0 && Math.abs(t - Math.floor(t)) < 1 / 120) {
      players.forEach((p) => p.setLevel(1 + Math.floor(t / 30)));
    }
  }
  const sent = [log.attacks[0].reduce((a, b) => a + b, 0), log.attacks[1].reduce((a, b) => a + b, 0)];
  console.log(`  難易度 ${DIFFICULTIES[d1].name} vs ${DIFFICULTIES[d2].name}: ` +
    `${t.toFixed(0)}s で決着, 攻撃 ${sent[0]} vs ${sent[1]}, 敗者=${log.deaths[0] !== undefined ? (log.deaths[0] === 0 ? "P1" : "P2") : "なし"}`);
  assert(log.deaths.length > 0, "試合が決着する");
  assert(sent[0] + sent[1] > 0, "攻撃が発生する");
  if (d1 === 3 && d2 === 0) assert(log.deaths[0] === 1, "鬼がやさしいに勝つ");
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
