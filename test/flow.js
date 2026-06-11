/* flow.js — 対戦終了までの一連フロー検証
   鬼COM戦で放置 → KO → リザルト → 再戦 → タイトル復帰 */
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
  await new Promise((r) => server.listen(8732, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:8732/");
  await page.waitForTimeout(800);

  // 鬼COM戦を開始、1Pはハードドロップ連打 → 速攻でやられてリザルトが出るはず
  await page.click('button[data-action="vs-com"]');
  await page.click('button[data-action="diff-3"]');
  console.log("battle started (oni), spamming hard drop until KO...");
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await page.locator("#screen-result.active").count()) break;
    await page.keyboard.press("KeyW");
    await page.waitForTimeout(140);
  }
  await page.waitForSelector("#screen-result.active", { timeout: 5000 });
  const banner = await page.textContent("#result-banner");
  const score = await page.textContent("#result-score");
  console.log("result:", banner.trim(), "/", score.trim());
  await page.screenshot({ path: path.join(__dirname, "shot-result.png") });

  // 再戦
  await page.click('button[data-action="rematch"]');
  await page.waitForTimeout(4500);
  const resultGone = !(await page.locator("#screen-result.active").count());
  console.log("rematch started:", resultGone);

  // ポーズからタイトルへ
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.click('button[data-action="title"]');
  await page.waitForTimeout(800);
  const titleBack = await page.locator("#screen-title.active").isVisible();
  console.log("back to title:", titleBack);
  await page.waitForTimeout(8000); // アトラクトモードを少し回す
  await page.screenshot({ path: path.join(__dirname, "shot-attract.png") });

  await browser.close();
  server.close();
  if (errors.length) {
    console.error("CONSOLE ERRORS:"); errors.forEach((e) => console.error("  " + e));
    process.exit(1);
  }
  if (!banner.includes("WIN") || !titleBack) { console.error("flow assertions failed"); process.exit(1); }
  console.log("FLOW TEST PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
