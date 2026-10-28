// Mid-game visual check: spectate a bot match, fast-forward, capture frames.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = await import('node:fs');
const out = process.argv[2] ?? 'tests/e2e/output';
const skip = Number(process.argv[3] ?? 200);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
await page.goto('http://localhost:5173/');
await page.click('[data-testid=spectate]');
await page.click('[data-testid=start-match]');
await page.waitForSelector('[data-testid=hud]');
await page.evaluate((sec) => { const s = window.__hexline; s.sim.run(sec); s.sim.events.drain(); }, skip);
for (let i = 0; i < 4; i++) {
  await page.evaluate((i) => { const s = window.__hexline; s.spectate = s.sim.heroes[(i * 3) % s.sim.heroes.length]; }, i);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/mid-${i}.png` });
  const st = await page.evaluate(() => { const s = window.__hexline; return { t: s.sim.matchTime.toFixed(0), fps: s.frameStats.fps.toFixed(1), draws: s.renderer.stats.drawCalls, tris: s.renderer.stats.triangles, hero: s.spectate.playerName, goal: s.bots.brainOf(s.spectate.id)?.goal?.kind }; });
  console.log(JSON.stringify(st));
}
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
