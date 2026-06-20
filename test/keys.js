/* keys.js — PC キー配置の検証
   ・ソロ: 矢印キー(右手移動) と WASD(左手移動) の両方が効く
   ・ソロ: Z/X 回転、C ホールド、↑/Space ハードドロップ
   ・ふたりで対戦: 矢印は2Pを動かし、1P(WASD)は動かない（取り合いにならない） */
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

let failures = 0;
function check(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { failures++; console.error("  ✗ FAIL: " + msg); }
}

const px = (page, i) => page.evaluate((i) => {
  const a = window.NTB_DEBUG.players[i].active; return a ? a.x : null;
}, i);
const prot = (page, i) => page.evaluate((i) => {
  const a = window.NTB_DEBUG.players[i].active; return a ? a.rot : null;
}, i);

(async () => {
  await new Promise((r) => server.listen(8737, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:8737/");
  await page.waitForTimeout(500);

  // ===== ソロ =====
  console.log("[solo] 右手モード(矢印) と 左手モード(WASD)");
  await page.click('button[data-action="solo"]');
  await page.waitForTimeout(3400); // カウントダウン
  await page.waitForFunction(() => window.NTB_DEBUG.phase === "playing" && window.NTB_DEBUG.players[0].active, { timeout: 15000 });

  // 矢印キーで移動（右手）
  let x0 = await px(page, 0);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(120);
  check((await px(page, 0)) === x0 - 1, "ArrowLeft で左へ");
  x0 = await px(page, 0);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(120);
  check((await px(page, 0)) === x0 + 1, "ArrowRight で右へ");

  // WASD でも移動（左手）
  x0 = await px(page, 0);
  await page.keyboard.press("KeyA");
  await page.waitForTimeout(120);
  check((await px(page, 0)) === x0 - 1, "KeyA でも左へ（両対応）");
  x0 = await px(page, 0);
  await page.keyboard.press("KeyD");
  await page.waitForTimeout(120);
  check((await px(page, 0)) === x0 + 1, "KeyD でも右へ（両対応）");

  // Z/X 回転（左手操作）
  let r0 = await prot(page, 0);
  await page.keyboard.press("KeyX");
  await page.waitForTimeout(120);
  check((await prot(page, 0)) === (r0 + 1) % 4, "KeyX で右回転");
  r0 = await prot(page, 0);
  await page.keyboard.press("KeyZ");
  await page.waitForTimeout(120);
  check((await prot(page, 0)) === (r0 + 3) % 4, "KeyZ で左回転");

  // C ホールド
  const held0 = await page.evaluate(() => window.NTB_DEBUG.players[0].holdType);
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(150);
  const held1 = await page.evaluate(() => window.NTB_DEBUG.players[0].holdType);
  check(held0 === null && held1 !== null, "KeyC でホールド");

  // ↑ ハードドロップ
  let pcs = await page.evaluate(() => window.NTB_DEBUG.players[0].stats.pieces);
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction((n) => window.NTB_DEBUG.players[0].stats.pieces > n, pcs, { timeout: 4000 });
  check(true, "ArrowUp でハードドロップ");
  // Space ハードドロップ
  pcs = await page.evaluate(() => window.NTB_DEBUG.players[0].stats.pieces);
  await page.keyboard.press("Space");
  await page.waitForFunction((n) => window.NTB_DEBUG.players[0].stats.pieces > n, pcs, { timeout: 4000 });
  check(true, "Space でハードドロップ");

  // ポーズへ戻ってタイトルへ
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.click('button[data-action="title"]');
  await page.waitForTimeout(400);

  // ===== ふたりで対戦: 矢印は2P、1Pは反応しない =====
  console.log("[human] 矢印は2P専用・1Pは矢印で動かない");
  await page.click('button[data-action="vs-human"]');
  await page.waitForTimeout(3400);
  await page.waitForFunction(() => window.NTB_DEBUG.phase === "playing" && window.NTB_DEBUG.players[0].active && window.NTB_DEBUG.players[1].active, { timeout: 15000 });

  const p1x0 = await px(page, 0), p2x0 = await px(page, 1);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(120);
  const p1x1 = await px(page, 0), p2x1 = await px(page, 1);
  check(p1x1 === p1x0, "ArrowLeft で1Pは動かない");
  check(p2x1 === p2x0 - 1, "ArrowLeft で2Pが動く");

  // 1Pは WASD で動く
  await page.keyboard.press("KeyD");
  await page.waitForTimeout(120);
  check((await px(page, 0)) === p1x0 + 1, "KeyD で1Pが動く");

  await browser.close();
  server.close();
  if (errors.length) { console.error("CONSOLE ERRORS:"); errors.forEach((e) => console.error("  " + e)); process.exit(1); }
  console.log(failures === 0 ? "KEYS TEST PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
