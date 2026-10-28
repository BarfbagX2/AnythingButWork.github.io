/**
 * Procedural audio. Every sound is synthesised at runtime with WebAudio
 * (noise bursts, filtered oscillators, envelopes), so the game has no
 * dependency on audio files. Sounds are routed through category buses
 * (music / sfx / ui / voice) under a master bus, and world sounds are
 * spatialised with a PannerNode relative to the camera.
 */

export type SoundCategory = 'sfx' | 'ui' | 'voice' | 'music';

interface Vec {
  x: number;
  y: number;
  z: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<SoundCategory, GainNode>;
  private noiseBuf!: AudioBuffer;
  private volumes = { master: 0.8, music: 0.4, sfx: 0.8, ui: 0.7, voice: 0.7 };
  private listener = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
  private active = 0;
  private musicNodes: AudioNode[] = [];
  private musicTimer: number | null = null;
  readonly maxVoices = 48;

  /** Must be called from a user gesture (browser autoplay policy). */
  resume(): void {
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private init(): void {
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.buses = {
      sfx: ctx.createGain(),
      ui: ctx.createGain(),
      voice: ctx.createGain(),
      music: ctx.createGain(),
    };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    const len = ctx.sampleRate * 1.5;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  setVolumes(v: { master: number; music: number; sfx: number; ui: number; voice: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.02);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.02);
    this.buses.ui.gain.setTargetAtTime(this.volumes.ui, t, 0.02);
    this.buses.voice.gain.setTargetAtTime(this.volumes.voice, t, 0.02);
    this.buses.music.gain.setTargetAtTime(this.volumes.music * 0.5, t, 0.02);
  }

  setListener(pos: Vec, yaw: number): void {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.fx = Math.sin(yaw);
    this.listener.fz = Math.cos(yaw);
  }

  /** Output node for a sound: spatial (panner + distance gain) or direct. */
  private out(cat: SoundCategory, at?: Vec, maxDist = 70): AudioNode | null {
    const ctx = this.ctx!;
    if (!at) return this.buses[cat];
    const dx = at.x - this.listener.x;
    const dz = at.z - this.listener.z;
    const dy = at.y - this.listener.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return null;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, 1 - d / maxDist) ** 1.6;
    const pan = ctx.createStereoPanner();
    // Right vector = (-fz... ) facing +Z means right is -X.
    const rx = -this.listener.fz;
    const rz = this.listener.fx;
    const side = d > 0.01 ? (dx * -rx + dz * -rz) / d : 0;
    pan.pan.value = Math.max(-1, Math.min(1, -side * 0.85));
    g.connect(pan).connect(this.buses[cat]);
    return g;
  }

  private canPlay(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && this.active < this.maxVoices;
  }

  private track(node: AudioScheduledSourceNode, end: number): void {
    this.active++;
    node.onended = () => {
      this.active--;
    };
    node.stop(end);
  }

