// End-to-end browser test of the real player flow, using the real input path
// (pointer lock, mouse look, keyboard). Usage:
//   npm run e2e                 # starts a Vite dev server on :5174
//   E2E_URL=http://host/ npm run e2e   # test an already-running build
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
let server = null;
let url = process.env.E2E_URL;
if (!url) {
  url = 'http://localhost:5174/';
  // Own process group, so stopping it also stops the node process under npx.
  server = spawn('npx', ['vite', '--port', '5174', '--strictPort'], { stdio: 'pipe', detached: true });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // Already exited.
    }
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dev server did not start')), 30000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const S = (fn, arg) => page.evaluate(fn, arg);
// Software WebGL (headless CI) can run at a few frames per second, so every
// wait below is measured in simulation time rather than wall-clock time.
/** Waits until the simulation clock advances by `seconds`. */
async function waitSim(seconds, maxWallMs = 60000) {
  const t0 = await S(() => window.__hexline.sim.time);
  const start = Date.now();
  while (Date.now() - start < maxWallMs) {
    const t = await S(() => window.__hexline.sim.time);
    if (t - t0 >= seconds) return;
    await page.waitForTimeout(50);
  }
}
/** Polls `fn` until it returns true or `seconds` of simulation time pass. */
async function waitUntil(fn, seconds = 1, maxWallMs = 60000) {
  const t0 = await S(() => window.__hexline.sim.time);
  const start = Date.now();
  while (Date.now() - start < maxWallMs) {
    if (await S(fn)) return true;
    const t = await S(() => window.__hexline.sim.time);
    if (t - t0 >= seconds) return !!(await S(fn));
    await page.waitForTimeout(30);
  }
  return false;
}

