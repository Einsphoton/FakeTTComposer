/* ============================================================
 * TT作曲家 Web 版 —— 标准 MIDI 文件（SMF Format 1）导出
 * 轨道：0 速度/拍号  1 主旋律  2 贝斯  3 和弦  4 鼓组
 * ============================================================ */
(function (global) {
  'use strict';
  const M = global.TT.Model;
  const S = global.TT.Styles;

  const PPQ = 480;

  const PROGRAM = {
    piano: 0, erhu: 110, flute: 73, strings: 48,
    musicbox: 10, organ: 19, guitar: 25, sax: 65,
  };

  function varLen(n) {
    const bytes = [n & 0x7f];
    n >>= 7;
    while (n > 0) {
      bytes.unshift((n & 0x7f) | 0x80);
      n >>= 7;
    }
    return bytes;
  }

  function text(str) {
    const enc = new TextEncoder().encode(str);
    return { len: enc.length, bytes: Array.from(enc) };
  }

  function trackChunk(events) {
    // events: [{tick, bytes:[...], order}]
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const data = [];
    let last = 0;
    events.forEach((e) => {
      data.push(...varLen(e.tick - last));
      data.push(...e.bytes);
      last = e.tick;
    });
    data.push(0x00, 0xff, 0x2f, 0x00);
    const head = [0x4d, 0x54, 0x72, 0x6b,
      (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff,
      (data.length >>> 8) & 0xff, data.length & 0xff];
    return head.concat(data);
  }

  function metaText(type, str) {
    const t = text(str);
    return [0xff, type, ...varLen(t.len), ...t.bytes];
  }

  function build(score) {
    const events = S.build(score);
    const totalBeats = Math.max(M.totalBeats(score), events.totalBeats, 1);
    const ticks = (beat) => Math.round(beat * PPQ);

    /* --- 轨道 0：速度与拍号 --- */
    const conductor = [];
    conductor.push({ tick: 0, bytes: metaText(0x03, score.title || 'TT作曲家'), order: 0 });
    conductor.push({ tick: 0, bytes: [0xff, 0x51, 0x03,
      (Math.round(60000000 / score.tempo) >> 16) & 0xff,
      (Math.round(60000000 / score.tempo) >> 8) & 0xff,
      Math.round(60000000 / score.tempo) & 0xff], order: 1 });
    conductor.push({ tick: 0, bytes: [0xff, 0x58, 0x04, score.timeNum, Math.round(Math.log2(score.timeDen)), 24, 8], order: 2 });
    conductor.push({ tick: 0, bytes: metaText(0x01, `${score.key} ${score.timeNum}/${score.timeDen} ${score.style}`), order: 3 });
    conductor.push({ tick: ticks(totalBeats) + 1, bytes: metaText(0x06, ''), order: 9 });

    /* --- 轨道 1：主旋律 --- */
    const melody = [];
    melody.push({ tick: 0, bytes: metaText(0x03, '主旋律'), order: 0 });
    melody.push({ tick: 0, bytes: [0xc0, PROGRAM[score.melodyPreset] == null ? 0 : PROGRAM[score.melodyPreset]], order: 1 });
    M.melodyEvents(score).forEach((e) => {
      const on = ticks(e.beat);
      const off = ticks(e.beat + e.dur * 0.98);
      const vel = 88;
      melody.push({ tick: on, bytes: [0x90, e.midi & 0x7f, vel], order: 2 });
      melody.push({ tick: off, bytes: [0x80, e.midi & 0x7f, 0], order: 1 });
    });

    /* --- 轨道 2/3/4 --- */
    const bass = [{ tick: 0, bytes: metaText(0x03, '贝斯'), order: 0 }, { tick: 0, bytes: [0xc1, 32], order: 1 }];
    const chord = [{ tick: 0, bytes: metaText(0x03, '和弦'), order: 0 }, { tick: 0, bytes: [0xc2, 4], order: 1 }];
    const drums = [{ tick: 0, bytes: metaText(0x03, '鼓组'), order: 0 }];

    events.events.forEach((e) => {
      if (e.part === 'drum') {
        const t = ticks(e.beat);
        const note = S.DRUM_MIDI[e.drum] || 42;
        const vel = Math.max(1, Math.min(127, Math.round((e.vel || 0.8) * 110)));
        drums.push({ tick: t, bytes: [0x99, note, vel], order: 2 });
        drums.push({ tick: t + 30, bytes: [0x89, note, 0], order: 1 });
        return;
      }
      const t = ticks(e.beat);
      const off = ticks(e.beat + e.dur);
      const vel = Math.max(1, Math.min(127, Math.round((e.vel || 0.7) * 110)));
      if (e.part === 'bass') {
        bass.push({ tick: t, bytes: [0x91, e.midi & 0x7f, vel], order: 2 });
        bass.push({ tick: off, bytes: [0x81, e.midi & 0x7f, 0], order: 1 });
      } else {
        chord.push({ tick: t, bytes: [0x92, e.midi & 0x7f, vel], order: 2 });
        chord.push({ tick: off, bytes: [0x82, e.midi & 0x7f, 0], order: 1 });
      }
    });

    const tracks = [trackChunk(conductor), trackChunk(melody), trackChunk(bass), trackChunk(chord), trackChunk(drums)];
    const header = [0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
      0x00, 0x01, 0x00, tracks.length, (PPQ >> 8) & 0xff, PPQ & 0xff];
    let bytes = header;
    tracks.forEach((t) => { bytes = bytes.concat(t); });
    return new Uint8Array(bytes);
  }

  function download(score) {
    const data = build(score);
    const blob = new Blob([data], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (score.title || '乐曲') + '.mid';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  global.TT.MIDI = { build, download, PPQ };
})(typeof window !== 'undefined' ? window : globalThis);
