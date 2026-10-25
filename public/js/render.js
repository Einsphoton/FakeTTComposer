/* ============================================================
 * TT作曲家 Web 版 —— 简谱 SVG 排版引擎
 * 屏幕连续排版 + A4 分页打印共用同一套度量
 * ============================================================ */
(function (global) {
  'use strict';
  const M = global.TT.Model;

  const NOTE_SIZE = 22;
  const LYRIC_SIZE = 15;
  const CHORD_SIZE = 13;
  const DASH_GAP = 28;
  const MEASURE_PAD = 8;

  const FONT_NUM = '"Times New Roman", "Songti SC", "SimSun", Georgia, serif';
  const FONT_CN = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function isDotted(dur) {
    return dur === 3 || dur === 1.5 || dur === 0.75 || dur === 0.375;
  }

  function underlineCount(dur) {
    if (dur <= 0.125 + 1e-6) return 3;
    if (dur <= 0.25 + 1e-6) return 2;
    if (dur <= 0.5 + 1e-6) return 1;
    return 0;
  }

  function durAdvance(tok) {
    let w;
    const d = tok.dur;
    if (d >= 2) w = 30 + (Math.round(d) - 1) * DASH_GAP;
    else if (d >= 1.5) w = 40;
    else if (d >= 1) w = 30;
    else if (d >= 0.7) w = 32;
    else if (d >= 0.5) w = 26;
    else if (d >= 0.33) w = 24;
    else if (d >= 0.25) w = 22;
    else w = 20;
    if (tok.lyric) w = Math.max(w, Math.min(64, Array.from(tok.lyric).length * 15 + 8));
    if (tok.chord) w = Math.max(w, Math.min(86, tok.chord.length * 8 + 10));
    if (tok.acc) w += 6;
    if (tok.fermata) w += 2;
    return w;
  }

  function measureWidth(m) {
    let w = MEASURE_PAD * 2;
    for (const t of m.tokens) w += durAdvance(t);
    return Math.max(m.tokens.length ? 76 : 104, w);
  }

  function lyricFor(score, m) {
    return m.tokens.some((t) => t.lyric);
  }

  /** 计算排版：返回 systems / tokens / 高度 */
  function computeLayout(score, contentWidth, opts) {
    opts = opts || {};
    const showLyrics = opts.showLyrics !== false && score.measures.some((m) => lyricFor(score, m));
    const sysH = showLyrics ? 112 : 96;
    const headerH = opts.header === false ? 8 : 138;
    const systems = [];
    let y = headerH;
    let cur = { y, height: sysH, measures: [], width: 0 };
    systems.push(cur);

    score.measures.forEach((m, mi) => {
      const w = measureWidth(m);
      if (cur.width + w > contentWidth && cur.measures.length) {
        y += sysH;
        cur = { y, height: sysH, measures: [], width: 0 };
        systems.push(cur);
      }
      cur.measures.push({ mi, x: cur.width, w });
      cur.width += w;
    });

    // 小节过少时补足一行的视觉宽度
    const tokens = [];
    let globalBeat = 0;
    systems.forEach((sys, si) => {
      let x = 0;
      sys.measures.forEach((mm) => {
        const m = score.measures[mm.mi];
        let cx = x + MEASURE_PAD;
        let beat = 0;
        m.tokens.forEach((tok, ti) => {
          const adv = durAdvance(tok);
          tokens.push({
            m: mm.mi, t: ti, sys: si,
            x: cx, adv,
            gx: tok.dur >= 2 ? cx + 15 : cx + adv / 2,
            y: sys.y, height: sys.height,
            beat: M.round4(beat),
            gbeat: M.round4(globalBeat + beat),
          });
          cx += adv;
          beat += tok.dur;
        });
        mm.x = x;
        mm.gbeat = M.round4(globalBeat);
        x += mm.w;
        globalBeat = M.round4(globalBeat + M.measureBeats(m));
      });
      sys.width = x;
    });

    const lastSys = systems[systems.length - 1];
    const totalHeight = lastSys.y + lastSys.height + 24;
    return { systems, tokens, totalHeight, headerH, sysH, showLyrics, contentWidth };
  }

  /* ---------- 绘制 ---------- */
  function drawHeader(score, contentWidth, opts) {
    if (opts.header === false) return '';
    let s = '';
    const cx = contentWidth / 2;
    s += `<text x="${cx}" y="58" text-anchor="middle" font-family='${FONT_CN}' font-size="30" font-weight="700" fill="#1a1a1a" letter-spacing="3">${esc(score.title || '未命名乐曲')}</text>`;
    if (score.subtitle) {
      s += `<text x="${contentWidth}" y="86" text-anchor="end" font-family='${FONT_CN}' font-size="13" fill="#555">${esc(score.subtitle)}</text>`;
    }
    const keyTxt = `1 = ${esc(score.key)}${score.mode === 'minor' ? '（小调）' : ''}`;
    s += `<text x="0" y="114" font-family='${FONT_CN}' font-size="15" fill="#222">${keyTxt}</text>`;
    s += `<text x="86" y="114" font-family='${FONT_NUM}' font-size="15" fill="#222">${score.timeNum}/${score.timeDen}</text>`;
    // 手绘四分音符（♩ 在部分字体里会缺字）
    s += `<g transform="translate(142,110)" fill="#222">
        <ellipse cx="0" cy="0" rx="4.2" ry="3.2" transform="rotate(-18)"/>
        <rect x="3.4" y="-13" width="1.5" height="13"/>
      </g>`;
    s += `<text x="152" y="114" font-family='${FONT_CN}' font-size="14" fill="#222">= ${score.tempo}</text>`;
    s += `<text x="${contentWidth}" y="114" text-anchor="end" font-family='${FONT_CN}' font-size="12" fill="#777">${esc(score.style || '')}</text>`;
    s += `<line x1="0" y1="126" x2="${contentWidth}" y2="126" stroke="#d8d2c4" stroke-width="1"/>`;
    return s;
  }

  function drawMeasure(score, sys, mm, opts) {
    const m = score.measures[mm.mi];
    let s = '';
    const base = sys.y + 54;
    const barTop = sys.y + 26;
    const barBot = sys.y + (opts.showLyrics ? 80 : 74);
    const chordY = sys.y + 22;
    const lyricY = sys.y + 94;

    // 小节号
    if (score.showRuler !== false && opts.header !== false) {
      s += `<text x="${mm.x + 2}" y="${sys.y + 9}" font-family='${FONT_NUM}' font-size="9.5" fill="#b3aa96">${mm.mi + 1}</text>`;
    }
    if (m.text) {
      s += `<text x="${mm.x + mm.w / 2}" y="${sys.y + 12}" text-anchor="middle" font-family='${FONT_CN}' font-size="12" fill="#8a6d3b">${esc(m.text)}</text>`;
    }

    let cx = mm.x + MEASURE_PAD;
    let beatPos = 0;
    const positions = [];

    m.tokens.forEach((tok, ti) => {
      const adv = durAdvance(tok);
      // 长音符（含增时线）的音符头靠左，增时线向右延伸
      const gx = tok.dur >= 2 ? cx + 15 : cx + adv / 2;
      positions.push({ x: gx, boxX: cx, adv, tok, ti, beat: M.round4(beatPos) });
      cx += adv;
      beatPos += tok.dur;
    });

    // 和弦（小节级）
    if (m.chord && score.showChords !== false) {
      s += `<text x="${mm.x + MEASURE_PAD}" y="${chordY}" font-family='${FONT_CN}' font-size="${CHORD_SIZE}" font-weight="600" fill="#8a2f2f">${esc(m.chord)}</text>`;
    }

    // 小节点击区（放在音符之前，音符优先）
    s += `<rect class="measure-hit" data-mi="${mm.mi}" x="${mm.x}" y="${sys.y + 14}" width="${mm.w}" height="${opts.showLyrics ? 86 : 74}" fill="transparent"/>`;

    // 音符
    positions.forEach((p, i) => {
      const { tok, x } = p;
      const nxt = positions[i + 1];
      const chord = tok.chord || '';
      s += `<rect class="hit" data-m="${mm.mi}" data-t="${p.ti}" x="${p.boxX}" y="${sys.y + 14}" width="${Math.max(14, p.adv)}" height="${opts.showLyrics ? 86 : 74}" fill="transparent" rx="3"/>`;
      if (chord && score.showChords !== false) {
        s += `<text x="${x}" y="${chordY}" text-anchor="middle" font-family='${FONT_CN}' font-size="${CHORD_SIZE}" font-weight="600" fill="#8a2f2f">${esc(chord)}</text>`;
      }
      if (tok.dyn) {
        s += `<text x="${x - 4}" y="${chordY - 14}" text-anchor="end" font-family='${FONT_NUM}' font-size="12" font-style="italic" fill="#444">${esc(tok.dyn)}</text>`;
      }

      // 变音记号
      if (tok.acc && !tok.rest) {
        s += `<text x="${x - 13}" y="${base - 10}" text-anchor="middle" font-family='${FONT_NUM}' font-size="13" fill="#1a1a1a">${esc(M.ACC_TEXT[tok.acc] || tok.acc)}</text>`;
      }

      // 数字
      const glyph = tok.rest ? '0' : String(tok.p);
      s += `<text x="${x}" y="${base}" text-anchor="middle" font-family='${FONT_NUM}' font-size="${NOTE_SIZE}" font-weight="600" fill="#111">${glyph}</text>`;

      // 八度点
      if (!tok.rest) {
        for (let k = 0; k < Math.abs(tok.o); k++) {
          if (tok.o > 0) {
            s += `<circle cx="${x}" cy="${base - 18 - k * 7}" r="2.2" fill="#111"/>`;
          } else {
            const u = underlineCount(tok.dur);
            s += `<circle cx="${x}" cy="${base + 12 + u * 5 + k * 7}" r="2.2" fill="#111"/>`;
          }
        }
      }

      // 附点
      if (isDotted(tok.dur)) {
        const dashes = tok.dur >= 2 ? Math.round(tok.dur) - 1 : 0;
        const dotX = dashes ? x + dashes * DASH_GAP + 12 : x + 10;
        s += `<circle cx="${dotX}" cy="${base - 7}" r="2.3" fill="#111"/>`;
      }

      // 增时线
      if (tok.dur >= 2) {
        const n = Math.round(tok.dur) - 1;
        for (let k = 1; k <= n; k++) {
          s += `<line x1="${x + k * DASH_GAP - 7}" y1="${base - 7}" x2="${x + k * DASH_GAP + 7}" y2="${base - 7}" stroke="#111" stroke-width="2"/>`;
        }
      }

      // 歌词
      if (tok.lyric && opts.showLyrics !== false) {
        s += `<text x="${x}" y="${lyricY}" text-anchor="middle" font-family='${FONT_CN}' font-size="${LYRIC_SIZE}" fill="#222">${esc(tok.lyric)}</text>`;
      }

      // 延长记号
      if (tok.fermata) {
        s += `<path d="M ${x - 8} ${base - 30} Q ${x} ${base - 40} ${x + 8} ${base - 30}" fill="none" stroke="#111" stroke-width="1.4"/>`;
        s += `<circle cx="${x}" cy="${base - 32}" r="1.8" fill="#111"/>`;
      }
      // 换气记号
      if (tok.breath) {
        s += `<path d="M ${x - 4} ${base - 26} L ${x} ${base - 21} L ${x + 4} ${base - 26}" fill="none" stroke="#111" stroke-width="1.3"/>`;
      }

      // 连音线 / 圆滑线
      if ((tok.tie || tok.slur) && nxt) {
        const x1 = x + 7;
        const x2 = nxt.x - 7;
        const top = base - (tok.tie ? 22 : 26);
        s += `<path d="M ${x1} ${top} Q ${(x1 + x2) / 2} ${top - 8} ${x2} ${top}" fill="none" stroke="#111" stroke-width="1.3"/>`;
      }
    });

    // 减时线（同一拍内连成一条）
    let i = 0;
    while (i < positions.length) {
      const p = positions[i];
      const n = underlineCount(p.tok.dur);
      if (n === 0) { i++; continue; }
      const beatIdx = Math.floor(p.beat + 1e-6);
      let j = i;
      while (
        j + 1 < positions.length &&
        underlineCount(positions[j + 1].tok.dur) > 0 &&
        Math.floor(positions[j + 1].beat + 1e-6) === beatIdx
      ) j++;
      const x1 = p.boxX + 3;
      const x2 = positions[j].boxX + positions[j].adv - 3;
      let maxN = n;
      for (let k = i; k <= j; k++) maxN = Math.max(maxN, underlineCount(positions[k].tok.dur));
      for (let lv = 1; lv <= maxN; lv++) {
        const y = base + 6 * lv;
        s += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#111" stroke-width="1.6"/>`;
      }
      i = j + 1;
    }

    // 三连音括号（同一拍内的一组只标一次）
    const isTriplet = (tok) => tok.dur === 0.3333 || tok.dur === 0.6667 || tok.triplet;
    let ti2 = 0;
    while (ti2 < positions.length) {
      if (!isTriplet(positions[ti2].tok)) { ti2++; continue; }
      const beatIdx = Math.floor(positions[ti2].beat + 1e-6);
      let j = ti2;
      while (j + 1 < positions.length && isTriplet(positions[j + 1].tok) && Math.floor(positions[j + 1].beat + 1e-6) === beatIdx) j++;
      const x1 = positions[ti2].boxX + 2;
      const x2 = positions[j].boxX + positions[j].adv - 2;
      const by = base + 19;
      s += `<path d="M ${x1} ${by + 4} L ${x1} ${by} L ${x2} ${by} L ${x2} ${by + 4}" fill="none" stroke="#111" stroke-width="1.1"/>`;
      s += `<text x="${(x1 + x2) / 2}" y="${by - 2}" text-anchor="middle" font-family='${FONT_NUM}' font-size="9" fill="#111">3</text>`;
      ti2 = j + 1;
    }

    // 小节线
    const right = mm.x + mm.w;
    if (mm.mi === score.measures.length - 1) {
      s += `<line x1="${right - 5}" y1="${barTop}" x2="${right - 5}" y2="${barBot}" stroke="#111" stroke-width="1.4"/>`;
      s += `<rect x="${right - 3}" y="${barTop}" width="3.4" height="${barBot - barTop}" fill="#111"/>`;
    } else {
      s += `<line x1="${right}" y1="${barTop}" x2="${right}" y2="${barBot}" stroke="#111" stroke-width="1.2"/>`;
    }
    if (m.repeatStart) {
      s += `<line x1="${mm.x + 4}" y1="${barTop}" x2="${mm.x + 4}" y2="${barBot}" stroke="#111" stroke-width="1.4"/>`;
      s += `<circle cx="${mm.x + 10}" cy="${sys.y + 44}" r="1.8" fill="#111"/><circle cx="${mm.x + 10}" cy="${sys.y + 60}" r="1.8" fill="#111"/>`;
    }
    if (m.repeatEnd) {
      s += `<circle cx="${right - 12}" cy="${sys.y + 44}" r="1.8" fill="#111"/><circle cx="${right - 12}" cy="${sys.y + 60}" r="1.8" fill="#111"/>`;
    }
    if (m.volta) {
      s += `<path d="M ${mm.x + 2} ${sys.y + 4} L ${mm.x + 2} ${sys.y - 2} L ${right - 2} ${sys.y - 2} L ${right - 2} ${sys.y + 4}" fill="none" stroke="#111" stroke-width="1"/>`;
      s += `<text x="${mm.x + 6}" y="${sys.y - 4}" font-family='${FONT_CN}' font-size="11" fill="#111">${m.volta}.</text>`;
    }
    return s;
  }

  function drawSystem(score, sys, opts) {
    let s = '';
    // 行首小节线
    s += `<line x1="0" y1="${sys.y + 26}" x2="0" y2="${sys.y + (opts.showLyrics ? 80 : 74)}" stroke="#111" stroke-width="1.2"/>`;
    sys.measures.forEach((mm) => { s += drawMeasure(score, sys, mm, opts); });
    return s;
  }

  /** 去掉末尾空白小节（只是显示层面，不影响数据） */
  function trimTrailingEmpty(score) {
    const measures = score.measures.slice();
    while (measures.length > 1 && measures[measures.length - 1].tokens.length === 0) measures.pop();
    if (measures.length === score.measures.length) return score;
    return Object.assign({}, score, { measures });
  }

  /** 屏幕用：连续长图 */
  function renderScore(score, opts) {
    opts = Object.assign({ width: 1000, header: true, showLyrics: true }, opts || {});
    const contentWidth = opts.width - 96;
    const layout = computeLayout(score, contentWidth, opts);
    let body = '';
    body += drawHeader(score, contentWidth, opts);
    layout.systems.forEach((sys) => { body += drawSystem(score, sys, layout); });
    const height = layout.totalHeight;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.width} ${height}" width="${opts.width}" height="${height}" class="score-svg">
      <rect x="0" y="0" width="${opts.width}" height="${height}" fill="#fffdf8"/>
      <g transform="translate(48,0)">${body}${opts.interactive === false ? '' : cursorSVG()}</g>
    </svg>`;
    return { svg, layout, width: opts.width, height };
  }

  function cursorSVG() {
    return `<g id="ttCursor" style="display:none">
      <rect x="-13" y="0" width="26" height="50" rx="4" fill="#2f6fb3" opacity="0.12"/>
      <rect x="-13" y="0" width="26" height="50" rx="4" fill="none" stroke="#2f6fb3" stroke-width="1.4"/>
    </g>`;
  }

  /** 打印用：A4 分页 */
  function renderPages(score, opts) {
    opts = Object.assign({ pageWidth: 794, pageHeight: 1123, marginX: 56, marginTop: 48, marginBottom: 56, perPage: 8 }, opts || {});
    score = trimTrailingEmpty(score);
    const contentWidth = opts.pageWidth - opts.marginX * 2;
    const layout = computeLayout(score, contentWidth, { header: true, showLyrics: opts.showLyrics !== false });
    const pages = [];
    const sysH = layout.sysH;
    const usable = opts.pageHeight - opts.marginTop - opts.marginBottom;
    const perPage = Math.max(1, Math.floor((usable - 96) / sysH));
    for (let i = 0; i < layout.systems.length; i += perPage) {
      const group = layout.systems.slice(i, i + perPage);
      const firstY = group[0].y;
      let body = '';
      if (i === 0) body += drawHeader(score, contentWidth, { header: true });
      group.forEach((sys) => {
        const shifted = Object.assign({}, sys, { y: sys.y - firstY + (i === 0 ? layout.headerH : 12) });
        body += drawSystem(score, shifted, layout);
      });
      const pageNo = Math.floor(i / perPage) + 1;
      body += `<text x="${contentWidth / 2}" y="${opts.pageHeight - opts.marginTop - 22}" text-anchor="middle" font-family='${FONT_CN}' font-size="10" fill="#999">— ${pageNo} —</text>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.pageWidth} ${opts.pageHeight}" width="${opts.pageWidth}" height="${opts.pageHeight}">
        <rect width="${opts.pageWidth}" height="${opts.pageHeight}" fill="#ffffff"/>
        <g transform="translate(${opts.marginX},${opts.marginTop})">${body}</g>
      </svg>`;
      pages.push({ svg, pageNo });
    }
    return pages;
  }

  global.TT.Render = {
    renderScore, renderPages, computeLayout, durAdvance, measureWidth, trimTrailingEmpty,
    underlineCount, isDotted, esc, FONT_NUM, FONT_CN,
  };
})(typeof window !== 'undefined' ? window : globalThis);
