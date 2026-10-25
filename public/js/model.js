/* ============================================================
 * TT作曲家 Web 版 —— 乐谱数据模型
 * 时值单位：四分音符 = 1
 * 简谱音级：1-7（0 为休止），八度 o 以中央八度为 0
 * ============================================================ */
(function (global) {
  'use strict';

  const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10];
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  const DUR_LABEL = {
    4: '全音符', 3: '附点二分', 2: '二分音符', 1.5: '附点四分',
    1: '四分音符', 0.75: '附点八分', 0.5: '八分音符',
    0.25: '十六分', 0.125: '三十二分', 0.3333: '三连音', 0.6667: '三连音',
  };

  const ACC_OFFSET = { '': 0, '#': 1, 'b': -1, 'n': 0, '##': 2, 'bb': -2 };
  const ACC_TEXT = { '#': '♯', b: '♭', n: '♮', '##': '𝄪', bb: '𝄫' };

  /* ---------- 和弦 ---------- */
  // TT作曲家 中和弦类型共 32 种，这里列出常用 28 种并支持别名
  const CHORD_TYPES = [
    { key: '', name: '大三和弦', iv: [0, 4, 7] },
    { key: 'm', name: '小三和弦', iv: [0, 3, 7] },
    { key: '7', name: '属七和弦', iv: [0, 4, 7, 10] },
    { key: 'maj7', name: '大七和弦', iv: [0, 4, 7, 11] },
    { key: 'm7', name: '小七和弦', iv: [0, 3, 7, 10] },
    { key: 'dim', name: '减三和弦', iv: [0, 3, 6] },
    { key: 'dim7', name: '减七和弦', iv: [0, 3, 6, 9] },
    { key: 'm7b5', name: '半减七和弦', iv: [0, 3, 6, 10] },
    { key: 'aug', name: '增三和弦', iv: [0, 4, 8] },
    { key: 'sus4', name: '挂四和弦', iv: [0, 5, 7] },
    { key: 'sus2', name: '挂二和弦', iv: [0, 2, 7] },
    { key: '6', name: '六和弦', iv: [0, 4, 7, 9] },
    { key: 'm6', name: '小六和弦', iv: [0, 3, 7, 9] },
    { key: '9', name: '九和弦', iv: [0, 4, 7, 10, 14] },
    { key: 'm9', name: '小九和弦', iv: [0, 3, 7, 10, 14] },
    { key: 'maj9', name: '大九和弦', iv: [0, 4, 7, 11, 14] },
    { key: 'add9', name: '加九和弦', iv: [0, 4, 7, 14] },
    { key: 'madd9', name: '小加九和弦', iv: [0, 3, 7, 14] },
    { key: '69', name: '六九和弦', iv: [0, 4, 7, 9, 14] },
    { key: '7sus4', name: '七挂四和弦', iv: [0, 5, 7, 10] },
    { key: '7b5', name: '七减五和弦', iv: [0, 4, 6, 10] },
    { key: '7#5', name: '七增五和弦', iv: [0, 4, 8, 10] },
    { key: '11', name: '十一和弦', iv: [0, 4, 7, 10, 14, 17] },
    { key: '13', name: '十三和弦', iv: [0, 4, 7, 10, 14, 21] },
    { key: 'm11', name: '小十一和弦', iv: [0, 3, 7, 10, 14, 17] },
    { key: 'maj7#5', name: '大七增五和弦', iv: [0, 4, 8, 11] },
    { key: 'mMaj7', name: '小大七和弦', iv: [0, 3, 7, 11] },
    { key: '5', name: '强力和弦', iv: [0, 7, 12] },
  ];

  const CHORD_ALIAS = {
    'M': '', 'maj': '', 'Major': '', 'min': 'm', 'minor': 'm', 'mi': 'm',
    'M7': 'maj7', 'Maj7': 'maj7', 'Δ': 'maj7', 'dom7': '7',
    '°': 'dim', 'o': 'dim', 'ø': 'm7b5', '+': 'aug', '+5': 'aug',
    'sus': 'sus4', '4': 'sus4', '2': 'sus2',
  };

  /* ---------- 工具 ---------- */
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function isPunct(ch) { return /[，。、！？；：,.!?;:""''（）()《》—…~～·]/.test(ch); }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  function keyToPc(keyName) {
    if (!keyName) return 0;
    const m = /^([A-Ga-g])([#b]?)$/.exec(keyName.trim());
    if (!m) return 0;
    let pc = PC[m[1].toUpperCase()];
    if (m[2] === '#') pc += 1;
    if (m[2] === 'b') pc -= 1;
    return (pc + 12) % 12;
  }

  function newToken(p, opts) {
    return Object.assign({
      p: p == null ? 1 : p,
      o: 0,
      acc: '',
      dur: 1,
      rest: false,
      tie: false,
      slur: false,
      fermata: false,
      breath: false,
      triplet: false,
      lyric: '',
      chord: '',
      dyn: '',
    }, opts || {});
  }

  function emptyMeasure(chord) {
    return { tokens: [], chord: chord || '', variation: '', repeatStart: false, repeatEnd: false, volta: 0, text: '' };
  }

  function newScore(opts) {
    const s = Object.assign({
      version: 1,
      id: null,
      title: '未命名乐曲',
      subtitle: '',
      key: 'C',
      mode: 'major',
      timeNum: 4,
      timeDen: 4,
      tempo: 88,
      style: '民谣',
      variation: 'MainA',
      melodyPreset: 'erhu',
      accompVolume: 0.7,
      melodyVolume: 0.9,
      metronome: false,
      showChords: true,
      showLyrics: true,
      showRuler: true,
      measures: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, opts || {});
    if (!s.measures.length) {
      for (let i = 0; i < 4; i++) s.measures.push(emptyMeasure());
    }
    return s;
  }

  function capacity(score) {
    return round4(score.timeNum * 4 / score.timeDen);
  }

  function measureBeats(m) {
    let b = 0;
    for (const t of m.tokens) b += t.dur;
    return round4(b);
  }

  function totalBeats(score) {
    let b = 0;
    for (const m of score.measures) b += measureBeats(m);
    return round4(b);
  }

  function measureStartBeat(score, mi) {
    let b = 0;
    for (let i = 0; i < mi && i < score.measures.length; i++) b += measureBeats(score.measures[i]);
    return round4(b);
  }

  /** 规范化（兼容旧工程 / 手工编辑过的 JSON） */
  function normalize(score) {
    if (!score || typeof score !== 'object') return newScore();
    const s = score;
    s.version = s.version || 1;
    s.title = s.title || '未命名乐曲';
    s.subtitle = s.subtitle || '';
    s.key = s.key || 'C';
    s.mode = s.mode === 'minor' ? 'minor' : 'major';
    s.timeNum = Number(s.timeNum) || 4;
    s.timeDen = Number(s.timeDen) || 4;
    s.tempo = clamp(Number(s.tempo) || 88, 30, 240);
    s.style = s.style || '民谣';
    s.variation = s.variation || 'MainA';
    s.melodyPreset = s.melodyPreset || 'erhu';
    s.accompVolume = s.accompVolume == null ? 0.7 : Number(s.accompVolume);
    s.melodyVolume = s.melodyVolume == null ? 0.9 : Number(s.melodyVolume);
    if (!Array.isArray(s.measures) || !s.measures.length) s.measures = [emptyMeasure()];
    s.measures = s.measures.map((m) => {
      const mm = m && typeof m === 'object' ? m : {};
      mm.tokens = Array.isArray(mm.tokens) ? mm.tokens.filter((t) => t && typeof t === 'object') : [];
      mm.tokens = mm.tokens.map((t) => {
        const tok = newToken(t.rest ? 0 : clamp(Number(t.p) || 1, 1, 7), t);
        tok.p = t.rest ? 0 : clamp(Number(t.p) || 1, 1, 7);
        tok.rest = !!t.rest || tok.p === 0;
        tok.o = clamp(Number(t.o) || 0, -3, 3);
        tok.dur = Number(t.dur) > 0 ? round4(Number(t.dur)) : 1;
        tok.acc = ACC_OFFSET[t.acc] !== undefined ? t.acc : '';
        tok.lyric = typeof t.lyric === 'string' ? t.lyric : '';
        tok.chord = typeof t.chord === 'string' ? t.chord : '';
        tok.tie = !!t.tie; tok.slur = !!t.slur; tok.fermata = !!t.fermata;
        tok.breath = !!t.breath; tok.triplet = !!t.triplet; tok.dyn = t.dyn || '';
        return tok;
      });
      mm.chord = typeof mm.chord === 'string' ? mm.chord : '';
      mm.variation = mm.variation || '';
      mm.repeatStart = !!mm.repeatStart;
      mm.repeatEnd = !!mm.repeatEnd;
      mm.volta = Number(mm.volta) || 0;
      mm.text = typeof mm.text === 'string' ? mm.text : '';
      return mm;
    });
    return s;
  }

  /** 插入音符；返回新的插入位置 {m,t} */
  function insertToken(score, m, t, tok) {
    const cap = capacity(score);
    let mi = clamp(m, 0, score.measures.length - 1);
    let ti = clamp(t, 0, score.measures[mi].tokens.length);
    let measure = score.measures[mi];
    // 当前小节放不下时，顺延到下一小节
    const used = measureBeats(measure);
    if (used + tok.dur > cap + 1e-6) {
      if (ti >= measure.tokens.length) {
        mi += 1; ti = 0;
        while (score.measures.length <= mi) score.measures.push(emptyMeasure());
        measure = score.measures[mi];
      }
    }
    measure.tokens.splice(ti, 0, tok);
    ti += 1;
    if (ti >= measure.tokens.length) {
      // 小节已满则自动进入下一小节
      if (measureBeats(measure) >= cap - 1e-6) {
        mi += 1; ti = 0;
        while (score.measures.length <= mi) score.measures.push(emptyMeasure());
      }
    }
    return { m: mi, t: ti };
  }

  function deleteToken(score, m, t) {
    const measure = score.measures[m];
    if (!measure) return null;
    if (t < 0) { // 删除上一音符
      if (m === 0 && (!measure.tokens.length)) return null;
      if (measure.tokens.length === 0) {
        if (m === 0) return null;
        const prev = score.measures[m - 1];
        const idx = prev.tokens.length - 1;
        if (idx < 0) return { m: m - 1, t: 0 };
        prev.tokens.splice(idx, 1);
        return { m: m - 1, t: idx };
      }
      return null;
    }
    if (!measure.tokens[t]) return null;
    measure.tokens.splice(t, 1);
    return { m, t: Math.min(t, measure.tokens.length) };
  }

  /** 小节超拍时把多出来的音符顺推到下一小节（级联） */
  function reflow(score, fromMeasure) {
    const cap = capacity(score);
    let mi = Math.max(0, fromMeasure || 0);
    let guard = 0;
    while (mi < score.measures.length && guard++ < 600) {
      const m = score.measures[mi];
      if (measureBeats(m) <= cap + 1e-6) { mi++; continue; }
      let beats = 0;
      let keep = 0;
      for (let i = 0; i < m.tokens.length; i++) {
        beats = round4(beats + m.tokens[i].dur);
        if (beats <= cap + 1e-6) keep = i + 1;
        else break;
      }
      if (keep === 0) { mi++; continue; }
      const moved = m.tokens.splice(keep);
      if (!moved.length) { mi++; continue; }
      if (!score.measures[mi + 1]) score.measures.push(emptyMeasure(m.chord));
      score.measures[mi + 1].tokens.unshift(...moved);
      mi++;
    }
    return score;
  }

  /* ---------- 音高 ---------- */
  function degreeToMidi(p, o, key, acc, mode) {
    const scale = mode === 'minor' ? SCALE_MINOR : SCALE_MAJOR;
    const tonic = keyToPc(key);
    const idx = clamp(p, 1, 7) - 1;
    return 60 + tonic + scale[idx] + 12 * (o || 0) + (ACC_OFFSET[acc] || 0);
  }

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiToName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  /* ---------- 和弦解析 ---------- */
  function parseChord(sym) {
    if (!sym) return null;
    let s = String(sym).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    if (!s) return null;
    const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(s);
    if (!m) return null;
    const rootName = m[1].toUpperCase() + (m[2] || '');
    let rest = m[3] || '';
    let bass = null;
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      bass = rest.slice(slash + 1).trim();
      rest = rest.slice(0, slash).trim();
    }
    rest = rest.replace(/\s+/g, '');
    if (CHORD_ALIAS[rest] !== undefined) rest = CHORD_ALIAS[rest];
    let type = CHORD_TYPES.find((c) => c.key === rest);
    if (!type) {
      // 容错：Am7b5、Cadd9 等写法
      const lower = rest.toLowerCase();
      type = CHORD_TYPES.find((c) => c.key.toLowerCase() === lower);
      if (!type) type = CHORD_TYPES[0];
    }
    let pc = PC[rootName[0]];
    if (rootName[1] === '#') pc += 1;
    if (rootName[1] === 'b') pc -= 1;
    pc = (pc + 12) % 12;
    let bassPc = null;
    if (bass) {
      const bm = /^([A-Ga-g])([#b]?)$/.exec(bass);
      if (bm) {
        bassPc = PC[bm[1].toUpperCase()];
        if (bm[2] === '#') bassPc += 1;
        if (bm[2] === 'b') bassPc -= 1;
        bassPc = (bassPc + 12) % 12;
      }
    }
    return { symbol: sym, root: rootName, type: type.key, typeName: type.name, pc, intervals: type.iv, bassPc };
  }

  function chordToMidi(parsed, baseOctave) {
    if (!parsed) return [];
    const base = 12 * ((baseOctave == null ? 4 : baseOctave) + 1); // C4 = 60
    const root = base + parsed.pc;
    const notes = parsed.intervals.map((iv) => {
      let n = root + iv;
      while (n > root + 16) n -= 12;
      return n;
    });
    if (parsed.bassPc != null) notes.push(base - 12 + parsed.bassPc);
    return Array.from(new Set(notes)).sort((a, b) => a - b);
  }

  /* ---------- 旋律事件 ---------- */
  function melodyEvents(score) {
    const ev = [];
    let beat = 0;
    score.measures.forEach((m, mi) => {
      m.tokens.forEach((t, ti) => {
        if (!t.rest) {
          ev.push({
            beat: round4(beat),
            dur: t.dur,
            midi: degreeToMidi(t.p, t.o, score.key, t.acc, score.mode),
            measure: mi, token: ti, tie: t.tie,
          });
        }
        beat += t.dur;
      });
    });
    // 合并连音线（tie）
    const merged = [];
    for (const e of ev) {
      const prev = merged[merged.length - 1];
      if (prev && prev.tie && prev.midi === e.midi && Math.abs(prev.beat + prev.dur - e.beat) < 1e-6) {
        prev.dur = round4(prev.dur + e.dur);
        prev.tie = e.tie;
      } else {
        merged.push(Object.assign({}, e));
      }
    }
    return merged;
  }

  /* ---------- 歌词自动对齐 ----------
   * 规则（与 TT作曲家 一致）：
   *  一个汉字（或一个英文单词）对应一个音符；
   *  一个空格使下一个字往后空一个音符；
   *  换行使歌词另起一段（跳到下一小节第一个音符）。
   */
  function alignLyrics(score, text) {
    const slots = [];
    score.measures.forEach((m, mi) => {
      m.tokens.forEach((t, ti) => slots.push({ mi, ti, tok: t, isRest: !!t.rest }));
    });
    slots.forEach((s) => { s.tok.lyric = ''; });

    const lines = String(text == null ? '' : text).split(/\r?\n/);
    let ptr = 0;
    let assigned = 0;

    for (let li = 0; li < lines.length; li++) {
      if (li > 0) {
        // 换行 → 另起一段；若当前还停在小节中间，则跳到下一小节开头
        const cur = slots[ptr];
        if (cur) {
          let firstOfMeasure = ptr;
          while (firstOfMeasure > 0 && slots[firstOfMeasure - 1].mi === cur.mi) firstOfMeasure--;
          if (ptr !== firstOfMeasure) {
            let k = ptr;
            while (k < slots.length && slots[k].mi === cur.mi) k++;
            ptr = k;
          }
        }
      }
      const tokens = lines[li].trim().split(/\s+/).filter(Boolean);
      for (const word of tokens) {
        for (const ch of Array.from(word)) {
          if (isPunct(ch)) {
            // 标点贴到上一个已填歌词的音符
            for (let k = ptr - 1; k >= 0; k--) {
              if (slots[k].tok.lyric) { slots[k].tok.lyric += ch; break; }
            }
            continue;
          }
          while (ptr < slots.length && slots[ptr].isRest) ptr++; // 休止符不占歌词
          if (ptr >= slots.length) return assigned;
          const slot = slots[ptr];
          slot.tok.lyric = slot.tok.lyric ? slot.tok.lyric + ch : ch;
          assigned++;
          ptr++;
        }
      }
    }
    return assigned;
  }

  function lyricsToText(score) {
    const lines = [];
    let line = [];
    score.measures.forEach((m, mi) => {
      let any = false;
      m.tokens.forEach((t) => {
        if (t.lyric) { line.push(t.lyric); any = true; }
        else if (!t.rest) line.push(' ');
      });
      if (any && mi < score.measures.length - 1) {
        // 每 2 小节一行，便于阅读（与常见简谱排版一致）
        if (line.length && (mi % 2 === 1)) { lines.push(line.join('').replace(/\s+/g, ' ').trim()); line = []; }
      }
    });
    if (line.join('').trim()) lines.push(line.join('').replace(/\s+/g, ' ').trim());
    return lines.join('\n');
  }

  /* ---------- 示例曲 ---------- */
  function demoScore() {
    const s = newScore({
      title: '小星星',
      subtitle: '法国童谣 · 示例工程',
      key: 'C', timeNum: 4, timeDen: 4, tempo: 96,
      style: '儿童歌曲', variation: 'MainA', melodyPreset: 'musicbox',
    });
    const N = (p, dur, o, extra) => newToken(p, Object.assign({ dur: dur || 1, o: o || 0 }, extra || {}));
    const R = (dur) => newToken(0, { dur: dur || 1, rest: true });
    s.measures = [
      { tokens: [N(1), N(1), N(5), N(5)], chord: 'C' },
      { tokens: [N(6), N(6), N(5, 2)], chord: 'C' },
      { tokens: [N(4), N(4), N(3), N(3)], chord: 'F' },
      { tokens: [N(2), N(2), N(1, 2)], chord: 'C' },
      { tokens: [N(5), N(5), N(4), N(4)], chord: 'G' },
      { tokens: [N(3), N(3), N(2, 2)], chord: 'C' },
      { tokens: [N(5), N(5), N(4), N(4)], chord: 'G' },
      { tokens: [N(3), N(3), N(2, 2)], chord: 'C' },
      { tokens: [N(1), N(1), N(5), N(5)], chord: 'C' },
      { tokens: [N(6), N(6), N(5, 2)], chord: 'C' },
      { tokens: [N(4), N(4), N(3), N(3)], chord: 'F' },
      { tokens: [N(2), N(2), N(1, 2)], chord: 'C' },
    ].map((m) => Object.assign(emptyMeasure(m.chord), m));
    alignLyrics(s, '一闪一闪亮晶晶\n满天都是小星星\n挂在天上放光明\n好像许多小眼睛\n一闪一闪亮晶晶\n满天都是小星星');
    return s;
  }

  const Model = {
    SCALE_MAJOR, SCALE_MINOR, CHORD_TYPES, CHORD_ALIAS, DUR_LABEL, ACC_OFFSET, ACC_TEXT,
    clone, newToken, emptyMeasure, newScore, normalize,
    capacity, measureBeats, totalBeats, measureStartBeat,
    insertToken, deleteToken, degreeToMidi, midiToName, keyToPc, reflow,
    parseChord, chordToMidi, melodyEvents, alignLyrics, lyricsToText,
    demoScore, round4,
  };

  global.TT = global.TT || {};
  global.TT.Model = Model;
  if (typeof module !== 'undefined' && module.exports) module.exports = Model;
})(typeof window !== 'undefined' ? window : globalThis);
