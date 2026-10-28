import { useEffect, useRef } from 'react';
import type { GameSession } from '../../game/session';
import { SF } from '../../gameplay/types';

const W = 190;

/**
 * Minimap drawn on a canvas at ~12 Hz. It respects team vision: enemy units
 * only appear while visible to the viewer's team; enemy structures are always
 * shown (as in the reference game).
 */
export function Minimap({ session, size = W }: { session: GameSession; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const sim = session.sim;
    const b = sim.map.bounds;
    const mw = b.maxX - b.minX;
    const mh = b.maxZ - b.minZ;
    const scale = size / mw;
    const H = Math.round(mh * scale);
    const c = ref.current!;
    c.width = size * 2;
    c.height = H * 2;
    c.style.width = `${size}px`;
    c.style.height = `${H}px`;
    // CPU-backed canvases: the minimap is small and redrawn several times a
    // second; an accelerated canvas would throttle on (and stall behind) the GPU
    // work of the 3D view.
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.scale(2, 2);
    // Static background (buildings + streets) rendered once.
    const bg = document.createElement('canvas');
    bg.width = size * 2;
    bg.height = H * 2;
    const bctx = bg.getContext('2d', { willReadFrequently: true })!;
    bctx.scale(2, 2);
    const viewTeam = session.local ? session.local.team : 0;
    const flip = viewTeam === 1;
    const tx = (x: number) => (flip ? (b.maxX - x) * scale : (x - b.minX) * scale);
    const tz = (z: number) => (flip ? (z - b.minZ) * scale : (b.maxZ - z) * scale);
    bctx.fillStyle = '#0c0b12';
    bctx.fillRect(0, 0, size, H);
    for (const s of sim.map.solids) {
      if (s.invisible || !s.material.startsWith('building')) continue;
      const shade = Math.min(1, s.max.y / 30);
      bctx.fillStyle = `rgba(${40 + shade * 30},${38 + shade * 28},${52 + shade * 30},1)`;
      const x0 = tx(s.min.x);
      const x1 = tx(s.max.x);
      const z0 = tz(s.min.z);
      const z1 = tz(s.max.z);
      bctx.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
    }
    for (const st of sim.map.decor.streets) {
      bctx.fillStyle = st.kind === 'base' ? (st.team === 0 ? 'rgba(255,166,61,0.18)' : 'rgba(74,168,255,0.18)') : st.kind === 'plaza' ? 'rgba(120,110,140,0.25)' : 'rgba(0,0,0,0)';
      const x0 = tx(st.minX);
      const x1 = tx(st.maxX);
      const z0 = tz(st.minZ);
      const z1 = tz(st.maxZ);
      bctx.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
    }
    for (const lane of sim.map.lanes) {
      bctx.strokeStyle = lane.color;
      bctx.globalAlpha = 0.55;
      bctx.lineWidth = 2;
      bctx.beginPath();
      lane.path.forEach((p, i) => (i ? bctx.lineTo(tx(p.x), tz(p.z)) : bctx.moveTo(tx(p.x), tz(p.z))));
      bctx.stroke();
      bctx.globalAlpha = 1;
    }
    for (const z of sim.map.ziplines) {
      bctx.strokeStyle = z.team === 0 ? 'rgba(255,166,61,0.35)' : 'rgba(74,168,255,0.35)';
      bctx.setLineDash([2, 2]);
      bctx.lineWidth = 1;
      bctx.beginPath();
      z.points.forEach((p, i) => (i ? bctx.lineTo(tx(p.x), tz(p.z)) : bctx.moveTo(tx(p.x), tz(p.z))));
      bctx.stroke();
      bctx.setLineDash([]);
    }
    const draw = () => {
      ctx.clearRect(0, 0, size, H);
      ctx.drawImage(bg, 0, 0, size, H);
      const team = viewTeam;
      const col = (t: number) => (t === 0 ? '#ffa63d' : t === 1 ? '#4aa8ff' : '#c58bff');
      // Camps & boss.
      for (const camp of sim.camps) {
        const alive = camp.unitIds.some((id) => sim.units.get(id)?.alive);
        ctx.fillStyle = alive ? 'rgba(220,200,120,0.8)' : 'rgba(120,110,90,0.35)';
        ctx.beginPath();
        ctx.arc(tx(camp.def.pos.x), tz(camp.def.pos.z), 2 + camp.def.tier * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      const boss = sim.boss.unitId >= 0 ? sim.units.get(sim.boss.unitId) : undefined;
      ctx.strokeStyle = boss && boss.alive ? '#c58bff' : 'rgba(197,139,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx(sim.map.midBoss.pos.x), tz(sim.map.midBoss.pos.z), 5, 0, Math.PI * 2);
      ctx.stroke();
      // Structures.
      for (const s of sim.structures) {
        const x = tx(s.pos.x);
        const z = tz(s.pos.z);
        const r = s.def.type === 'patron' ? 6 : s.def.type === 'shrine' ? 4 : 3.5;
        ctx.save();
        ctx.translate(x, z);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = s.alive ? col(s.team) : 'rgba(80,80,80,0.6)';
        ctx.globalAlpha = s.alive ? (s.vulnerable ? 1 : 0.6) : 0.5;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        if (s.alive && s.hp < s.maxHp) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(-r, -r, r * 2, r * 2 * (1 - s.hp / s.maxHp));
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      // Troopers.
      for (const t of sim.troopers) {
        if (!t.alive) continue;
        if (t.team !== team && !t.visibleTo[team as 0 | 1]) continue;
        ctx.fillStyle = col(t.team);
        ctx.fillRect(tx(t.pos.x) - 1, tz(t.pos.z) - 1, 2, 2);
      }
      for (const n of sim.neutrals) {
        if (!n.alive || !n.visibleTo[team as 0 | 1]) continue;
        ctx.fillStyle = '#c58bff';
        ctx.fillRect(tx(n.pos.x) - 1, tz(n.pos.z) - 1, 2.5, 2.5);
      }
      // Heroes.
      for (const h of sim.heroes) {
        if (!h.alive) continue;
        const ally = h.team === team;
        if (!ally && !h.visibleTo[team as 0 | 1]) continue;
        if (!ally && h.flags & SF.INVISIBLE && !(h.flags & SF.REVEALED)) continue;
        const x = tx(h.pos.x);
        const z = tz(h.pos.z);
        const isLocal = h === session.local;
        ctx.fillStyle = isLocal ? '#ffffff' : col(h.team);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, z, isLocal ? 4.5 : 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (ally) {
          // World (sin yaw, cos yaw) maps to minimap (f*dx, -f*dz).
          const f = flip ? -1 : 1;
          const L = isLocal ? 9 : 7;
          ctx.strokeStyle = isLocal ? '#fff' : col(h.team);
          ctx.beginPath();
          ctx.moveTo(x, z);
          ctx.lineTo(x + f * Math.sin(h.yaw) * L, z - f * Math.cos(h.yaw) * L);
          ctx.stroke();
        }
      }
      // Pings.
      for (const p of sim.teams[team as 0 | 1].pings) {
        const age = sim.time - p.time;
        if (age > 6) continue;
        ctx.strokeStyle = p.kind === 'retreat' || p.kind === 'danger' ? '#ff5a5a' : p.kind === 'defend' ? '#6fe08a' : '#ffe08a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tx(p.pos.x), tz(p.pos.z), 3 + ((age * 8) % 8), 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    draw();
    const id = window.setInterval(draw, 80);
    return () => window.clearInterval(id);
  }, [session, size]);
  return <canvas ref={ref} className="minimap" data-testid="minimap" />;
}
