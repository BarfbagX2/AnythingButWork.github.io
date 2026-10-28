// End-to-end test of online play: a real match server plus the real browser
// client joining it from the main menu. Usage:
//   npm run e2e:online                  # starts Vite on :5175 and a server on :8799
//   E2E_URL=http://host/ npm run e2e:online
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Install it with: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const OUT = 'tests/e2e/output';
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.E2E_SERVER_PORT ?? 8799);
const children = [];
let serverLog = '';

function waitFor(child, text, label, onData) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} did not start`)), 60000);
    const on = (d) => {
      onData?.(String(d));
      if (String(d).includes(text)) {
        clearTimeout(t);
        resolve();
      }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
  });
}

// Children run in their own process group so the npx/tsx wrappers and the real
// node process underneath are all stopped together.
const start = (cmd, args) => spawn(cmd, args, { stdio: 'pipe', detached: true });
const killAll = () => {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {
      // Already exited.
    }
  }
};
process.on('exit', killAll);

const server = start('npx', ['tsx', 'server/index.ts', '--port', String(PORT), '--team-size', '2', '--seed', '3', '--static', 'none', '--wait-for', '1']);
children.push(server);
await waitFor(server, 'listening', 'match server', (d) => (serverLog += d));
server.stdout.on('data', (d) => (serverLog += String(d)));

let url = process.env.E2E_URL;
if (!url) {
  url = 'http://localhost:5175/';
  const vite = start('npx', ['vite', '--port', '5175', '--strictPort']);
  children.push(vite);
  await waitFor(vite, 'Local', 'dev server');
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!(await fn());
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const S = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(url);
  await S(() => localStorage.setItem('hexline.settings.v1', JSON.stringify({ quality: { preset: 'low' } })));
  await page.reload();
  await page.click('[data-testid=online-menu]');
  await page.waitForSelector('[data-testid=online]');
  await page.fill('[data-testid=server-url]', `ws://localhost:${PORT}`);
  await page.fill('input[maxlength="16"]', 'E2E');
  await page.click('[data-testid=connect]');
  await page.waitForSelector('[data-testid=hud]', { timeout: 60000 });
  check('joins the server from the menu', true);
  check(
    'controls a server hero',
    await until(() => S(() => !!window.__hexline.remote && window.__hexline.local?.playerName === 'E2E' && !window.__hexline.local.isBot)),
  );
  check('server registered the player', await until(() => serverLog.includes('E2E joined as')));
  check('receives snapshots', await until(() => S(() => window.__hexline.remote.net.snapshotsIn > 10)), '');

  // Shop UI reflects the server's state (600 starting souls < 800 for tier 1,
  // so nothing is affordable yet; purchases are covered by the integration test).
  check('in shop range per server state', await until(() => S(() => window.__hexline.local.inShopRange), 5000));
  await page.keyboard.press('KeyB');
  check('opens the shop', await until(async () => (await page.$('[data-testid=shop]')) !== null, 8000));
  await page.keyboard.press('Escape');
  await until(async () => (await page.$('[data-testid=shop]')) === null, 5000);

  // An action round-trip: unlock ability 1 with the starting ability point.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  await page.keyboard.down('AltLeft');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('AltLeft');
  check('ability upgrade is applied by the server', await until(() => S(() => window.__hexline.local.abilities[0].level === 1)));

  const p0 = await S(() => ({ ...window.__hexline.local.pos }));
  await page.keyboard.down('KeyW');
  const moved = await until(async () => {
    const p = await S(() => ({ ...window.__hexline.local.pos }));
    return Math.hypot(p.x - p0.x, p.z - p0.z) > 2;
  });
  await page.keyboard.up('KeyW');
  const p1 = await S(() => ({ ...window.__hexline.local.pos }));
  const why = await S(() => {
    const h = window.__hexline.local;
    return `alive=${h.alive} zip=${!!h.zip} flags=${h.flags} phase=${window.__hexline.sim.phase} t=${window.__hexline.sim.time.toFixed(1)}`;
  });
  check('moves on the server (W)', moved, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m${moved ? '' : ` ${why}`}`);
  await page.screenshot({ path: `${OUT}/online-01-moving.png` });

  await page.waitForTimeout(300);
  if (!(await page.$('[data-testid=pause]'))) await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=pause]', { timeout: 8000 });
  await page.click('[data-testid=quit]');
  await page.waitForSelector('[data-testid=play]', { timeout: 10000 });
  check('quits to the menu', true);
  check('server returns the hero to the AI', await until(() => serverLog.includes('E2E left')));
} catch (e) {
  check('unexpected error', false, e.message);
  await page.screenshot({ path: `${OUT}/online-error.png` }).catch(() => {});
}
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
killAll();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
