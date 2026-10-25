/* ============================================================
 * TT作曲家 Web 版 —— Web Audio 合成器与播放器
 * 不依赖任何音色库：用振荡器 + 滤波器 + 包络模拟常用音色
 * ============================================================ */
(function (global) {
  'use strict';
  const M = global.TT.Model;
  const S = global.TT.Styles;

  const PRESETS = [
    { key: 'piano', name: '钢琴' },
    { key: 'erhu', name: '二胡' },
    { key: 'flute', name: '长笛' },
    { key: 'strings', name: '弦乐' },
    { key: 'musicbox', name: '八音盒' },
    { key: 'organ', name: '风琴' },
    { key: 'guitar', name: '吉他' },
    { key: 'sax', name: '萨克斯' },
  ];

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  class Engine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.melodyGain = null;
      this.accompGain = null;
      this.reverb = null;
      this.reverbGain = null;
      this.playing = false;
      this.startCtxTime = 0;
      this.startBeat = 0;
      this.spb = 0.5;
      this.totalBeats = 0;
      this.plan = [];
      this.scheduled = new Set();
      this.timer = null;
      this.raf = null;
      this.metronome = false;
      this.onTick = null;
      this.onEnd = null;
    }

    ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      }
      const AC = global.AudioContext || global.webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.85;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      this.melodyGain = ctx.createGain();
      this.melodyGain.gain.value = 0.9;
      this.melodyGain.connect(this.master);

      this.accompGain = ctx.createGain();
      this.accompGain.gain.value = 0.65;
      this.accompGain.connect(this.master);

      // 简易混响
      const len = Math.floor(ctx.sampleRate * 1.8);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      const conv = ctx.createConvolver();
      conv.buffer = buf;
      const rg = ctx.createGain();
      rg.gain.value = 0.22;
      conv.connect(rg);
      rg.connect(this.master);
      this.reverb = conv;
      this.reverbGain = rg;
      return ctx;
    }

    setVolumes(melody, accomp) {
      if (!this.ctx) return;
      this.melodyGain.gain.value = melody;
      this.accompGain.gain.value = accomp;
    }

    /* ---------- 音色 ---------- */
    playVoice(preset, midi, time, dur, vel, dest, isBass) {
      const ctx = this.ctx;
      const freq = midiToFreq(midi);
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      let peak = (vel == null ? 0.7 : vel) * 0.32;
      const out = dest || this.melodyGain;

      const oscs = [];
      const addOsc = (type, detune, gainScale, octShift) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq * Math.pow(2, octShift || 0);
        o.detune.value = detune || 0;
        const og = ctx.createGain();
        og.gain.value = gainScale;
        o.connect(og);
        og.connect(filt);
        oscs.push(o);
        return o;
      };

      let attack = 0.01, release = 0.12, sustain = 0.7, cutoff = 5000;
      switch (preset) {
        case 'erhu':
          addOsc('sawtooth', -4, 0.5); addOsc('sawtooth', 4, 0.35); addOsc('sine', 0, 0.4, 1);
          attack = 0.06; release = 0.18; sustain = 0.85; cutoff = 2400;
          break;
        case 'flute':
          addOsc('sine', 0, 0.8); addOsc('triangle', 0, 0.18, 1);
          attack = 0.07; release = 0.15; sustain = 0.9; cutoff = 6000;
          break;
        case 'strings':
          addOsc('sawtooth', -7, 0.3); addOsc('sawtooth', 7, 0.3); addOsc('sawtooth', 0, 0.2, 1);
          attack = 0.28; release = 0.5; sustain = 0.8; cutoff = 2000;
          break;
        case 'musicbox':
          addOsc('sine', 0, 0.7); addOsc('sine', 0, 0.16, 2);
          attack = 0.004; release = 0.35; sustain = 0.15; cutoff = 7000;
          break;
        case 'organ':
          addOsc('square', 0, 0.22); addOsc('sine', 0, 0.45, 1); addOsc('sine', 0, 0.2, 2);
          attack = 0.02; release = 0.1; sustain = 0.95; cutoff = 3200;
          break;
        case 'guitar':
          addOsc('triangle', 0, 0.5); addOsc('sawtooth', 0, 0.12, 1);
          attack = 0.004; release = 0.3; sustain = 0.25; cutoff = 3600;
          break;
        case 'sax':
          addOsc('sawtooth', 0, 0.35); addOsc('square', 3, 0.15);
          attack = 0.05; release = 0.16; sustain = 0.8; cutoff = 2200;
          break;
        case 'bass':
          addOsc('sine', 0, 0.7); addOsc('triangle', 0, 0.35);
          attack = 0.008; release = 0.1; sustain = 0.6; cutoff = 700;
          break;
        case 'pad':
          addOsc('triangle', -5, 0.25); addOsc('triangle', 5, 0.25); addOsc('sine', 0, 0.25, 1);
          attack = 0.3; release = 0.6; sustain = 0.7; cutoff = 1600;
          break;
        case 'pluck':
          addOsc('triangle', 0, 0.4); addOsc('sine', 0, 0.3, 1);
          attack = 0.006; release = 0.25; sustain = 0.2; cutoff = 2600;
          break;
        default: // piano
          addOsc('triangle', 0, 0.55); addOsc('sine', 0, 0.35, 1); addOsc('sine', 0, 0.12, 2);
          attack = 0.005; release = 0.25; sustain = 0.35; cutoff = 4200;
      }

      filt.frequency.setValueAtTime(cutoff, time);
      if (preset === 'erhu' || preset === 'sax') {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 5.2;
        lfoGain.gain.value = 5;
        lfo.connect(lfoGain);
        oscs.forEach((o) => lfoGain.connect(o.detune));
        lfo.start(time);
        lfo.stop(time + dur + release + 0.1);
      }

      const end = time + Math.max(0.05, dur);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(peak, time + attack);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * sustain), Math.max(time + attack + 0.01, end - 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, end + release);
      filt.connect(g);
      g.connect(out);
      if (this.reverb) g.connect(this.reverb);

      oscs.forEach((o) => {
        o.start(time);
        o.stop(end + release + 0.05);
      });
      return { stop: (t) => { try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.02); } catch (_) {} } };
    }

    noiseBuffer(durSec) {
      if (!this._noise || this._noiseDur < durSec) {
        const len = Math.floor(this.ctx.sampleRate * Math.max(durSec, 0.5));
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._noise = buf;
        this._noiseDur = len / this.ctx.sampleRate;
      }
      return this._noise;
    }

    playDrum(name, time, vel) {
      const ctx = this.ctx;
      const v = (vel == null ? 0.8 : vel) * 0.55;
      const out = this.accompGain;
      if (name === 'kick') {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(140, time);
        o.frequency.exponentialRampToValueAtTime(46, time + 0.12);
        g.gain.setValueAtTime(v * 1.1, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
        o.connect(g); g.connect(out);
        o.start(time); o.stop(time + 0.3);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(0.6);
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.connect(f); f.connect(g); g.connect(out);
      let dur = 0.08;
      if (name === 'snare') {
        f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.9;
        g.gain.setValueAtTime(v * 0.7, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
        dur = 0.2;
        const o = ctx.createOscillator(); const og = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = 185;
        og.gain.setValueAtTime(v * 0.25, time);
        og.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
        o.connect(og); og.connect(out); o.start(time); o.stop(time + 0.1);
      } else if (name === 'hat') {
        f.type = 'highpass'; f.frequency.value = 8200;
        g.gain.setValueAtTime(v * 0.28, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
        dur = 0.06;
      } else if (name === 'ohat') {
        f.type = 'highpass'; f.frequency.value = 7600;
        g.gain.setValueAtTime(v * 0.24, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
        dur = 0.28;
      } else if (name === 'clap') {
        f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 1.2;
        g.gain.setValueAtTime(v * 0.4, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
        dur = 0.18;
      } else if (name === 'shaker') {
        f.type = 'highpass'; f.frequency.value = 5600;
        g.gain.setValueAtTime(v * 0.16, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
        dur = 0.08;
      } else if (name === 'ride') {
        f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 0.6;
        g.gain.setValueAtTime(v * 0.16, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
        dur = 0.36;
      } else if (name === 'crash') {
        f.type = 'highpass'; f.frequency.value = 4200;
        g.gain.setValueAtTime(v * 0.35, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 1.1);
        dur = 1.1;
      } else if (name === 'tom') {
        f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 1.5;
        g.gain.setValueAtTime(v * 0.5, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
        dur = 0.24;
      } else if (name === 'rim') {
        f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 2;
        g.gain.setValueAtTime(v * 0.35, time);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
        dur = 0.08;
      }
      src.start(time);
      src.stop(time + dur + 0.02);
    }

    /* ---------- 播放 ---------- */
    buildPlan(score) {
      const spb = 60 / score.tempo;
      const plan = [];
      const melody = M.melodyEvents(score);
      melody.forEach((e) => {
        plan.push({ beat: e.beat, dur: e.dur, midi: e.midi, part: 'melody', vel: 0.85 });
      });
      const acc = S.build(score);
      acc.events.forEach((e) => {
        if (e.part === 'drum') plan.push({ beat: e.beat, drum: e.drum, part: 'drum', vel: e.vel });
        else plan.push({ beat: e.beat, dur: e.dur, midi: e.midi, part: e.part, vel: e.vel });
      });
      plan.sort((a, b) => a.beat - b.beat);
      this.spb = spb;
      this.totalBeats = Math.max(M.totalBeats(score), acc.totalBeats, 1);
      return plan;
    }

    play(score, fromBeat) {
      this.stop();
      this.ensure();
      const ctx = this.ctx;
      // 立即恢复总音量（stop 中的淡出可能尚未还原）
      try {
        this.master.gain.cancelScheduledValues(ctx.currentTime);
        this.master.gain.setValueAtTime(0.85, ctx.currentTime);
      } catch (_) {}
      this.plan = this.buildPlan(score);
      this.startBeat = fromBeat || 0;
      this.startCtxTime = ctx.currentTime + 0.08;
      this.playing = true;
      this.scheduled = new Set();
      this.preset = score.melodyPreset || 'piano';
      this.metronome = !!score.metronome;
      this.setVolumes(score.melodyVolume, score.accompVolume);
      this._score = score;
      this._schedule();
      this.timer = setInterval(() => this._schedule(), 40);
      this.raf = setInterval(() => this._tickLoop(), 50);
    }

    _schedule() {
      if (!this.playing) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const lookahead = 0.3;
      const from = this.startBeat;
      for (let i = 0; i < this.plan.length; i++) {
        if (this.scheduled.has(i)) continue;
        const e = this.plan[i];
        if (e.beat < from - 1e-6) { this.scheduled.add(i); continue; }
        const t = this.startCtxTime + (e.beat - from) * this.spb;
        if (t > now + lookahead) break;
        if (t < now - 0.05) { this.scheduled.add(i); continue; }
        this.scheduled.add(i);
        if (e.part === 'drum') {
          this.playDrum(e.drum, t, e.vel);
        } else if (e.part === 'melody') {
          this.playVoice(this.preset, e.midi, t, e.dur * this.spb * 0.96, e.vel, this.melodyGain);
        } else if (e.part === 'bass') {
          this.playVoice('bass', e.midi, t, e.dur * this.spb * 0.95, e.vel * 0.9, this.accompGain);
        } else if (e.part === 'pad') {
          this.playVoice('pad', e.midi, t, e.dur * this.spb * 0.98, e.vel * 0.8, this.accompGain);
        } else {
          this.playVoice('pluck', e.midi, t, Math.min(e.dur * this.spb, 0.9), e.vel * 0.8, this.accompGain);
        }
      }
      if (this.metronome) {
        const beatDur = this.spb;
        const cap = this._score ? this._score.timeNum : 4;
        const firstMetro = Math.ceil(from);
        for (let b = firstMetro; b <= this.totalBeats; b++) {
          const key = 'm' + b;
          if (this.scheduled.has(key)) continue;
          const t = this.startCtxTime + (b - from) * beatDur;
          if (t > now + lookahead) break;
          this.scheduled.add(key);
          if (t < now - 0.05) continue;
          this._click(t, b % cap === 0);
        }
      }
    }

    _click(t, accent) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = accent ? 1600 : 1100;
      g.gain.setValueAtTime(accent ? 0.25 : 0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.06);
    }

    _tickLoop() {
      if (!this.playing) return;
      const beat = this.currentBeat();
      if (this.onTick) this.onTick(beat);
      if (beat >= this.totalBeats) {
        this.stop();
        if (this.onEnd) this.onEnd();
      }
    }

    currentBeat() {
      if (!this.ctx || !this.playing) return 0;
      return this.startBeat + Math.max(0, (this.ctx.currentTime - this.startCtxTime) / this.spb);
    }

    stop() {
      this.playing = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.raf) clearInterval(this.raf);
      this.raf = null;
      if (this.ctx) {
        // 快速淡出，避免爆音
        const g = this.master;
        try {
          g.gain.cancelScheduledValues(this.ctx.currentTime);
          g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.015);
          setTimeout(() => { try { g.gain.setValueAtTime(0.85, this.ctx.currentTime); } catch (_) {} }, 120);
        } catch (_) {}
      }
    }

    /** 音色试听 */
    audition(preset, midi) {
      this.ensure();
      this.playVoice(preset, midi || 60, this.ctx.currentTime + 0.02, 0.7, 0.9, this.melodyGain);
    }

    /** 单音预览（输入音符时） */
    blip(score, tok) {
      this.ensure();
      if (!tok || tok.rest) return;
      const midi = M.degreeToMidi(tok.p, tok.o, score.key, tok.acc, score.mode);
      this.playVoice(score.melodyPreset || 'piano', midi, this.ctx.currentTime + 0.01, 0.22, 0.55, this.melodyGain);
    }
  }

  global.TT.Audio = { Engine, PRESETS, midiToFreq };
})(typeof window !== 'undefined' ? window : globalThis);
