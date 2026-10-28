import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GameSession } from '../game/session';
import { useTicker } from './useTicker';

/**
 * Developer-only overlay (F3): performance counters plus an AI inspector that
 * explains what the selected bot is doing and why. Draws the bot's current
 * path and last-known enemy positions into the 3D scene.
 */
export function DebugOverlay({ session }: { session: GameSession }) {
  useTicker(6);
  const sim = session.sim;
  const bots = [...session.bots.brains.values()];
  const [idx, setIdx] = useState(0);
  const brain = bots.length ? bots[((idx % bots.length) + bots.length) % bots.length] : undefined;
  const lineRef = useRef<THREE.Line | null>(null);
  const markersRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'PageDown' || e.code === 'Period') setIdx((i) => i + 1);
      if (e.code === 'PageUp' || e.code === 'Comma') setIdx((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#7dff9a', depthTest: false }));
    line.renderOrder = 20;
    const markers = new THREE.Group();
    session.renderer.scene.add(line, markers);
    lineRef.current = line;
    markersRef.current = markers;
    return () => {
      window.removeEventListener('keydown', onKey);
      session.renderer.scene.remove(line, markers);
      line.geometry.dispose();
    };
  }, [session]);

  // Path + last-known enemy markers.
  if (brain && lineRef.current && markersRef.current) {
    const d = brain.debug;
    const pts = [brain.hero.pos, ...d.path].map((p) => new THREE.Vector3(p.x, p.y + 0.4, p.z));
    lineRef.current.geometry.dispose();
    lineRef.current.geometry = new THREE.BufferGeometry().setFromPoints(pts.length > 1 ? pts : [new THREE.Vector3(), new THREE.Vector3()]);
    const g = markersRef.current;
    while (g.children.length) g.remove(g.children[0]);
    for (const c of d.contacts) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: c.visible ? '#ff5050' : '#ffb050', wireframe: true, depthTest: false }));
      m.position.set(c.pos.x, c.pos.y + 2.5, c.pos.z);
      g.add(m);
    }
  }

  const p = sim.perf;
  const r = session.renderer.stats;
  const f = session.frameStats;
  const perf = [
    `FPS ${f.fps.toFixed(0)}  frame ${f.frameMs.toFixed(1)}ms  ticks/frame ${f.ticksPerFrame}`,
    `sim ${p.tickMs.toFixed(2)}ms (ai ${p.aiMs.toFixed(2)} heroes ${p.heroesMs.toFixed(2)} units ${p.unitsMs.toFixed(2)} proj ${p.projectilesMs.toFixed(2)})`,
    `render ${r.renderMs.toFixed(1)}ms  draw calls ${r.drawCalls}  tris ${(r.triangles / 1000).toFixed(0)}k  geo ${r.geometries} tex ${r.textures}`,
    `units ${sim.units.size}  troopers ${sim.troopers.filter((t) => t.alive).length}  projectiles ${sim.projectiles.length}  zones ${sim.zones.length}  bots ${bots.length}`,
    (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? `heap ${((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
  ].join('\n');

  let ai = 'No bots';
  if (brain) {
    const d = brain.debug;
    const h = brain.hero;
    ai = [
      `[${idx % bots.length}] ${h.playerName} (${h.def.name}) ${h.team === 0 ? 'Amber' : 'Azure'} L${h.level}  ◈${h.souls}`,
      `personality ${brain.personality.name}  hp ${(h.hpFrac() * 100).toFixed(0)}%  lane ${brain.team.laneOf.get(h.id)}`,
      `GOAL ${d.goal} — ${d.reason}`,
      `state ${d.state}  action ${d.action}`,
      `target ${d.targetKind || '-'} #${d.targetId}  threat ${d.threat.toFixed(0)} dps`,
      d.retreatReason ? `last retreat: ${d.retreatReason}` : '',
      d.intent ? `team intent: ${d.intent}` : '',
      `known enemy heroes: ${d.contacts.map((c) => `#${c.id}${c.visible ? '' : `(${c.age.toFixed(1)}s)`}`).join(' ') || 'none'}`,
      `utilities:`,
      ...d.utilities.map((u) => `  ${u.score.toFixed(2).padStart(5)} ${u.kind.padEnd(7)} ${u.reason}`),
      `team calls: ${brain.team.calls.map((c) => `${c.kind}(${c.reason})`).join(', ') || 'none'}`,
      `focus target: #${brain.team.focusTarget}`,
      `PgUp/PgDn (or , .) to switch bot`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return (
    <>
      <div className="debug" data-testid="debug">
        {perf}
        {'\n\n'}
        {ai}
      </div>
    </>
  );
}
