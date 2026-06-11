/* smoke.js — Playwright によるブラウザ起動確認
   ページ読込 → コンソールエラー検出 → COM対戦開始 → 数秒プレイ → スクリーンショット */
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
  await new Promise((r) => server.listen(8731, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:8731/");
  await page.waitForTimeout(1500); // タイトル + アトラクトデモ起動待ち

  // タイトル画面の確認
  const titleVisible = await page.locator("#screen-title.active").isVisible();
  console.log("title screen visible:", titleVisible);
  await page.screenshot({ path: path.join(__dirname, "shot-title.png") });

  // COM対戦（ふつう）を開始
  await page.click('button[data-action="vs-com"]');
  await page.waitForTimeout(300);
  await page.click('button[data-action="diff-1"]');
  await page.waitForTimeout(3500); // カウントダウン完了待ち

  // 1P を少し操作（移動・回転・ハードドロップ）
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("KeyA");
    await page.keyboard.press("KeyG");
    await page.keyboard.press("KeyW");
    await page.waitForTimeout(350);
  }
  await page.screenshot({ path: path.join(__dirname, "shot-battle.png") });

  // ポーズ → 再開
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const pauseVisible = await page.locator("#screen-pause.active").isVisible();
  console.log("pause screen visible:", pauseVisible);
  await page.click('button[data-action="resume"]');
  await page.waitForTimeout(500);

  // ゲーム状態の内部確認
  const state = await page.evaluate(() => ({
    phase: undefined, // main.js はクロージャなので直接は見えない
    canvasW: document.getElementById("game").width,
    hasCtx: !!document.getElementById("game").getContext("2d"),
  }));
  console.log("canvas:", JSON.stringify(state));

  await browser.close();
  server.close();

  if (errors.length) {
    console.error("CONSOLE ERRORS:");
    errors.forEach((e) => console.error("  " + e));
    process.exit(1);
  }
  if (!titleVisible || !pauseVisible) {
    console.error("UI screens not behaving as expected");
    process.exit(1);
  }
  console.log("SMOKE TEST PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
