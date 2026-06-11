/* tetris-fx.js — テトリス（4列消し）演出の検証
   盤面を細工して I ピースを井戸に落とし、ブラスト演出と攻撃送信を確認 */
"use strict";
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(8733, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:8733/");
  await page.click('button[data-action="vs-com"]');
  await page.click('button[data-action="diff-0"]');
  await page.waitForTimeout(3600); // カウントダウン待ち

  // 1P盤面を細工: 下4行を右端1列だけ残して埋める（+1個余分に置いてパフェ回避）
  // アクティブを縦 I にして右端の井戸へ
  const before = await page.evaluate(() => {
    const G = window.NTB_DEBUG;
    const p = G.players[0];
    const ROWS = p.board.length, COLS = p.board[0].length;
    for (let y = ROWS - 4; y < ROWS; y++) {
      for (let x = 0; x < COLS - 1; x++) p.board[y][x] = "J";
    }
    p.board[ROWS - 5][0] = "L"; // 残留ブロック → パーフェクトクリアにならない
    p.active = { type: "I", rot: 1, x: 7, y: 4 }; // rot1 の I は x+2 列 → 9列目
    return { sent: p.stats.sent, oppPending: G.players[1].pendingGarbage, phase: G.phase };
  });
  console.log("before:", JSON.stringify(before));

  await page.keyboard.press("KeyW"); // ハードドロップ → テトリス！
  await page.waitForTimeout(200);    // ブラスト最盛期
  await page.screenshot({ path: path.join(__dirname, "shot-tetris.png") });
  // コメット到達待ち（ヘッドレスは低fpsなので実時間で長めにポーリング）
  await page.waitForFunction(
    () => window.NTB_DEBUG.players[1].pendingGarbage > 0 ||
          window.NTB_DEBUG.players[1].board.some((row) => row.some((v) => v === "G")),
    { timeout: 15000 }
  );

  const after = await page.evaluate(() => {
    const G = window.NTB_DEBUG;
    const p = G.players[0];
    const opp = G.players[1];
    let filled = 0;
    p.board.forEach((row) => row.forEach((v) => { if (v) filled++; }));
    let garbageRows = 0;
    opp.board.forEach((row) => { if (row.some((v) => v === "G")) garbageRows++; });
    return {
      cleared: p.stats.cleared, sent: p.stats.sent, tetris: p.stats.tetris,
      oppPending: opp.pendingGarbage, oppGarbageRows: garbageRows, filledCells: filled,
    };
  });
  console.log("after:", JSON.stringify(after));

  await browser.close();
  server.close();
  if (errors.length) { console.error("CONSOLE ERRORS:"); errors.forEach((e) => console.error("  " + e)); process.exit(1); }
  if (after.tetris !== 1 || after.cleared !== 4) { console.error("tetris not registered"); process.exit(1); }
  if (after.sent !== 4) { console.error("tetris should send 4, got " + after.sent); process.exit(1); }
  if (after.filledCells !== 1) { console.error("board should keep 1 block, got " + after.filledCells); process.exit(1); }
  if (after.oppPending + after.oppGarbageRows !== 4) {
    console.error("opponent garbage mismatch: pending=" + after.oppPending + " rows=" + after.oppGarbageRows);
    process.exit(1);
  }
  console.log("TETRIS FX TEST PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
