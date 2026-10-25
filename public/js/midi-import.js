/* ============================================================
 * TT作曲家 Web 版 —— MIDI 导入
 * 解析标准 MIDI 文件，挑出主旋律轨，量化后转成简谱
 * ============================================================ */
(function (global) {
  'use strict';
  const M = global.TT.Model;

  const ALLOWED_DUR = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25, 0.125];

  function readVarLen(data, pos) {
    let val = 0;
    let c;
    do {
      c = data[pos++];
      val = (val << 7) | (c & 0x7f);
    } while (c & 0x80);
    return { val, pos };
  }

  function parse(data) {
    if (!data || data.length < 14) throw new Error('文件太小，不是 MIDI');
    const id = String.fromCharCode(...data.slice(0, 4));
    if (id !== 'MThd') throw new Error('不是标准 MIDI 文件');
    const len = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
    const format = (data[8] << 8) | data[9];
    const ntrks = (data[10] << 8) | data[11];
    const division = (data[12] << 8) | data[13];
    if (division & 0x8000) throw new Error('暂不支持 SMPTE 时间格式的 MIDI');
    let pos = 8 + len;
    const tracks = [];
    let tempo = 120;

    for (let t = 0; t < ntrks && pos < data.length; t++) {
      const tid = String.fromCharCode(...data.slice(pos, pos + 4));
      if (tid !== 'MTrk') break;
      const tlen = (data[pos + 4] << 24) | (data[pos + 5] << 16) | (data[pos + 6] << 8) | data[pos + 7];
      const end = pos + 8 + tlen;
      let p = pos + 8;
      let tick = 0;
      let running = 0;
      const notes = [];
      const open = new Map();
      while (p < end) {
        const vl = readVarLen(data, p);
        tick += vl.val;
        p = vl.pos;
        let status = data[p];
        if (status & 0x80) p++;
        else status = running;
        if (status === 0xff) {
          const type = data[p++];
          const l = readVarLen(data, p);
          p = l.pos;
          if (type === 0x51 && l.val === 3) {
            tempo = Math.round(60000000 / (((data[p] << 16) | (data[p + 1] << 8) | data[p + 2])));
          }
          p += l.val;
        } else if (status === 0xf0 || status === 0xf7) {
          const l = readVarLen(data, p);
          p = l.pos + l.val;
        } else {
          running = status;
          const hi = status & 0xf0;
          const ch = status & 0x0f;
          if (hi === 0x90) {
            const note = data[p++];
            const vel = data[p++];
            if (vel > 0) open.set(note, { note, start: tick, vel, ch });
            else {
              const o = open.get(note);
              if (o) { notes.push({ note, start: o.start, dur: tick - o.start, vel: o.vel, ch }); open.delete(note); }
            }
          } else if (hi === 0x80) {
            const note = data[p++];
            p++;
            const o = open.get(note);
            if (o) { notes.push({ note, start: o.start, dur: Math.max(1, tick - o.start), vel: o.vel, ch }); open.delete(note); }
          } else if (hi === 0xc0 || hi === 0xd0) {
            p += 1;
          } else {
            p += 2;
          }
        }
      }
      tracks.push({ notes, endTick: tick });
      pos = end;
    }

    return { format, division, tracks, tempo };
  }

  /** 从多个音符里挑出「主旋律」轨 */
  function pickMelodyTrack(tracks) {
    let best = null;
    tracks.forEach((tr, i) => {
      const notes = tr.notes.filter((n) => n.ch !== 9);
      if (!notes.length) return;
      // 统计同一时刻是否有多个音（和弦轨的复调率高）
      const onsets = new Map();
      notes.forEach((n) => onsets.set(n.start, (onsets.get(n.start) || 0) + 1));
      let mono = 0;
      onsets.forEach((c) => { if (c === 1) mono++; });
      const ratio = mono / onsets.size;
      const avg = notes.reduce((a, n) => a + n.note, 0) / notes.length;
      const score = ratio * 100 + Math.min(notes.length, 400) / 10 + avg / 50;
      if (!best || score > best.score) best = { index: i, notes, ratio, score };
    });
    return best;
  }

  /** 把音高换算成简谱级数 + 变音记号 */
  function pitchToDegree(midi, key, mode) {
    const scale = mode === 'minor' ? M.SCALE_MINOR : M.SCALE_MAJOR;
    const tonic = 60 + M.keyToPc(key);
    const rel = midi - tonic;
    const oct = Math.floor(rel / 12);
    const pc = ((rel % 12) + 12) % 12;
    let best = { d: 0, diff: 99 };
    for (let i = 0; i < 7; i++) {
      let diff = pc - scale[i];
      if (diff > 6) diff -= 12;
      if (diff < -6) diff += 12;
      if (Math.abs(diff) < Math.abs(best.diff)) best = { d: i, diff };
    }
    let acc = '';
    if (best.diff === 1) acc = '#';
    else if (best.diff === -1) acc = 'b';
    else if (best.diff === 2) acc = '##';
    else if (best.diff === -2) acc = 'bb';
    return { p: best.d + 1, o: oct, acc };
  }

  function snapDur(beats) {
    let best = ALLOWED_DUR[0];
    let bd = Infinity;
    for (const d of ALLOWED_DUR) {
      const diff = Math.abs(d - beats);
      if (diff < bd) { bd = diff; best = d; }
    }
    return best;
  }

  function buildScore(midiData, opts) {
    opts = opts || {};
    const parsed = parse(midiData);
    const picked = pickMelodyTrack(parsed.tracks);
    if (!picked || !picked.notes.length) throw new Error('这个 MIDI 里没有找到旋律音符');

    const ppq = parsed.division;
    const grid = 0.25; // 十六分音符网格
    const notes = picked.notes
      .slice()
      .sort((a, b) => a.start - b.start || b.note - a.note);

    // 同一时刻只保留最高音（避免和弦）
    const uniq = [];
    notes.forEach((n) => {
      const last = uniq[uniq.length - 1];
      if (last && Math.abs(last.start - n.start) < ppq * 0.05) {
        if (n.note > last.note) uniq[uniq.length - 1] = n;
      } else uniq.push(n);
    });

    const score = M.newScore({
      title: opts.title || '导入的旋律',
      subtitle: '由 MIDI 导入',
      key: opts.key || 'C',
      tempo: parsed.tempo || 96,
      style: opts.style || '民谣',
    });
    score.measures = [];
    let measure = M.emptyMeasure('');
    let used = 0;
    const cap = M.capacity(score);

    const pushToken = (tok) => {
      if (used + tok.dur > cap + 1e-6) {
        if (measure.tokens.length) score.measures.push(measure);
        measure = M.emptyMeasure('');
        used = 0;
      }
      measure.tokens.push(tok);
      used = M.round4(used + tok.dur);
      if (used >= cap - 1e-6) {
        score.measures.push(measure);
        measure = M.emptyMeasure('');
        used = 0;
      }
    };

    let cursorBeat = 0;
    const maxMeasures = 200;
    for (const n of uniq) {
      if (score.measures.length >= maxMeasures) break;
      const startBeat = Math.round((n.start / ppq) / grid) * grid;
      const rawDur = Math.max(grid, n.dur / ppq);
      let dur = snapDur(Math.round(rawDur / grid) * grid);
      if (dur > cap) dur = cap;
      // 补休止
      let gap = M.round4(startBeat - cursorBeat);
      while (gap > 1e-6 && score.measures.length < maxMeasures) {
        const rd = snapDur(Math.min(gap, cap));
        pushToken(M.newToken(0, { dur: rd, rest: true }));
        gap = M.round4(gap - rd);
        cursorBeat = M.round4(cursorBeat + rd);
      }
      const deg = pitchToDegree(n.note, score.key, score.mode);
      pushToken(M.newToken(deg.p, { dur, o: deg.o, acc: deg.acc }));
      cursorBeat = M.round4(startBeat + dur);
    }
    if (measure.tokens.length) score.measures.push(measure);
    if (!score.measures.length) score.measures.push(M.emptyMeasure(''));
    // 去掉末尾多余空小节
    while (score.measures.length > 1 && !score.measures[score.measures.length - 1].tokens.length) score.measures.pop();
    return { score, trackIndex: picked.index, noteCount: uniq.length, tempo: parsed.tempo };
  }

  async function importFile(file, opts) {
    const buf = new Uint8Array(await file.arrayBuffer());
    return buildScore(buf, opts);
  }

  global.TT.MIDIImport = { parse, buildScore, importFile, pitchToDegree };
})(typeof window !== 'undefined' ? window : globalThis);
