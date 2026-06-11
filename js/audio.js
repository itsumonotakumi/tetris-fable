/* audio.js — Web Audio API による全合成サウンド（外部アセット不要）
   ・BGM: コロブチカ（テトリスの定番曲・ルックアヘッド型シーケンサ）
   ・SFX: 操作音 / 消去音 / テトリス大爆発 / KO など */
(function (root) {
  "use strict";

  const A = {
    ctx: null,
    master: null,
    bgmBus: null,
    sfxBus: null,
    delaySend: null,
    started: false,
    muted: false,
    danger: false,
    bgm: {
      timer: null,
      track: null,
      events: [],
      idx: 0,
      loopStart: 0,
      loopDur: 0,
      eighth: 0.2,
    },
  };

  function midi2freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function ensureCtx() {
    if (A.ctx) return true;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    master.connect(comp);
    comp.connect(ctx.destination);

    const bgmBus = ctx.createGain(); bgmBus.gain.value = 0.5; bgmBus.connect(master);
    const sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);

    // 軽いエコー（BGMリード/派手SFX用センド）
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.27;
    const fb = ctx.createGain(); fb.gain.value = 0.26;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);

    A.ctx = ctx; A.master = master; A.bgmBus = bgmBus; A.sfxBus = sfxBus; A.delaySend = delay;
    return true;
  }

  function unlock() {
    if (!ensureCtx()) return;
    if (A.ctx.state === "suspended") A.ctx.resume();
    A.started = true;
  }

  // ---- 基本シンセ ----
  function tone(opt) {
    if (!A.ctx) return;
    const ctx = A.ctx;
    const t = opt.time !== undefined ? opt.time : ctx.currentTime;
    const dur = opt.dur || 0.15;
    const osc = ctx.createOscillator();
    osc.type = opt.type || "square";
    const f0 = opt.freq || (opt.midi ? midi2freq(opt.midi) : 440);
    osc.frequency.setValueAtTime(f0, t);
    if (opt.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.slideTo), t + dur);
    if (opt.detune) osc.detune.value = opt.detune;
    if (opt.vibrato) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = opt.vibrato;
      const lg = ctx.createGain(); lg.gain.value = opt.vibratoDepth || 12;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    const g = ctx.createGain();
    const vol = opt.vol !== undefined ? opt.vol : 0.15;
    const atk = opt.attack !== undefined ? opt.attack : 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(opt.bus || A.sfxBus);
    if (opt.echo && A.delaySend) {
      const sg = ctx.createGain(); sg.gain.value = opt.echo;
      g.connect(sg); sg.connect(A.delaySend);
    }
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  let noiseBuf = null;
  function getNoiseBuf() {
    if (noiseBuf) return noiseBuf;
    const ctx = A.ctx;
    const len = ctx.sampleRate * 1.2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function noise(opt) {
    if (!A.ctx) return;
    const ctx = A.ctx;
    const t = opt.time !== undefined ? opt.time : ctx.currentTime;
    const dur = opt.dur || 0.2;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuf();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opt.filter || "bandpass";
    filter.frequency.setValueAtTime(opt.freq || 1000, t);
    if (opt.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(20, opt.sweepTo), t + dur);
    filter.Q.value = opt.q || 0.8;
    const g = ctx.createGain();
    const vol = opt.vol !== undefined ? opt.vol : 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + (opt.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(opt.bus || A.sfxBus);
    if (opt.echo && A.delaySend) {
      const sg = ctx.createGain(); sg.gain.value = opt.echo;
      g.connect(sg); sg.connect(A.delaySend);
    }
    src.start(t); src.stop(t + dur + 0.05);
  }

  function kick(t, vol) {
    tone({ time: t, freq: 150, slideTo: 42, dur: 0.13, type: "sine", vol: vol || 0.5, bus: A.bgmBus });
  }
  function snare(t, vol) {
    noise({ time: t, dur: 0.1, freq: 1800, q: 0.7, vol: (vol || 0.18), bus: A.bgmBus });
    tone({ time: t, freq: 190, dur: 0.07, type: "triangle", vol: (vol || 0.18) * 0.8, bus: A.bgmBus });
  }
  function hat(t, vol) {
    noise({ time: t, dur: 0.035, filter: "highpass", freq: 6500, vol: vol || 0.07, bus: A.bgmBus });
  }

  // ---- BGM データ（コロブチカ） ----
  // [midi(0=休符), 8分音符の数]
  const MELODY_A = [
    [76, 2], [71, 1], [72, 1], [74, 2], [72, 1], [71, 1],
    [69, 2], [69, 1], [72, 1], [76, 2], [74, 1], [72, 1],
    [71, 2], [71, 1], [72, 1], [74, 2], [76, 2],
    [72, 2], [69, 2], [69, 3], [0, 1],
    [74, 3], [77, 1], [81, 2], [79, 1], [77, 1],
    [76, 3], [72, 1], [76, 2], [74, 1], [72, 1],
    [71, 2], [71, 1], [72, 1], [74, 2], [76, 2],
    [72, 2], [69, 2], [69, 3], [0, 1],
  ];
  const MELODY_B = [
    [76, 4], [72, 4], [74, 4], [71, 4],
    [72, 4], [69, 4], [68, 4], [71, 2], [0, 2],
    [76, 4], [72, 4], [74, 4], [71, 4],
    [72, 2], [76, 2], [81, 4], [80, 6], [0, 2],
  ];
  const BASS_A = [45, 45, 40, 45, 38, 36, 40, 45]; // 小節ごとのルート
  const BASS_B = [45, 40, 45, 40, 45, 40, 45, 40];

  function buildBattleTrack() {
    const ev = [];
    let t8 = 0;
    const pushMelody = (mel) => {
      for (const [m, len] of mel) {
        if (m) ev.push({ t: t8, kind: "lead", midi: m, len });
        t8 += len;
      }
    };
    // A A B 構成
    pushMelody(MELODY_A); pushMelody(MELODY_A); pushMelody(MELODY_B);
    const totalBars = Math.ceil(t8 / 8);
    const bassRoots = [].concat(BASS_A, BASS_A, BASS_B);
    for (let bar = 0; bar < totalBars; bar++) {
      const root_ = bassRoots[bar % bassRoots.length];
      for (let i = 0; i < 8; i++) {
        ev.push({ t: bar * 8 + i, kind: "bass", midi: i % 2 === 0 ? root_ : root_ + 7, len: 1 });
        ev.push({ t: bar * 8 + i, kind: "hat" });
      }
      ev.push({ t: bar * 8 + 0, kind: "kick" });
      ev.push({ t: bar * 8 + 4, kind: "kick" });
      ev.push({ t: bar * 8 + 2, kind: "snare" });
      ev.push({ t: bar * 8 + 6, kind: "snare" });
    }
    ev.sort((a, b) => a.t - b.t);
    return { events: ev, loopLen: t8, eighth: 60 / 150 / 2 }; // 150 BPM
  }

  function buildMenuTrack() {
    // しっとりした Am アルペジオ
    const ev = [];
    const arp = [45, 52, 57, 60, 64, 60, 57, 52, 43, 50, 55, 59, 62, 59, 55, 50];
    for (let i = 0; i < arp.length; i++) ev.push({ t: i, kind: "arp", midi: arp[i], len: 1 });
    return { events: ev, loopLen: arp.length, eighth: 60 / 96 / 2 };
  }

  function scheduleEvent(e, when, eighth) {
    switch (e.kind) {
      case "lead": {
        const dur = e.len * eighth * 0.92;
        tone({ time: when, midi: e.midi, dur, type: "square", vol: 0.13, bus: A.bgmBus, echo: 0.18 });
        tone({ time: when, midi: e.midi, dur, type: "sawtooth", vol: 0.05, detune: 8, bus: A.bgmBus });
        break;
      }
      case "bass":
        tone({ time: when, midi: e.midi, dur: eighth * 0.85, type: "sawtooth", vol: A.danger ? 0.13 : 0.1, bus: A.bgmBus });
        break;
      case "arp":
        tone({ time: when, midi: e.midi, dur: eighth * 2.4, type: "triangle", vol: 0.12, bus: A.bgmBus, echo: 0.4 });
        break;
      case "kick": kick(when, A.danger ? 0.62 : 0.5); break;
      case "snare": snare(when); break;
      case "hat":
        hat(when, 0.065);
        if (A.danger) hat(when + eighth / 2, 0.05); // 危機時は16分裏打ち追加
        break;
    }
  }

  function startBGM(trackName) {
    if (!A.ctx) return;
    stopBGM();
    const track = trackName === "menu" ? buildMenuTrack() : buildBattleTrack();
    A.bgm.track = track;
    A.bgm.idx = 0;
    A.bgm.loopStart = A.ctx.currentTime + 0.1;
    A.bgm.loopDur = track.loopLen * track.eighth;
    A.bgm.timer = setInterval(() => {
      const ctx = A.ctx;
      const lookahead = ctx.currentTime + 0.18;
      const b = A.bgm;
      let guard = 0;
      while (guard++ < 200) {
        if (b.idx >= b.track.events.length) {
          b.idx = 0;
          b.loopStart += b.loopDur;
        }
        const e = b.track.events[b.idx];
        const when = b.loopStart + e.t * b.track.eighth;
        if (when > lookahead) break;
        if (when >= ctx.currentTime - 0.05) scheduleEvent(e, when, b.track.eighth);
        b.idx++;
      }
    }, 30);
  }

  function stopBGM() {
    if (A.bgm.timer) { clearInterval(A.bgm.timer); A.bgm.timer = null; }
  }

  function setBgmVolume(v) { if (A.bgmBus) A.bgmBus.gain.setTargetAtTime(v, A.ctx.currentTime, 0.1); }

  // ---- SFX ----
  function now() { return A.ctx ? A.ctx.currentTime : 0; }
  function arpRun(midis, step, opt) {
    midis.forEach((m, i) => tone(Object.assign({ time: now() + i * step, midi: m }, opt)));
  }

  const SFX = {
    menuMove() { tone({ freq: 750, slideTo: 980, dur: 0.05, type: "square", vol: 0.08 }); },
    menuSelect() { arpRun([84, 91], 0.06, { dur: 0.1, type: "square", vol: 0.12, echo: 0.3 }); },
    menuBack() { arpRun([79, 72], 0.06, { dur: 0.1, type: "square", vol: 0.1 }); },
    countdown() { tone({ freq: 440, dur: 0.12, type: "square", vol: 0.18 }); },
    go() {
      tone({ freq: 880, dur: 0.4, type: "square", vol: 0.2, echo: 0.4 });
      arpRun([69, 73, 76, 81], 0.04, { dur: 0.3, type: "sawtooth", vol: 0.1, echo: 0.3 });
    },
    move() { tone({ freq: 1150, dur: 0.024, type: "triangle", vol: 0.06 }); },
    rotate() { tone({ freq: 520, slideTo: 760, dur: 0.05, type: "square", vol: 0.08 }); },
    hold() { tone({ freq: 420, slideTo: 840, dur: 0.08, type: "triangle", vol: 0.11 }); },
    hardDrop() {
      noise({ dur: 0.09, filter: "highpass", freq: 3000, sweepTo: 500, vol: 0.14 });
      tone({ freq: 130, slideTo: 48, dur: 0.09, type: "sine", vol: 0.32 });
    },
    lock() { tone({ freq: 100, slideTo: 60, dur: 0.06, type: "sine", vol: 0.2 }); },
    clear(lines, combo) {
      const base = [0, 0, 2, 4, 7][Math.min(lines, 4)] + Math.min(combo || 0, 8);
      const notes = [72, 76, 79, 84, 88].slice(0, 2 + lines).map((n) => n + base);
      arpRun(notes, 0.05, { dur: 0.18, type: "square", vol: 0.14, echo: 0.3 });
      noise({ dur: 0.25, filter: "bandpass", freq: 900, sweepTo: 4500, vol: 0.12 });
    },
    tspin(lines) {
      tone({ freq: 300, slideTo: 620, dur: 0.3, type: "sawtooth", vol: 0.14, vibrato: 9, vibratoDepth: 30, echo: 0.4 });
      arpRun([74, 78, 81, 86].slice(0, 2 + lines), 0.06, { dur: 0.2, type: "square", vol: 0.13, echo: 0.35 });
    },
    tetris() {
      const t = now();
      // 1) 重低音ブーム
      tone({ time: t, freq: 110, slideTo: 28, dur: 0.7, type: "sine", vol: 0.85 });
      // 2) クラッシュノイズ
      noise({ time: t, dur: 0.8, filter: "lowpass", freq: 9000, sweepTo: 400, vol: 0.4 });
      noise({ time: t, dur: 0.5, filter: "highpass", freq: 2500, sweepTo: 9000, vol: 0.2 });
      // 3) 高速上昇アルペジオ
      [69, 72, 76, 81, 84, 88, 93].forEach((m, i) =>
        tone({ time: t + 0.05 + i * 0.035, midi: m, dur: 0.3, type: "sawtooth", vol: 0.16, echo: 0.45 }));
      // 4) きらめくシメ和音
      [81, 85, 88, 93].forEach((m) =>
        tone({ time: t + 0.34, midi: m, dur: 0.7, type: "square", vol: 0.1, vibrato: 6, vibratoDepth: 8, echo: 0.5 }));
      noise({ time: t + 0.34, dur: 1.0, filter: "highpass", freq: 8000, vol: 0.07, echo: 0.4 });
    },
    b2b() {
      arpRun([93, 96, 100, 105], 0.05, { dur: 0.35, type: "square", vol: 0.12, echo: 0.5 });
    },
    perfectClear() {
      const t = now();
      [72, 76, 79, 84, 88, 91, 96, 100, 103, 108].forEach((m, i) =>
        tone({ time: t + i * 0.05, midi: m, dur: 0.5, type: "triangle", vol: 0.16, echo: 0.55 }));
      noise({ time: t, dur: 1.4, filter: "highpass", freq: 7000, vol: 0.1, echo: 0.4 });
      tone({ time: t, freq: 90, slideTo: 36, dur: 0.6, type: "sine", vol: 0.6 });
    },
    garbageWarn() {
      tone({ freq: 620, dur: 0.07, type: "square", vol: 0.09 });
      tone({ time: now() + 0.09, freq: 470, dur: 0.07, type: "square", vol: 0.09 });
    },
    garbageHit(lines) {
      noise({ dur: 0.35, filter: "lowpass", freq: 300, vol: Math.min(0.5, 0.18 + lines * 0.05) });
      tone({ freq: 75, slideTo: 34, dur: 0.3, type: "sine", vol: 0.5 });
    },
    heartbeat() {
      tone({ freq: 62, slideTo: 40, dur: 0.1, type: "sine", vol: 0.4 });
      tone({ time: now() + 0.18, freq: 58, slideTo: 38, dur: 0.09, type: "sine", vol: 0.3 });
    },
    ko() {
      const t = now();
      tone({ time: t, freq: 140, slideTo: 22, dur: 1.1, type: "sine", vol: 0.9 });
      noise({ time: t, dur: 1.0, filter: "lowpass", freq: 7000, sweepTo: 200, vol: 0.45 });
      for (let i = 0; i < 7; i++) {
        noise({ time: t + 0.05 + i * 0.06, dur: 0.12, filter: "bandpass", freq: 2400 + Math.random() * 3200, q: 6, vol: 0.16 });
      }
    },
    win() {
      const t = now();
      [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36]].forEach(([m, d]) =>
        tone({ time: t + d, midi: m, dur: 0.3, type: "square", vol: 0.16, echo: 0.4 }));
      [84, 88, 91, 96].forEach((m) =>
        tone({ time: t + 0.52, midi: m, dur: 1.1, type: "square", vol: 0.1, vibrato: 6, vibratoDepth: 10, echo: 0.5 }));
    },
    lose() {
      const t = now();
      [[69, 0], [65, 0.25], [62, 0.5], [57, 0.75]].forEach(([m, d]) =>
        tone({ time: t + d, midi: m, dur: 0.55, type: "sawtooth", vol: 0.1 }));
    },
    levelup() {
      arpRun([76, 81, 85, 88], 0.05, { dur: 0.2, type: "square", vol: 0.11, echo: 0.3 });
    },
  };

  const AudioEngine = {
    unlock,
    startBGM, stopBGM, setBgmVolume,
    setDanger(d) { A.danger = d; },
    sfx(name, ...args) {
      if (!A.ctx || A.muted) return;
      if (SFX[name]) SFX[name](...args);
    },
    get ready() { return !!A.ctx; },
  };

  root.AudioEngine = AudioEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = AudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
