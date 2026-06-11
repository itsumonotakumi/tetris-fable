/* mobile.js — スマホ対応の検証
   縦画面レイアウト（対戦=縦積み / ソロ）、タッチ操作、ソロのゲームオーバーまで */
"use strict";
const { chromium, devices } = require("playwright");
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
  await new Promise((r) => server.listen(8735, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: devices["iPhone 13"].userAgent,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:8735/");
  await page.waitForTimeout(800);

  // ===== 1) 縦画面の対戦レイアウト = 縦積み =====
  await page.tap('button[data-action="vs-com"]');
  await page.tap('button[data-action="diff-0"]');
  await page.waitForTimeout(600);
  const vsLayout = await page.evaluate(() => ({
    W: window.Renderer.W, H: window.Renderer.H,
    portrait: window.Renderer.portrait,
    p1Y: window.Renderer.layouts[0].boardY,
    p2Y: window.Renderer.layouts[1].boardY,
    p1Cell: window.Renderer.layouts[0].cell,
    p2Cell: window.Renderer.layouts[1].cell,
  }));
  console.log("vs portrait layout:", JSON.stringify(vsLayout));
  if (!vsLayout.portrait || vsLayout.W !== 900) throw new Error("portrait layout not applied");
  if (!(vsLayout.p2Y < vsLayout.p1Y)) throw new Error("boards should be stacked (opponent on top)");

  // タッチボタンが表示されている
  await page.waitForTimeout(3200); // カウントダウン
  const tcVisible = await page.evaluate(() =>
    !document.getElementById("touch-controls").classList.contains("tc-hidden"));
  console.log("touch controls visible:", tcVisible);
  if (!tcVisible) throw new Error("touch controls should be visible");

  // ===== 2) タッチ操作: 左移動 / 回転 / ハードドロップ =====
  await page.waitForFunction(() => {
    const G = window.NTB_DEBUG;
    return G.phase === "playing" && G.players[0].active;
  }, { timeout: 15000 });
  const x0 = await page.evaluate(() => window.NTB_DEBUG.players[0].active.x);
  await page.tap('[data-tc="left"]');
  await page.waitForTimeout(400);
  const x1 = await page.evaluate(() => window.NTB_DEBUG.players[0].active ? window.NTB_DEBUG.players[0].active.x : -99);
  console.log("touch left:", x0, "->", x1);
  if (x1 !== x0 - 1) throw new Error("touch left should move piece");

  const r0 = await page.evaluate(() => window.NTB_DEBUG.players[0].active.rot);
  await page.tap('[data-tc="cw"]');
  await page.waitForTimeout(400);
  const r1 = await page.evaluate(() => window.NTB_DEBUG.players[0].active ? window.NTB_DEBUG.players[0].active.rot : -99);
  console.log("touch rotate:", r0, "->", r1);

  const pieces0 = await page.evaluate(() => window.NTB_DEBUG.players[0].stats.pieces);
  await page.tap('[data-tc="hard"]');
  await page.waitForFunction((n) => window.NTB_DEBUG.players[0].stats.pieces > n, pieces0, { timeout: 5000 });
  console.log("touch hard drop: piece locked");
  await page.screenshot({ path: path.join(__dirname, "shot-mobile-vs.png") });

  // タッチポーズ
  await page.tap("#tc-pause");
  await page.waitForTimeout(400);
  const pauseShown = await page.locator("#screen-pause.active").isVisible();
  console.log("touch pause:", pauseShown);
  if (!pauseShown) throw new Error("touch pause should open pause menu");
  await page.tap('button[data-action="title"]');
  await page.waitForTimeout(600);

  // ===== 3) ソロモード（縦画面）→ ゲームオーバーまで =====
  await page.tap('button[data-action="solo"]');
  await page.waitForTimeout(400);
  const soloLayout = await page.evaluate(() => ({
    solo: window.Renderer.solo,
    players: window.NTB_DEBUG.players.length,
    W: window.Renderer.W,
  }));
  console.log("solo layout:", JSON.stringify(soloLayout));
  if (!soloLayout.solo || soloLayout.players !== 1) throw new Error("solo mode should have 1 player");
  await page.waitForTimeout(3200);
  await page.screenshot({ path: path.join(__dirname, "shot-mobile-solo.png") });

  // ハードドロップ連打で積み上げてゲームオーバーへ
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await page.locator("#screen-result.active").count()) break;
    await page.tap('[data-tc="hard"]').catch(() => {});
    await page.waitForTimeout(120);
  }
  await page.waitForSelector("#screen-result.active", { timeout: 5000 });
  const banner = await page.textContent("#result-banner");
  const score = await page.textContent("#result-score");
  console.log("solo result:", banner.trim(), "/", score.trim());
  if (!banner.includes("GAME OVER")) throw new Error("solo should end with GAME OVER");
  await page.screenshot({ path: path.join(__dirname, "shot-mobile-result.png") });

  await browser.close();
  server.close();
  if (errors.length) {
    console.error("CONSOLE ERRORS:"); errors.forEach((e) => console.error("  " + e));
    process.exit(1);
  }
  console.log("MOBILE TEST PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
