/* ============================================================
 * TT作曲家 Web 版 —— 自动伴奏风格库
 * 100 种风格在桌面版中是数据驱动的，这里用「节奏型生成器」复刻
 * 常见中国风格伴奏，并保留 Intro / Main / Fill / Ending 变奏逻辑
 * ============================================================ */
(function (global) {
  'use strict';
  const M = global.TT.Model;

  const DRUM_MIDI = { kick: 36, snare: 38, hat: 42, ohat: 46, clap: 39, ride: 51, crash: 49, shaker: 70, tom: 45, rim: 37 };

  const VARIATIONS = [
    { key: 'IntroA', name: '前奏 A' }, { key: 'MainA', name: '主奏 A' },
    { key: 'FillAA', name: '加花 AA' }, { key: 'FillAB', name: '加花 AB' },
    { key: 'EndingA', name: '尾声 A' },
    { key: 'IntroB', name: '前奏 B' }, { key: 'MainB', name: '主奏 B' },
    { key: 'FillBA', name: '加花 BA' }, { key: 'FillBB', name: '加花 BB' },
    { key: 'EndingB', name: '尾声 B' },
  ];

  /* 每种风格：name 风格名，gen 生成器类型，tempo 建议速度，drum 是否有鼓 */
  const STYLES = [
    { name: '进行曲', gen: 'march', tempo: 112, drum: true, desc: '铿锵有力，适合队列歌曲' },
    { name: '圆舞曲', gen: 'waltz', tempo: 132, drum: true, desc: '蓬-恰-恰，3/4 拍' },
    { name: '民谣', gen: 'folk', tempo: 88, drum: true, desc: '吉他分解和弦，抒情叙事' },
    { name: '抒情', gen: 'ballad', tempo: 66, drum: false, desc: '长音铺底，安静柔美' },
    { name: '流行', gen: 'pop', tempo: 96, drum: true, desc: '八分音符律动，通用流行' },
    { name: '摇滚', gen: 'rock', tempo: 120, drum: true, desc: '强力和弦推进' },
    { name: '波萨诺瓦', gen: 'bossa', tempo: 104, drum: true, desc: '切分节奏，慵懒南美风' },
    { name: '迪斯科', gen: 'disco', tempo: 120, drum: true, desc: '四四拍舞曲律动' },
    { name: '中国民族', gen: 'pentatonic', tempo: 80, drum: false, desc: '五声音阶分解，民族风味' },
    { name: '儿童歌曲', gen: 'children', tempo: 100, drum: true, desc: '简单的强拍低音+和弦' },
    { name: '拉丁', gen: 'latin', tempo: 108, drum: true, desc: '克拉维节奏' },
    { name: '爵士', gen: 'swing', tempo: 120, drum: true, desc: '摇摆八分音符' },
    { name: '慢摇滚', gen: 'slowrock', tempo: 72, drum: true, desc: '12/8 慢速抒情摇滚' },
    { name: '秧歌', gen: 'yangge', tempo: 116, drum: true, desc: '北方民间锣鼓，喜庆热烈' },
    { name: '江南丝竹', gen: 'sizhu', tempo: 72, drum: false, desc: '轻快细腻的江南小调' },
    { name: '进行曲（快）', gen: 'march', tempo: 132, drum: true, desc: '快速进行曲' },
    { name: '叙事', gen: 'folk', tempo: 76, drum: false, desc: '缓慢分解和弦' },
    { name: '探戈', gen: 'tango', tempo: 116, drum: true, desc: '顿挫有力的探戈节奏' },
  ];

  function styleByName(name) {
    return STYLES.find((s) => s.name === name) || STYLES[0];
  }

  function isFill(v) { return v && v.indexOf('Fill') === 0; }
  function isIntro(v) { return v && v.indexOf('Intro') === 0; }
  function isEnding(v) { return v && v.indexOf('Ending') === 0; }
  function isB(v) { return v && /B$/.test(v); }

  /** 建立全曲和弦时间线 */
  function chordTimeline(score) {
    const tl = [];
    let beat = 0;
    let current = null;
    score.measures.forEach((m) => {
      if (m.chord) { current = m.chord; tl.push({ beat, chord: m.chord }); }
      m.tokens.forEach((t) => {
        if (t.chord && t.chord !== current) { current = t.chord; tl.push({ beat, chord: t.chord }); }
        beat += t.dur;
      });
    });
    if (!tl.length) tl.push({ beat: 0, chord: score.key || 'C' });
    return tl;
  }

  function chordAt(tl, beat) {
    let sym = tl[0].chord;
    for (const item of tl) {
      if (item.beat <= beat + 1e-6) sym = item.chord;
      else break;
    }
    return sym;
  }

  function chordNotes(sym, octave) {
    const p = M.parseChord(sym);
    if (!p) return [60, 64, 67];
    return M.chordToMidi(p, octave == null ? 3 : octave);
  }

  function bassRoot(sym) {
    const p = M.parseChord(sym);
    if (!p) return 36;
    return 36 + p.pc;
  }

  /** 生成一小节的伴奏事件 */
  function genMeasure(style, ctx) {
    const { cap, start, chord, variation } = ctx;
    const ev = [];
    const push = (beat, dur, midi, vel, part) => {
      if (beat >= start + cap - 1e-6) return;
      ev.push({ beat: M.round4(beat), dur: Math.max(0.05, dur), midi, vel: vel || 0.8, part: part || 'chord' });
    };
    const drum = (beat, name, vel) => {
      if (beat >= start + cap - 1e-6) return;
      ev.push({ beat: M.round4(beat), drum: name, vel: vel == null ? 0.8 : vel, part: 'drum' });
    };

    const notes = chordNotes(chord, 3);
    const root = bassRoot(chord);
    const fifth = root + 7;
    const b = start;
    const gen = style.gen;
    const intro = isIntro(variation), ending = isEnding(variation), fill = isFill(variation);
    const vB = isB(variation);

    // 前奏/尾声：只保留铺底与低音，交给加花/收尾
    if (intro) {
      push(b, cap, notes[0], 0.5, 'pad');
      push(b, cap, notes[2] || notes[1], 0.45, 'pad');
      push(b, Math.min(cap, 2), root, 0.55, 'bass');
      if (style.drum) drum(b, 'hat', 0.4);
      return ev;
    }
    if (ending) {
      push(b, cap, notes[0], 0.5, 'pad');
      push(b, cap, notes[1], 0.45, 'pad');
      push(b, cap, notes[2] || notes[1], 0.45, 'pad');
      push(b, cap, root, 0.7, 'bass');
      if (style.drum) { drum(b, 'crash', 0.6); drum(b, 'kick', 0.8); }
      return ev;
    }

    const beatUnit = cap >= 3 ? 1 : 0.5; // 复拍子时按八分推进

    switch (gen) {
      case 'march': {
        push(b, 0.9, root, 0.85, 'bass');
        push(b + 2, 0.9, fifth, 0.8, 'bass');
        [1, 3].forEach((x) => {
          if (x < cap) {
            notes.forEach((n) => push(b + x, 0.28, n, 0.55, 'chord'));
          }
        });
        if (style.drum) {
          drum(b, 'kick', 0.95); drum(b + 2, 'kick', 0.9);
          drum(b + 1, 'snare', 0.85); drum(b + 3, 'snare', 0.85);
          for (let x = 0; x < cap; x += 0.5) drum(b + x, 'hat', x % 1 === 0 ? 0.55 : 0.35);
        }
        break;
      }
      case 'waltz': {
        push(b, 1.6, root, 0.85, 'bass');
        [1, 2].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 0.8, n, 0.5, 'chord'));
        });
        if (style.drum) {
          drum(b, 'kick', 0.9);
          drum(b + 1, 'snare', 0.45); drum(b + 2, 'snare', 0.45);
          drum(b + 1, 'hat', 0.5); drum(b + 2, 'hat', 0.5);
        }
        break;
      }
      case 'folk': {
        push(b, 0.5, root, 0.8, 'bass');
        const arp = [notes[0], notes[2] || notes[1], notes[1], notes[0], notes[2] || notes[1], notes[1], notes[2] || notes[1], notes[0]];
        for (let i = 0; i < Math.round(cap / 0.5); i++) {
          push(b + i * 0.5, 0.45, arp[i % arp.length], 0.42 + (i === 0 ? 0.1 : 0), 'chord');
        }
        if (style.drum) {
          drum(b, 'kick', 0.6); drum(b + 2, 'snare', 0.35);
          drum(b + 1, 'hat', 0.3); drum(b + 3, 'hat', 0.3);
        }
        break;
      }
      case 'ballad': {
        push(b, cap, notes[0], 0.42, 'pad');
        push(b, cap, notes[1], 0.38, 'pad');
        push(b, cap, notes[2] || notes[1], 0.36, 'pad');
        push(b, cap, root, 0.55, 'bass');
        if (style.drum) drum(b, 'hat', 0.22);
        break;
      }
      case 'pop': {
        for (let i = 0; i < Math.round(cap / 0.5); i++) {
          push(b + i * 0.5, 0.45, i % 2 === 0 ? root : fifth, 0.6, 'bass');
        }
        for (let x = 0.5; x < cap; x += 1) {
          notes.forEach((n) => push(b + x, 0.22, n, 0.42, 'chord'));
        }
        if (style.drum) {
          drum(b, 'kick', 0.9); drum(b + 2, 'kick', 0.8);
          drum(b + 1, 'snare', 0.8); drum(b + 3, 'snare', 0.8);
          for (let x = 0; x < cap; x += 0.5) drum(b + x, 'hat', 0.32);
        }
        break;
      }
      case 'rock': {
        for (let x = 0; x < cap; x += 0.5) push(b + x, 0.45, x % 1 === 0 ? root : root + 12, 0.65, 'bass');
        for (let x = 0; x < cap; x += 1) {
          [0, 7, 12].forEach((iv) => push(b + x, 0.4, root + 12 + iv, 0.5, 'chord'));
        }
        if (style.drum) {
          drum(b, 'kick', 1); drum(b + 2, 'kick', 0.95);
          drum(b + 1, 'snare', 0.95); drum(b + 3, 'snare', 0.95);
          for (let x = 0; x < cap; x += 0.5) drum(b + x, 'hat', 0.45);
        }
        break;
      }
      case 'bossa': {
        push(b, 0.9, root, 0.75, 'bass');
        push(b + 1.5, 0.6, fifth, 0.65, 'bass');
        [0.5, 1.5, 2.5, 3].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 0.3, n, 0.4, 'chord'));
        });
        if (style.drum) {
          drum(b, 'kick', 0.55); drum(b + 2.5, 'kick', 0.5);
          drum(b + 1, 'rim', 0.5); drum(b + 3, 'rim', 0.5);
          for (let x = 0; x < cap; x += 0.5) drum(b + x, 'shaker', 0.25);
        }
        break;
      }
      case 'disco': {
        for (let x = 0; x < cap; x += 0.5) push(b + x, 0.4, x % 1 === 0 ? root : root + 12, 0.7, 'bass');
        [0.5, 1.5, 2.5, 3.5].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 0.18, n, 0.5, 'chord'));
        });
        if (style.drum) {
          [0, 1, 2, 3].forEach((x) => drum(b + x, 'kick', 0.9));
          [1, 3].forEach((x) => drum(b + x, 'snare', 0.7));
          [0.5, 1.5, 2.5, 3.5].forEach((x) => drum(b + x, 'ohat', 0.4));
        }
        break;
      }
      case 'pentatonic': {
        push(b, 1.5, root, 0.7, 'bass');
        const penta = [0, 2, 4, 7, 9];
        const base = 48 + (M.parseChord(chord) ? M.parseChord(chord).pc : 0);
        for (let i = 0; i < Math.round(cap / 0.5); i++) {
          const iv = penta[i % penta.length];
          push(b + i * 0.5, 0.48, base + 12 + iv, 0.38, 'chord');
        }
        break;
      }
      case 'children': {
        push(b, 0.8, root, 0.85, 'bass');
        for (let x = 1; x < cap; x++) {
          notes.forEach((n) => push(b + x, 0.4, n, 0.5, 'chord'));
        }
        if (style.drum) {
          drum(b, 'kick', 0.8); drum(b + 2, 'kick', 0.7);
          drum(b + 1, 'clap', 0.5); drum(b + 3, 'clap', 0.5);
        }
        break;
      }
      case 'latin': {
        push(b, 1.2, root, 0.75, 'bass');
        push(b + 2.5, 0.6, fifth, 0.7, 'bass');
        [1, 2, 3.5].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 0.22, n, 0.45, 'chord'));
        });
        if (style.drum) {
          [0, 1.5, 3].forEach((x) => drum(b + x, 'kick', 0.7));
          [1, 2.5].forEach((x) => drum(b + x, 'rim', 0.6));
          for (let x = 0; x < cap; x += 0.5) drum(b + x, 'shaker', 0.22);
        }
        break;
      }
      case 'swing': {
        for (let x = 0; x < cap; x++) push(b + x, 0.85, x % 2 === 0 ? root : fifth, 0.6, 'bass');
        [0.66, 1.66, 2.66, 3.66].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 0.2, n, 0.38, 'chord'));
        });
        if (style.drum) {
          drum(b, 'kick', 0.5); drum(b + 2, 'kick', 0.45);
          drum(b + 1, 'snare', 0.35); drum(b + 3, 'snare', 0.35);
          [0, 0.66, 1, 1.66, 2, 2.66, 3, 3.66].forEach((x) => { if (x < cap) drum(b + x, 'ride', 0.25); });
        }
        break;
      }
      case 'slowrock': {
        push(b, 2.5, root, 0.8, 'bass');
        [0, 1.5, 3].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 1.2, n, 0.4, 'chord'));
        });
        if (style.drum) {
          drum(b, 'kick', 0.85); drum(b + 2, 'kick', 0.7);
          drum(b + 1, 'snare', 0.7); drum(b + 3, 'snare', 0.7);
          for (let x = 0; x < cap; x += 1) drum(b + x, 'hat', 0.3);
        }
        break;
      }
      case 'yangge': {
        push(b, 0.5, root, 0.9, 'bass');
        push(b + 2, 0.5, fifth, 0.85, 'bass');
        [1, 2.5].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 0.25, n, 0.6, 'chord'));
        });
        if (style.drum) {
          drum(b, 'kick', 1); drum(b + 1, 'tom', 0.7); drum(b + 2, 'kick', 0.9); drum(b + 3, 'tom', 0.7);
          drum(b + 1.5, 'clap', 0.5); drum(b + 3.5, 'clap', 0.5);
        }
        break;
      }
      case 'sizhu': {
        push(b, 1, root, 0.6, 'bass');
        const penta = [0, 2, 4, 7, 9];
        const pc = M.parseChord(chord) ? M.parseChord(chord).pc : 0;
        for (let i = 0; i < Math.round(cap / 0.5); i++) {
          push(b + i * 0.5, 0.42, 48 + pc + 12 + penta[(i * 2) % penta.length], 0.3, 'chord');
        }
        break;
      }
      case 'tango': {
        push(b, 0.6, root, 0.9, 'bass');
        push(b + 1, 0.5, root + 7, 0.75, 'bass');
        push(b + 2, 0.5, root, 0.8, 'bass');
        push(b + 3, 0.5, root + 5, 0.7, 'bass');
        [1, 3].forEach((x) => {
          if (x < cap) notes.forEach((n) => push(b + x, 0.3, n, 0.5, 'chord'));
        });
        if (style.drum) {
          drum(b, 'kick', 0.9); drum(b + 2, 'kick', 0.85);
          drum(b + 1, 'rim', 0.6); drum(b + 3, 'rim', 0.6);
        }
        break;
      }
      default: {
        push(b, cap, root, 0.7, 'bass');
        notes.forEach((n) => push(b, cap, n, 0.4, 'pad'));
      }
    }

    // 加花：最后一拍补十六分音符
    if (fill && style.drum) {
      const last = b + cap - 1;
      for (let x = 0; x < 1; x += 0.25) drum(last + x, x === 0.75 ? 'snare' : 'tom', 0.5 + x * 0.3);
      drum(last, 'snare', 0.6);
    }
    // B 段变奏：高八度加花
    if (vB && gen !== 'ballad' && gen !== 'pentatonic') {
      for (let x = 0; x < cap; x += 1) push(b + x, 0.18, root + 24, 0.25, 'chord');
    }
    return ev;
  }

  /** 全曲伴奏 */
  function build(score) {
    const style = styleByName(score.style);
    const tl = chordTimeline(score);
    const events = [];
    let beat = 0;
    const cap = M.capacity(score);
    score.measures.forEach((m, mi) => {
      const variation = m.variation || (mi === score.measures.length - 1 ? 'EndingA' : score.variation) || 'MainA';
      const chord = m.chord || chordAt(tl, beat);
      const ctx = { cap: M.measureBeats(m) || cap, start: beat, chord, variation, measureIndex: mi };
      events.push(...genMeasure(style, ctx));
      beat = M.round4(beat + (M.measureBeats(m) || cap));
    });
    events.sort((a, b) => a.beat - b.beat || (a.part === 'drum' ? 1 : 0) - (b.part === 'drum' ? 1 : 0));
    return { events, totalBeats: beat, style, chords: tl };
  }

  global.TT.Styles = { STYLES, VARIATIONS, DRUM_MIDI, styleByName, build, chordTimeline, chordAt, chordNotes, isFill, isIntro, isEnding };
})(typeof window !== 'undefined' ? window : globalThis);