try {
  await page.goto(url);
  // Default to the low preset (no shadows/post) so software GL stays usable.
  await S((preset) => {
    const raw = localStorage.getItem('hexline.settings.v1');
    const s = raw ? JSON.parse(raw) : {};
    s.quality = { preset };
    localStorage.setItem('hexline.settings.v1', JSON.stringify(s));
  }, process.env.E2E_QUALITY ?? 'low');
  await page.reload();
  await page.waitForSelector('[data-testid=play]', { timeout: 30000 });
  check('loads the main menu', true);
  await page.click('[data-testid=play]');
  await page.click('[data-testid=hero-cinder]');
  await page.click('[data-testid=start-match]');
  await page.waitForSelector('[data-testid=hud]', { timeout: 60000 });
  check('starts a match', true);
  await page.screenshot({ path: `${OUT}/e2e-01-start.png` });

  // Move the hero out of the fountain onto the street so ammo isn't refilled.
  await S(() => {
    const s = window.__hexline;
    const h = s.local;
    h.pos = { x: 0, y: 0, z: -80 };
    h.prevPos = { ...h.pos };
    s.sim.phase = 'playing';
  });
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  check('captures the pointer', await S(() => !!document.pointerLockElement));

  // Movement (W for 1s).
  const p0 = await S(() => ({ ...window.__hexline.local.pos }));
  await page.keyboard.down('KeyW');
  await waitSim(1);
  await page.keyboard.up('KeyW');
  const p1 = await S(() => ({ ...window.__hexline.local.pos }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('moves the player with WASD', moved > 1.5, `${moved.toFixed(2)} m`);

  // Aiming (mouse look).
  // Synthetic pointer-locked moves net to zero movementX in headless Chromium,
  // so inject relative mouse motion through the same window listener.
  const yaw0 = await S(() => window.__hexline.renderer.cam.yaw);
  await S(() => {
    for (let i = 0; i < 5; i++) window.dispatchEvent(new MouseEvent('mousemove', { movementX: 40, movementY: 0 }));
  });
  await waitSim(0.2);
  const yaw1 = await S(() => window.__hexline.renderer.cam.yaw);
  check('aims with the mouse', Math.abs(yaw1 - yaw0) > 0.05, `dyaw ${(yaw1 - yaw0).toFixed(3)}`);

  // Jump.
  await page.keyboard.press('Space');
  check('jumps', await waitUntil(() => !window.__hexline.local.grounded || window.__hexline.local.pos.y > 0.2, 1));
  await waitSim(1.2);

  // Shooting consumes ammo.
  const ammo0 = await S(() => window.__hexline.local.weapon.ammo);
  await page.mouse.down();
  await waitSim(0.5);
  await page.mouse.up();
  const ammo1 = await S(() => window.__hexline.local.weapon.ammo);
  check('shoots (ammo consumed)', ammo1 < ammo0, `${ammo0} -> ${ammo1}`);

  // Reload.
  await page.keyboard.press('KeyR');
  check('reloads', await waitUntil(() => window.__hexline.local.weapon.reloading, 0.5));

  // Unlock an ability with Alt+1, then cast it.
  await page.keyboard.down('AltLeft');
  await page.keyboard.press('Digit3');
  await page.keyboard.up('AltLeft');
  check('upgrades an ability (Alt+3)', await waitUntil(() => window.__hexline.local.abilities[2].level === 1, 0.5));
  await S(() => {
    // Give Combustion a target: an enemy hero standing 10 m down the open mid
    // lane, with its bot brain detached so it stays put, and the camera on it.
    const s = window.__hexline;
    const enemy = s.sim.heroes.find((h) => h.team !== s.local.team && h.alive);
    s.bots.brains.delete(enemy.id);
    enemy.input = { moveX: 0, moveZ: 0, yaw: enemy.yaw, pitch: 0, buttons: 0 };
    enemy.zip = null; // bots may already be riding a zipline out of base
    enemy.vel = { x: 0, y: 0, z: 0 };
    s.local.pos = { x: 0, y: 0, z: -50 };
    s.local.prevPos = { ...s.local.pos };
    enemy.pos = { x: 0, y: 0, z: -40 };
    enemy.prevPos = { ...enemy.pos };
    s.renderer.cam.yaw = 0;
    s.renderer.cam.pitch = -0.05;
    window.__e2eWarnings = [];
    window.__e2eEnemy = enemy.id;
    s.subscribe((e) => {
      if (e.t === 'announce' && e.kind === 'warning') window.__e2eWarnings.push(e.text);
      if (e.t === 'death' && e.unit === enemy.id) window.__e2eWarnings.push(`enemy died (killer ${e.killer})`);
    });
  });
  // Let the (frame-smoothed) camera catch up with the teleport before aiming.
  await waitSim(0.6);
  await page.keyboard.press('Digit3');
  await waitUntil(() => window.__hexline.local.abilities[2].cooldownEnd > window.__hexline.sim.time, 1);
  const cd = await S(() => window.__hexline.local.abilities[2].cooldownEnd - window.__hexline.sim.time);
  const castInfo = await S(() => {
    const s = window.__hexline;
    const h = s.local;
    const e = s.sim.units.get(window.__e2eEnemy);
    const r = (v) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`;
    return `locked=${!!document.pointerLockElement} paused=${s.paused} warnings=${JSON.stringify(window.__e2eWarnings)} me=${r(h.pos)} yaw=${h.input.yaw.toFixed(3)} pitch=${h.input.pitch.toFixed(3)} enemy=${e?.def.id}@${e ? r(e.pos) : '-'} alive=${e?.alive} hp=${e?.hp?.toFixed(0)} flags=${e?.flags} cam=${r(s.renderer.cam.camera.position)}`;
  });
  check('casts an ability (cooldown started)', cd > 0, cd > 0 ? `${cd.toFixed(1)}s` : castInfo);

  // Shop: walk into a shop, open with B, buy an item.
  await S(() => {
    const s = window.__hexline;
    const shop = s.sim.map.shops.find((x) => x.team === s.local.team);
    s.local.pos = { ...shop.pos };
    s.local.prevPos = { ...shop.pos };
    s.local.souls = 5000;
  });
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyB');
  await page.waitForSelector('[data-testid=shop]', { timeout: 5000 });
  check('opens the shop', true);
  await page.click('[data-testid=item-iron-lung]');
  await page.click('[data-testid=buy]');
  check('purchases an item', await waitUntil(() => window.__hexline.local.items.some((i) => i.def.id === 'iron-lung'), 0.5));
  await page.screenshot({ path: `${OUT}/e2e-02-shop.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('closes the shop', (await page.$('[data-testid=shop]')) === null);

  // Death and respawn.
  await S(() => {
    const s = window.__hexline;
    s.sim.dealDamage(s.local, { sourceId: -1, amount: 1e6, type: 'pure' });
  });
  check('dies', await waitUntil(() => !window.__hexline.local.alive, 0.5));
  await page.screenshot({ path: `${OUT}/e2e-03-dead.png` });
  await S(() => {
    const s = window.__hexline;
    s.local.respawnAt = s.sim.time + 0.3;
  });
  check('respawns', await waitUntil(() => window.__hexline.local.alive && window.__hexline.sim.inFountain(window.__hexline.local), 2));

  // Pause and resume.
  await page.mouse.click(640, 360);
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=pause]', { timeout: 5000 });
  const t0 = await S(() => window.__hexline.sim.time);
  await page.waitForTimeout(500);
  const t1 = await S(() => window.__hexline.sim.time);
  check('pauses the simulation', Math.abs(t1 - t0) < 1e-6);
  await page.click('[data-testid=resume]');
  await page.waitForTimeout(300);
  check('resumes', (await page.$('[data-testid=pause]')) === null);

  // Scoreboard (hold Tab).
  await page.keyboard.down('Tab');
  await page.waitForTimeout(200);
  check('shows the scoreboard', (await page.$('[data-testid=scoreboard]')) !== null);
  await page.keyboard.up('Tab');

  // Complete the match: destroy the enemy objective chain.
  await S(() => {
    const s = window.__hexline;
    const enemy = s.local.team === 0 ? 'b' : 'a';
    for (const st of s.sim.structures) if (st.key.startsWith(enemy)) {
      s.sim.dealDamage(st, { sourceId: s.local.id, amount: 1e9, type: 'pure', ignoreGates: true });
      if (st.alive) s.sim.dealDamage(st, { sourceId: s.local.id, amount: 1e9, type: 'pure', ignoreGates: true });
    }
  });
  check('match ends in victory', await waitUntil(() => window.__hexline.sim.phase === 'ended' && window.__hexline.sim.winner === window.__hexline.local.team, 2));
  await page.screenshot({ path: `${OUT}/e2e-04-victory.png` });
  await page.waitForSelector('[data-testid=results]', { timeout: 90000 });
  check('shows match results', true);
  await page.screenshot({ path: `${OUT}/e2e-05-results.png` });
  await page.click('[data-testid=rematch]');
  await page.waitForSelector('[data-testid=hud]', { timeout: 60000 });
  check('rematch starts a new match', true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=pause]', { timeout: 5000 });
  await page.click('[data-testid=quit]');
  await page.waitForSelector('[data-testid=play]', { timeout: 10000 });
  check('returns to the main menu', true);
} catch (e) {
  check('unexpected error', false, e.message);
  await page.screenshot({ path: `${OUT}/e2e-error.png` }).catch(() => {});
}
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