  private noise(dest: AudioNode, t: number, dur: number, gain: number, filter: { type: BiquadFilterType; f: number; q?: number; fEnd?: number }): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.setValueAtTime(filter.f, t);
    if (filter.fEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, filter.fEnd), t + dur);
    f.Q.value = filter.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    this.track(src, t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1?: number, attack = 0.005): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    this.track(o, t + dur + 0.05);
  }

  // --- Game sounds ------------------------------------------------------------------

  gunshot(style: string, at?: Vec, local = false): void {
    if (!this.canPlay()) return;
    const dest = local ? this.buses.sfx : this.out('sfx', at, 110);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    const v = local ? 0.55 : 0.4;
    switch (style) {
      case 'shotgun':
        this.noise(dest, t, 0.35, v * 1.3, { type: 'lowpass', f: 2600, fEnd: 300 });
        this.tone(dest, t, 0.2, v * 0.7, 'sine', 120, 45);
        break;
      case 'sniper':
        this.noise(dest, t, 0.08, v * 1.2, { type: 'highpass', f: 1800 });
        this.noise(dest, t, 0.6, v * 0.7, { type: 'lowpass', f: 1600, fEnd: 200 });
        this.tone(dest, t, 0.25, v * 0.6, 'triangle', 220, 60);
        break;
      case 'smg':
        this.noise(dest, t, 0.07, v * 0.7, { type: 'bandpass', f: 2200, q: 0.9 });
        this.tone(dest, t, 0.05, v * 0.3, 'square', 180, 90);
        break;
      case 'energy':
        this.tone(dest, t, 0.12, v * 0.5, 'sawtooth', 1400, 300);
        this.noise(dest, t, 0.06, v * 0.4, { type: 'highpass', f: 3000 });
        break;
      case 'cannon':
        this.tone(dest, t, 0.3, v * 0.9, 'sine', 140, 40);
        this.noise(dest, t, 0.25, v * 0.6, { type: 'lowpass', f: 900, fEnd: 120 });
        break;
      case 'pistol':
        this.noise(dest, t, 0.12, v * 0.9, { type: 'bandpass', f: 1500, q: 0.7 });
        this.tone(dest, t, 0.08, v * 0.4, 'triangle', 300, 100);
        break;
      default:
        this.noise(dest, t, 0.1, v * 0.8, { type: 'bandpass', f: 1800, q: 0.8 });
        this.tone(dest, t, 0.07, v * 0.35, 'square', 220, 90);
    }
  }

  trooperShot(at: Vec): void {
    if (!this.canPlay() || Math.random() < 0.4) return;
    const dest = this.out('sfx', at, 50);
    if (!dest) return;
    this.noise(dest, this.ctx!.currentTime, 0.06, 0.18, { type: 'bandpass', f: 2600, q: 1.2 });
  }

  hitmarker(crit: boolean, kill: boolean): void {
    if (!this.canPlay()) return;
    const t = this.ctx!.currentTime;
    const d = this.buses.ui;
    if (kill) {
      this.tone(d, t, 0.18, 0.35, 'triangle', 880, 880);
      this.tone(d, t + 0.08, 0.3, 0.3, 'triangle', 1320, 1320);
    } else if (crit) {
      this.tone(d, t, 0.06, 0.3, 'square', 1900, 1700);
      this.tone(d, t + 0.04, 0.06, 0.25, 'square', 2400, 2200);
    } else this.tone(d, t, 0.05, 0.18, 'square', 1400, 1200);
  }

  hurt(): void {
    if (!this.canPlay()) return;
    const t = this.ctx!.currentTime;
    this.noise(this.buses.sfx, t, 0.15, 0.25, { type: 'lowpass', f: 700 });
    this.tone(this.buses.sfx, t, 0.12, 0.2, 'sine', 200, 120);
  }

  ability(kind: string, at?: Vec, local = false): void {
    if (!this.canPlay()) return;
    const dest = local ? this.buses.sfx : this.out('sfx', at, 70);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    switch (kind) {
      case 'blast':
      case 'nova':
      case 'shockwave':
        this.noise(dest, t, 0.7, 0.6, { type: 'lowpass', f: 1200, fEnd: 80 });
        this.tone(dest, t, 0.5, 0.5, 'sine', 90, 35);
        break;
      case 'lightning':
        for (let i = 0; i < 4; i++) this.noise(dest, t + i * 0.03, 0.05, 0.35, { type: 'highpass', f: 2500 });
        break;
      case 'heal':
      case 'healBeam':
        this.tone(dest, t, 0.5, 0.18, 'sine', 660, 990, 0.05);
        this.tone(dest, t + 0.06, 0.5, 0.12, 'sine', 990, 1320, 0.05);
        break;
      case 'beam':
        this.tone(dest, t, 0.25, 0.25, 'sawtooth', 600, 200);
        break;
      case 'warn':
        this.tone(dest, t, 0.35, 0.2, 'square', 300, 300, 0.02);
        break;
      default:
        this.noise(dest, t, 0.35, 0.35, { type: 'bandpass', f: 600, q: 1.5, fEnd: 2400 });
        this.tone(dest, t, 0.25, 0.12, 'triangle', 300, 600);
    }
  }

  movement(kind: string, at: Vec, local: boolean): void {
    if (!this.canPlay()) return;
    const dest = local ? this.buses.sfx : this.out('sfx', at, 30);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    if (kind === 'dash' || kind === 'doubleJump') this.noise(dest, t, 0.25, local ? 0.25 : 0.15, { type: 'bandpass', f: 500, q: 1, fEnd: 1600 });
    else if (kind === 'land') this.noise(dest, t, 0.1, local ? 0.18 : 0.1, { type: 'lowpass', f: 400 });
    else if (kind === 'jump') this.noise(dest, t, 0.08, 0.08, { type: 'lowpass', f: 600 });
    else if (kind === 'slide') this.noise(dest, t, 0.5, 0.15, { type: 'bandpass', f: 900, q: 0.6, fEnd: 400 });
  }

  reload(local: boolean, at?: Vec): void {
    if (!this.canPlay()) return;
    const dest = local ? this.buses.sfx : this.out('sfx', at, 20);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    this.noise(dest, t, 0.04, 0.2, { type: 'highpass', f: 3000 });
    this.noise(dest, t + 0.25, 0.05, 0.25, { type: 'highpass', f: 2200 });
  }

  explosion(at: Vec, big = false): void {
    if (!this.canPlay()) return;
    const dest = this.out('sfx', at, big ? 200 : 90);
    if (!dest) return;
    const t = this.ctx!.currentTime;
    this.noise(dest, t, big ? 2.2 : 0.9, big ? 0.9 : 0.6, { type: 'lowpass', f: 1500, fEnd: 50 });
    this.tone(dest, t, big ? 1.4 : 0.6, 0.6, 'sine', 70, 25);
  }

  souls(): void {
    if (!this.canPlay()) return;
    const t = this.ctx!.currentTime;
    this.tone(this.buses.ui, t, 0.12, 0.08, 'sine', 1200 + Math.random() * 300, 1800);
  }

  ui(kind: 'click' | 'buy' | 'error' | 'level' | 'announce' | 'kill' | 'death' | 'ping'): void {
    if (!this.canPlay()) return;
    const t = this.ctx!.currentTime;
    const d = this.buses.ui;
    switch (kind) {
      case 'click':
        this.tone(d, t, 0.05, 0.15, 'triangle', 900, 700);
        break;
      case 'buy':
        [0, 0.06, 0.12].forEach((o, i) => this.tone(d, t + o, 0.15, 0.18, 'triangle', 880 * (1 + i * 0.25), 900 * (1 + i * 0.25)));
        break;
      case 'error':
        this.tone(d, t, 0.15, 0.18, 'square', 180, 140);
        break;
      case 'level':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(d, t + i * 0.07, 0.3, 0.16, 'triangle', f, f));
        break;
      case 'announce':
        this.tone(this.buses.voice, t, 0.9, 0.22, 'sawtooth', 110, 110, 0.05);
        this.tone(this.buses.voice, t, 0.9, 0.16, 'sawtooth', 165, 165, 0.05);
        break;
      case 'kill':
        [784, 988, 1175].forEach((f, i) => this.tone(d, t + i * 0.05, 0.25, 0.2, 'square', f, f));
        break;
      case 'death':
        this.tone(d, t, 1.2, 0.25, 'sawtooth', 220, 55, 0.02);
        break;
      case 'ping':
        this.tone(d, t, 0.18, 0.2, 'sine', 1500, 1500);
        this.tone(d, t + 0.1, 0.2, 0.15, 'sine', 1900, 1900);
        break;
    }
  }

  /** Slow generative ambient pad; low-key so it doesn't mask combat cues. */
  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const ctx = this.ctx;
    const chords = [
      [110, 164.8, 196, 261.6],
      [98, 146.8, 196, 233.1],
      [87.3, 130.8, 174.6, 220],
      [103.8, 155.6, 207.7, 246.9],
    ];
    let i = 0;
    const play = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      for (const f of chords[i % chords.length]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 12;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(300, t);
        filt.frequency.linearRampToValueAtTime(700, t + 4);
        filt.frequency.linearRampToValueAtTime(250, t + 8);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 2.5);
        g.gain.linearRampToValueAtTime(0.0001, t + 8.5);
        o.connect(filt).connect(g).connect(this.buses.music);
        o.start(t);
        o.stop(t + 9);
        this.musicNodes.push(o);
      }
      i++;
      if (this.musicNodes.length > 40) this.musicNodes.splice(0, 20);
    };
    play();
    this.musicTimer = window.setInterval(play, 8000);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  dispose(): void {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioManager();
