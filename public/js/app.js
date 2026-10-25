/* ============================================================
 * TT作曲家 Web 版 —— 界面控制器
 * 键位完全沿用 TT作曲家 1.25：
 *   1-7 音符 / 0 休止
 *   A S D F G H = 全 二分 四分 八分 十六 卅二
 *   Q W E R T Y U = 低3 低2 低1 中 高1 高2 高3
 *   Z X C V B = 重降 降 还原 升 重升
 * ============================================================ */
(function () {
  'use strict';
  const M = window.TT.Model;
  const R = window.TT.Render;
  const S = window.TT.Styles;
  const A = window.TT.Audio;
  const MIDI = window.TT.MIDI;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const engine = new A.Engine();

  const state = {
    score: null,
    projectId: null,
    user: null,
    cursor: { m: 0, t: 0 },
    sel: null,
    overwriteMode: false,
    cur: { dur: 1, o: 0, acc: '', rest: false },
    layout: null,
    renderWidth: 0,
    zoom: 1,
    playing: false,
    dirty: false,
    history: [],
    hIndex: -1,
    saveTimer: null,
    alignTimer: null,
    gridCount: -1,
    renderQueued: false,
    loaded: false,
  };

  const el = {
    wrap: $('#scoreWrap'),
    scroll: $('#scoreScroll'),
    title: $('#docTitle'),
    saveState: $('#saveState'),
    status: $('#statusMsg'),
    info: $('#statusInfo'),
    play: $('#btnPlay'),
    lyrics: $('#lyricsText'),
    chordInput: $('#chordInput'),
    chordGrid: $('#chordGrid'),
    styleSel: $('#styleSel'),
    varSel: $('#varSel'),
    styleDesc: $('#styleDesc'),
    keySel: $('#keySel'),
    modeSel: $('#modeSel'),
    timeNum: $('#timeNum'),
    timeDen: $('#timeDen'),
    subtitle: $('#subtitleInput'),
    presetGrid: $('#presetGrid'),
    tempo: $('#tempoRange'),
    tempoVal: $('#tempoVal'),
    melVol: $('#melVol'),
    accVol: $('#accVol'),
    metro: $('#metroChk'),
    zoomSel: $('#zoomSel'),
    modalMask: $('#modalMask'),
    modalTitle: $('#modalTitle'),
    modalBody: $('#modalBody'),
    modalFoot: $('#modalFoot'),
    fileInput: $('#fileInput'),
    printRoot: $('#printRoot'),
    // 账号系统
    authScreen: $('#authScreen'),
    authTabs: $('#authTabs'),
    authForm: $('#authForm'),
    authUser: $('#authUser'),
    authName: $('#authName'),
    authPass: $('#authPass'),
    authPass2: $('#authPass2'),
    authError: $('#authError'),
    authSubmit: $('#authSubmit'),
    authFoot: $('#authFoot'),
    userChip: $('#userChip'),
    userAvatar: $('#userAvatar'),
    userName: $('#userName'),
    btnLogout: $('#btnLogout'),
  };

  let authMode = 'login';
  let authBusy = false;
  let currentUser = null;

  /* ================= 初始化静态控件 ================= */
  function initControls() {
    S.STYLES.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.name;
      o.textContent = `${s.name}（♩=${s.tempo}）`;
      el.styleSel.appendChild(o);
    });
    S.VARIATIONS.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.key;
      o.textContent = v.name;
      el.varSel.appendChild(o);
    });
    ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].forEach((k) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = '1 = ' + k;
      el.keySel.appendChild(o);
    });
    for (let n = 2; n <= 12; n++) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      el.timeNum.appendChild(o);
    }
    [2, 4, 8, 16].forEach((d) => {
      const o = document.createElement('option');
      o.value = d; o.textContent = d;
      el.timeDen.appendChild(o);
    });
    A.PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.preset = p.key;
      b.textContent = p.name;
      el.presetGrid.appendChild(b);
    });
  }

  /* ================= 渲染 ================= */
  function render() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      doRender();
    });
  }

  function computeRenderWidth() {
    const w = (el.scroll ? el.scroll.clientWidth : 1000) - 40;
    return Math.max(600, Math.min(1400, Math.round(w)));
  }

  function doRender() {
    const score = state.score;
    if (!score) return;
    if (!state.renderWidth) state.renderWidth = computeRenderWidth();
    const res = R.renderScore(score, {
      width: state.renderWidth,
      header: true,
      showLyrics: score.showLyrics !== false,
    });
    el.wrap.innerHTML = res.svg;
    state.layout = res.layout;
    applyZoom();
    updateCursorVisual();
    updateStatus();
    updateChordGridSelection();
  }

  function applyZoom() {
    const base = state.renderWidth || computeRenderWidth();
    const w = Math.round(base * state.zoom);
    el.wrap.style.width = w + 'px';
    el.wrap.style.maxWidth = 'none';
    const svg = el.wrap.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = 'auto'; }
  }

  function tokenPos(m, t) {
    const layout = state.layout;
    if (!layout) return null;
    const hit = layout.tokens.find((p) => p.m === m && p.t === t);
    if (hit) return { x: hit.x, y: hit.y + 26 };
    const arr = layout.tokens.filter((p) => p.m === m);
    if (arr.length) {
      const last = arr[arr.length - 1];
      return { x: last.x + last.adv, y: last.y + 26 };
    }
    // 空小节：从 systems 里找
    for (const sys of layout.systems) {
      const mm = sys.measures.find((x) => x.mi === m);
      if (mm) return { x: mm.x + 8, y: sys.y + 26 };
    }
    return null;
  }

  function updateCursorVisual() {
    const g = el.wrap.querySelector('#ttCursor');
    if (!g) return;
    const pos = tokenPos(state.cursor.m, state.cursor.t);
    if (!pos) { g.style.display = 'none'; return; }
    g.style.display = '';
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    // 选中态高亮
    const selToken = state.sel ? el.wrap.querySelector(`.hit[data-m="${state.sel.m}"][data-t="${state.sel.t}"]`) : null;
    $$('.hit.sel', el.wrap).forEach((n) => n.classList.remove('sel'));
    if (selToken) selToken.classList.add('sel');
    ensureVisible();
  }

  function ensureVisible() {
    const g = el.wrap.querySelector('#ttCursor');
    if (!g || !el.scroll) return;
    const r = g.getBoundingClientRect();
    const s = el.scroll.getBoundingClientRect();
    if (!r.height) return;
    if (r.top < s.top + 50) el.scroll.scrollTop += r.top - s.top - 90;
    else if (r.bottom > s.bottom - 30) el.scroll.scrollTop += r.bottom - s.bottom + 60;
  }

  function updateStatus() {
    const score = state.score;
    const total = M.totalBeats(score);
    const secs = total * 60 / score.tempo;
    const mm = Math.floor(secs / 60);
    const ss = Math.round(secs % 60);
    const notes = score.measures.reduce((n, m) => n + m.tokens.filter((t) => !t.rest).length, 0);
    const m = score.measures[state.cursor.m];
    const beatInMeasure = m ? Math.min(M.capacity(score), M.round4(m.tokens.slice(0, state.cursor.t).reduce((a, t) => a + t.dur, 0) + 1)) : 1;
    $('#posMeasure').textContent = (state.cursor.m + 1) + ' / ' + score.measures.length;
    $('#posBeat').textContent = beatInMeasure;
    $('#posLen').textContent = score.measures.length + ' 小节';
    el.info.textContent = `${notes} 个音符 · 约 ${mm}:${String(ss).padStart(2, '0')} · ${score.timeNum}/${score.timeDen} · 1=${score.key} · ${score.tempo}bpm`;
  }

  /* ================= 光标与导航 ================= */
  function clampCursor(c) {
    const score = state.score;
    c.m = Math.max(0, Math.min(score.measures.length - 1, c.m));
    const len = score.measures[c.m].tokens.length;
    c.t = Math.max(0, Math.min(len, c.t));
    return c;
  }

  function moveCursor(delta) {
    const c = state.cursor;
    const score = state.score;
    if (delta > 0) {
      if (c.t < score.measures[c.m].tokens.length) c.t++;
      else if (c.m < score.measures.length - 1) { c.m++; c.t = 0; }
    } else {
      if (c.t > 0) c.t--;
      else if (c.m > 0) { c.m--; c.t = score.measures[c.m].tokens.length; }
    }
    state.sel = null;
    updateCursorVisual();
    updateStatus();
    syncChordInput();
    updateChordGridSelection();
  }

  function moveMeasure(delta) {
    state.cursor.m = Math.max(0, Math.min(state.score.measures.length - 1, state.cursor.m + delta));
    state.cursor.t = 0;
    state.sel = null;
    updateCursorVisual();
    updateStatus();
    syncChordInput();
    updateChordGridSelection();
  }

  function gotoMeasure(mi) {
    state.cursor = { m: Math.max(0, Math.min(state.score.measures.length - 1, mi)), t: 0 };
    state.sel = null;
    updateCursorVisual();
    updateStatus();
    syncChordInput();
    updateChordGridSelection();
  }

  function targetToken() {
    if (state.sel) {
      const m = state.score.measures[state.sel.m];
      return m ? m.tokens[state.sel.t] : null;
    }
    const m = state.score.measures[state.cursor.m];
    if (!m) return null;
    // 没有明确选中时，作用于光标前一个音符（也就是刚写下的那个）
    if (state.cursor.t > 0) return m.tokens[state.cursor.t - 1] || null;
    return m.tokens[0] || null;
  }

  /* ================= 编辑 ================= */
  function pushHistory() {
    const snap = JSON.stringify(state.score);
    if (state.history[state.hIndex] === snap) return;
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(snap);
    if (state.history.length > 60) state.history.shift();
    state.hIndex = state.history.length - 1;
  }

  /** 把「修改后」的状态记入历史（撤销时回到上一个快照） */
  function commit() {
    const snap = JSON.stringify(state.score);
    if (state.history[state.hIndex] === snap) return;
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(snap);
    if (state.history.length > 60) state.history.shift();
    state.hIndex = state.history.length - 1;
  }

  function undo() {
    if (state.hIndex <= 0) return;
    state.hIndex--;
    state.score = M.normalize(JSON.parse(state.history[state.hIndex]));
    afterEdit('撤销');
  }

  function redo() {
    if (state.hIndex >= state.history.length - 1) return;
    state.hIndex++;
    state.score = M.normalize(JSON.parse(state.history[state.hIndex]));
    afterEdit('重做');
  }

  function afterEdit(msg) {
    M.reflow(state.score, state.cursor.m);
    clampCursor(state.cursor);
    commit();
    if (state.gridCount !== state.score.measures.length) buildChordGrid();
    syncChordInput();
    updateChordGridSelection();
    syncDurButtons();
    syncOctButtons();
    syncAccButtons();
    render();
    markDirty();
    if (msg) flash(msg);
  }

  function writeNote(p, isRest) {
    pushHistory();
    const score = state.score;
    const cap = M.capacity(score);
    const { m, t } = state.cursor;
    const measure = score.measures[m];
    const existing = measure.tokens[t];
    const dur = state.cur.dur;

    if (existing && (state.sel || state.overwriteMode)) {
      // 覆盖：只改音高 / 八度 / 变音，保留原时值
      existing.p = isRest ? 0 : p;
      existing.rest = !!isRest;
      existing.o = state.cur.o;
      existing.acc = isRest ? '' : state.cur.acc;
      state.sel = null;
      state.cursor.t = Math.min(t + 1, measure.tokens.length);
      if (state.cursor.t >= measure.tokens.length && M.measureBeats(measure) >= cap - 1e-6 && m < score.measures.length - 1) {
        state.cursor.m = m + 1;
        state.cursor.t = 0;
      }
    } else {
      const tok = M.newToken(isRest ? 0 : p, {
        dur,
        o: state.cur.o,
        acc: isRest ? '' : state.cur.acc,
        rest: !!isRest,
      });
      const pos = M.insertToken(score, m, t, tok);
      state.cursor.m = pos.m;
      state.cursor.t = pos.t;
      state.sel = null;
      engine.blip(score, tok);
    }
    state.cur.acc = '';
    syncAccButtons();
    afterEdit();
  }

  function setDuration(d) {
    pushHistory();
    state.cur.dur = d;
    const tok = targetToken();
    if (tok && state.sel) tok.dur = d;
    syncDurButtons();
    afterEdit();
  }

  function toggleDot() {
    const map = { 1: 1.5, 1.5: 1, 0.5: 0.75, 0.75: 0.5, 2: 3, 3: 2, 0.25: 0.375, 0.375: 0.25, 4: 4 };
    pushHistory();
    state.cur.dur = map[state.cur.dur] || state.cur.dur;
    const tok = targetToken();
    if (tok && state.sel) tok.dur = state.cur.dur;
    syncDurButtons();
    afterEdit();
  }

  function setOctave(o) {
    pushHistory();
    state.cur.o = o;
    const tok = targetToken();
    if (tok && state.sel) tok.o = o;
    syncOctButtons();
    afterEdit();
  }

  function setAccidental(acc) {
    pushHistory();
    state.cur.acc = acc;
    const tok = targetToken();
    if (tok && state.sel) tok.acc = acc;
    syncAccButtons();
    afterEdit();
  }

  function toggleFlag(flag) {
    pushHistory();
    const tok = targetToken();
    if (!tok) { flash('请先选中一个音符'); return; }
    tok[flag] = !tok[flag];
    afterEdit(flag === 'tie' ? (tok.tie ? '已加连音线' : '已取消连音线') : '');
  }

  function deleteAtCursor() {
    const score = state.score;
    if (state.sel) {
      pushHistory();
      score.measures[state.sel.m].tokens.splice(state.sel.t, 1);
      state.cursor = { m: state.sel.m, t: state.sel.t };
      state.sel = null;
      afterEdit();
      return;
    }
    if (state.cursor.t > 0) {
      pushHistory();
      score.measures[state.cursor.m].tokens.splice(state.cursor.t - 1, 1);
      state.cursor.t -= 1;
      afterEdit();
      return;
    }
    if (state.cursor.m > 0) {
      pushHistory();
      const prev = score.measures[state.cursor.m - 1];
      const idx = prev.tokens.length - 1;
      if (idx >= 0) {
        prev.tokens.splice(idx, 1);
        state.cursor = { m: state.cursor.m - 1, t: idx };
        afterEdit();
      }
    }
  }

  function addMeasure() {
    pushHistory();
    const score = state.score;
    const mi = state.cursor.m + 1;
    score.measures.splice(mi, 0, M.emptyMeasure(score.measures[state.cursor.m].chord));
    state.cursor = { m: mi, t: 0 };
    afterEdit('已插入小节');
  }

  function delMeasure() {
    if (state.score.measures.length <= 1) { flash('至少要保留一个小节'); return; }
    pushHistory();
    state.score.measures.splice(state.cursor.m, 1);
    state.cursor = { m: Math.min(state.cursor.m, state.score.measures.length - 1), t: 0 };
    afterEdit('已删除小节');
  }

  function toggleMeasureFlag(flag) {
    pushHistory();
    const m = state.score.measures[state.cursor.m];
    if (flag === 'volta') m.volta = (m.volta + 1) % 3;
    else m[flag] = !m[flag];
    afterEdit();
  }

  function setChord(sym) {
    const score = state.score;
    const mi = state.sel ? state.sel.m : state.cursor.m;
    const m = score.measures[mi];
    if (!m) return;
    m.chord = sym;
    if (state.sel) {
      const tok = m.tokens[state.sel.t];
      if (tok) tok.chord = sym;
    }
    commit();
    markDirty();
    render();
    buildChordGrid();
  }

  /* ================= 歌词 ================= */
  function applyLyrics(text) {
    const score = state.score;
    score.lyricsText = text;
    M.alignLyrics(score, text);
    commit();
    markDirty();
    render();
  }

  function hasOverflow(newCap) {
    const bad = state.score.measures.some((m) => M.measureBeats(m) > newCap + 1e-6);
    if (!bad) return false;
    return !confirm('改成这个拍号后，超出新拍长的小节会把多出来的音符顺推到下一小节（小节数会变多）。继续吗？');
  }

  /* ================= 播放 ================= */
  function togglePlay() {
    if (state.playing) { stopPlay(); return; }
    playFromCursor();
  }

  function playFromCursor() {
    engine.ensure();
    engine.onTick = onPlayTick;
    engine.onEnd = () => { state.playing = false; updatePlayBtn(); flash('播放完毕'); };
    const score = state.score;
    const m = score.measures[state.cursor.m];
    const beat = M.measureStartBeat(score, state.cursor.m) + m.tokens.slice(0, state.cursor.t).reduce((a, t) => a + t.dur, 0);
    engine.play(score, beat);
    state.playing = true;
    updatePlayBtn();
  }

  function playAll() {
    if (state.playing) stopPlay();
    engine.ensure();
    engine.onTick = onPlayTick;
    engine.onEnd = () => { state.playing = false; updatePlayBtn(); flash('播放完毕'); };
    engine.play(state.score, 0);
    state.playing = true;
    updatePlayBtn();
  }

  function stopPlay() {
    engine.stop();
    state.playing = false;
    updatePlayBtn();
  }

  function updatePlayBtn() {
    el.play.classList.toggle('playing', state.playing);
    el.play.querySelector('.ico').textContent = state.playing ? '■' : '▶';
    el.play.querySelector('span:last-child').textContent = state.playing ? '停止' : '播放';
  }

  let lastFollowBeat = -1;
  function onPlayTick(beat) {
    const layout = state.layout;
    if (!layout) return;
    let found = null;
    for (const p of layout.tokens) {
      if (p.gbeat <= beat + 1e-6) found = p;
      else break;
    }
    if (!found) return;
    if (found.gbeat === lastFollowBeat && state.cursor.m === found.m && state.cursor.t === found.t) return;
    lastFollowBeat = found.gbeat;
    state.cursor = { m: found.m, t: found.t };
    state.sel = null;
    updateCursorVisual();
    updateStatus();
  }

  /* ================= 工程存取 ================= */
  async function api(url, opts) {
    const res = await fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    }, opts));
    if (!res.ok) {
      let msg = res.statusText || ('HTTP ' + res.status);
      try {
        const data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (_) { /* 非 JSON 错误体，用状态文本 */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  /* ================= 账号：登录 / 注册 / 退出 ================= */
  function setAuthError(msg) {
    if (el.authError) el.authError.textContent = msg || '';
  }

  function switchAuthTab(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    el.authScreen.classList.toggle('mode-login', authMode === 'login');
    $$('#authTabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.authTab === authMode);
    });
    el.authSubmit.textContent = authBusy
      ? (authMode === 'login' ? '登录中…' : '注册中…')
      : (authMode === 'login' ? '登 录' : '注 册 并 登 录');
    el.authFoot.textContent = authMode === 'login'
      ? '第一次用？点上面的「注册新账号」，只要十几秒。'
      : '注册后，谱子只存在你自己的账号里，别人看不到。';
    el.authPass.setAttribute('autocomplete', authMode === 'login' ? 'current-password' : 'new-password');
    setAuthError('');
  }

  function showAuth(mode) {
    if (state.playing) stopPlay();
    if (el.modalMask && !el.modalMask.hidden) closeModal();
    el.authScreen.hidden = false;
    document.documentElement.classList.add('auth-locked');
    switchAuthTab(mode || 'login');
    setTimeout(() => {
      if (authMode === 'register') el.authUser.focus();
      else if (el.authUser.value.trim()) el.authPass.focus();
      else el.authUser.focus();
    }, 40);
  }

  function hideAuth() {
    el.authScreen.hidden = true;
    document.documentElement.classList.remove('auth-locked');
    setAuthError('');
  }

  function renderUserChip() {
    if (!currentUser) { el.userChip.hidden = true; return; }
    const name = currentUser.displayName || currentUser.username || '我';
    el.userName.textContent = name;
    el.userAvatar.textContent = name.slice(0, 1).toUpperCase();
    el.userChip.hidden = false;
  }

  /** 统一的 401 处理：回到登录界面 */
  function needLogin(e) {
    if (!e || e.status !== 401) return false;
    currentUser = null;
    el.userChip.hidden = true;
    showAuth('login');
    setAuthError('登录状态已过期，请重新登录');
    return true;
  }

  async function submitAuth(ev) {
    if (ev) ev.preventDefault();
    if (authBusy) return;

    const username = el.authUser.value.trim();
    const password = el.authPass.value;
    const displayName = el.authName.value.trim();

    if (!username) { setAuthError('请先填用户名'); el.authUser.focus(); return; }
    if (!password) { setAuthError('请填密码'); el.authPass.focus(); return; }
    if (authMode === 'register') {
      if (password.length < 6) { setAuthError('密码至少 6 位'); el.authPass.focus(); return; }
      if (password !== el.authPass2.value) { setAuthError('两次输入的密码不一样'); el.authPass2.focus(); return; }
    }

    authBusy = true;
    el.authSubmit.disabled = true;
    el.authSubmit.textContent = authMode === 'login' ? '登录中…' : '注册中…';
    setAuthError('');

    try {
      const r = await api('/api/auth/' + authMode, {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName }),
      });
      el.authPass.value = '';
      el.authPass2.value = '';
      await enterApp(r.user);
      if (r && r.migrated) flash(`已接管 ${r.migrated} 个旧作品`);
    } catch (e) {
      if (e && e.status) setAuthError(e.message || '操作失败，请重试');
      else setAuthError('连不上服务器，请确认 NAS 上的容器还在运行');
    } finally {
      authBusy = false;
      el.authSubmit.disabled = false;
      el.authSubmit.textContent = authMode === 'login' ? '登 录' : '注 册 并 登 录';
    }
  }

  async function logout() {
    if (state.dirty && !confirm('当前工程还有没保存的修改，确定退出登录吗？')) return;
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) { /* 网络问题也让本地退出 */ }
    if (state.playing) stopPlay();
    currentUser = null;
    state.projectId = null;
    state.score = null;
    state.sel = null;
    state.dirty = false;
    state.history = [];
    state.hIndex = -1;
    el.wrap.innerHTML = '';
    el.chordGrid.innerHTML = '';
    el.lyrics.value = '';
    el.userChip.hidden = true;
    el.saveState.textContent = '未登录';
    el.saveState.classList.remove('dirty');
    try { localStorage.removeItem('tt_recent'); } catch (_) {}
    showAuth('login');
    flash('已退出登录');
  }

  function changePasswordDialog() {
    if (!currentUser) { showAuth('login'); return; }
    const html = `
      <div class="pwd-form">
        <p class="hint" style="margin:0 0 14px">账号：<b>${R.esc(currentUser.username)}</b>。改完密码后，已经登录的其他设备不会被踢下线。</p>
        <label class="field"><span>原密码</span>
          <input id="pwdOld" type="password" autocomplete="current-password" maxlength="64">
        </label>
        <label class="field"><span>新密码</span>
          <input id="pwdNew" type="password" autocomplete="new-password" maxlength="64" placeholder="至少 6 位">
        </label>
        <label class="field"><span>再输一次新密码</span>
          <input id="pwdNew2" type="password" autocomplete="new-password" maxlength="64">
        </label>
        <p class="auth-error" id="pwdError"></p>
      </div>`;
    openModal('修改密码', html, [
      { text: '确定修改', cls: 'btn primary', onClick: submitPassword },
      { text: '取消', cls: 'btn', onClick: closeModal },
    ]);
    const focusOld = () => { const n = $('#pwdOld'); if (n) n.focus(); };
    setTimeout(focusOld, 60);
    ['pwdOld', 'pwdNew', 'pwdNew2'].forEach((id) => {
      const n = $('#' + id);
      if (n) n.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submitPassword(); });
    });
  }

  async function submitPassword() {
    const oldPassword = ($('#pwdOld') || {}).value || '';
    const newPassword = ($('#pwdNew') || {}).value || '';
    const again = ($('#pwdNew2') || {}).value || '';
    const err = $('#pwdError');
    const fail = (msg) => { if (err) err.textContent = msg; };
    if (!oldPassword) return fail('请填原密码');
    if (newPassword.length < 6) return fail('新密码至少 6 位');
    if (newPassword !== again) return fail('两次输入的新密码不一样');
    fail('');
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      closeModal();
      flash('密码已修改，下次用新密码登录');
    } catch (e) {
      if (!needLogin(e)) fail(e.message || '修改失败');
    }
  }

  function markDirty() {
    state.dirty = true;
    el.saveState.textContent = '未保存';
    el.saveState.classList.add('dirty');
    scheduleSave();
  }

  function scheduleSave() {
    if (!state.projectId) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { saveProject(true); }, 1200);
  }

  async function saveProject(silent) {
    if (!state.score) return;
    try {
      state.score.lyricsText = el.lyrics.value;
      if (!state.projectId) {
        const r = await api('/api/projects', { method: 'POST', body: JSON.stringify(state.score) });
        state.projectId = r.id;
        state.score.id = r.id;
      } else {
        try {
          await api('/api/projects/' + state.projectId, { method: 'PUT', body: JSON.stringify(state.score) });
        } catch (e) {
          // 工程文件在服务端被删掉了：重新建一份，别让用户白写
          if (e.status === 404) {
            const r = await api('/api/projects', { method: 'POST', body: JSON.stringify(state.score) });
            state.projectId = r.id;
            state.score.id = r.id;
          } else {
            throw e;
          }
        }
      }
      state.dirty = false;
      const t = new Date();
      el.saveState.textContent = `已保存 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      el.saveState.classList.remove('dirty');
      if (!silent) flash('已保存到 NAS');
    } catch (e) {
      if (needLogin(e)) return;
      el.saveState.textContent = '保存失败';
      el.saveState.classList.add('dirty');
      flash('保存失败：' + e.message);
    }
  }

  async function loadProject(id) {
    try {
      const doc = await api('/api/projects/' + id);
      state.score = M.normalize(doc);
      state.projectId = id;
      state.cursor = { m: 0, t: 0 };
      state.sel = null;
      state.history = [JSON.stringify(state.score)];
      state.hIndex = 0;
      state.dirty = false;
      el.saveState.textContent = '已打开';
      el.saveState.classList.remove('dirty');
      syncAllControls();
      render();
      flash('已打开《' + state.score.title + '》');
      closeModal();
      try {
        const hist = JSON.parse(localStorage.getItem('tt_recent') || '[]');
        localStorage.setItem('tt_recent', JSON.stringify([id, ...hist.filter((x) => x !== id)].slice(0, 8)));
      } catch (_) {}
    } catch (e) {
      if (needLogin(e)) return;
      flash('打开失败：' + e.message);
    }
  }

  function newProject() {
    if (state.dirty && !confirm('当前工程还没有保存，确定新建吗？')) return;
    state.score = M.newScore({ title: '未命名乐曲' });
    state.projectId = null;
    state.cursor = { m: 0, t: 0 };
    state.sel = null;
    state.history = [JSON.stringify(state.score)];
    state.hIndex = 0;
    state.dirty = true;
    syncAllControls();
    render();
    saveProject(true);
    flash('已新建工程');
  }

  async function openDialog() {
    let projects = [];
    try {
      const r = await api('/api/projects');
      projects = r.projects || [];
    } catch (e) {
      if (needLogin(e)) return;
      flash('读取工程列表失败：' + e.message);
    }
    const html = projects.length
      ? `<div class="project-list">${projects.map((p) => `
          <div class="project-item" data-id="${p.id}">
            <div>
              <div class="p-title">${R.esc(p.title || '未命名')}</div>
              <div class="p-meta">${p.measures} 小节 · ${new Date(p.updated).toLocaleString('zh-CN')}</div>
            </div>
            <button class="p-del" data-del="${p.id}">删除</button>
          </div>`).join('')}</div>`
      : `<div class="empty">还没有保存过工程。<br>先写一首，点右上角「保存」即可。</div>`;
    openModal('我的作品' + (currentUser ? ' · ' + currentUser.displayName : ''), html, [
      { text: '新建乐曲', cls: 'btn', onClick: () => { closeModal(); newProject(); } },
      { text: '关闭', cls: 'btn primary', onClick: closeModal },
    ]);
    el.modalBody.querySelectorAll('.project-item').forEach((node) => {
      node.addEventListener('click', (ev) => {
        if (ev.target.dataset.del) return;
        loadProject(node.dataset.id);
      });
    });
    el.modalBody.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('删除这个工程？此操作不可恢复。')) return;
        try {
          await api('/api/projects/' + b.dataset.del, { method: 'DELETE' });
        } catch (e) {
          if (needLogin(e)) return;
          flash('删除失败：' + e.message);
          return;
        }
        if (b.dataset.del === state.projectId) {
          state.projectId = null;
          state.dirty = true;
        }
        openDialog();
      });
    });
  }

  /* ================= 打印 ================= */
  function printPreview() {
    const pages = R.renderPages(state.score, { showLyrics: state.score.showLyrics !== false });
    const html = `<div class="print-preview">${pages.map((p) => `<div class="page">${p.svg}</div>`).join('')}</div>`;
    openModal('打印预览（A4）', html, [
      { text: '导出 PDF / 打印', cls: 'btn primary', onClick: doPrint },
      { text: '关闭', cls: 'btn', onClick: closeModal },
    ]);
  }

  function doPrint() {
    const pages = R.renderPages(state.score, { showLyrics: state.score.showLyrics !== false });
    el.printRoot.innerHTML = pages.map((p) => `<div class="page">${p.svg}</div>`).join('');
    setTimeout(() => window.print(), 120);
  }

  /* ================= 帮助 ================= */
  function helpDialog() {
    const html = `
      <div class="help-section">
        <h3>三步就能写一首简谱</h3>
        <p>① 用鼠标点击谱面上的位置（或直接敲数字键）开始写音符；② 右侧「伴奏」里选一个节奏风格、给每小节填上和弦；③ 点「播放」试听，满意后点「打印 / PDF」。</p>
      </div>
      <div class="help-section">
        <h3>键盘操作（与 TT作曲家 1.25 相同）</h3>
        <table class="kbd-table">
          <tr><td><kbd>1</kbd>…<kbd>7</kbd> <kbd>0</kbd></td><td>输入音符 1-7，<kbd>0</kbd> 为休止符</td></tr>
          <tr><td><kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd></td><td>全音符 / 二分 / 四分 / 八分 / 十六分 / 三十二分</td></tr>
          <tr><td><kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>T</kbd> <kbd>Y</kbd> <kbd>U</kbd></td><td>低三个八度 … 中音 … 高三个八度</td></tr>
          <tr><td><kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd> <kbd>B</kbd></td><td>重降 ♭♭ / 降 ♭ / 还原 ♮ / 升 ♯ / 重升 𝄪</td></tr>
          <tr><td><kbd>空格</kbd></td><td>播放 / 停止</td></tr>
          <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>前后移动光标</td></tr>
          <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>上一小节 / 下一小节</td></tr>
          <tr><td><kbd>Backspace</kbd></td><td>删除前一个音符</td></tr>
          <tr><td><kbd>.</kbd></td><td>加 / 去附点</td></tr>
          <tr><td><kbd>Insert</kbd></td><td>切换「插入 / 覆盖」模式</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>撤销 / 重做</td></tr>
        </table>
      </div>
      <div class="help-section">
        <h3>歌词</h3>
        <p>在右侧「歌词」里输入：一个汉字对一个音符，空格让下一个字往后空一个音符，回车另起一段。输入后自动对齐，不需要一个个去点。</p>
      </div>
      <div class="help-section">
        <h3>关于自动伴奏</h3>
        <p>伴奏按「节奏风格 + 每小节和弦」实时生成。给小节填上 C、Am、G7、F#m7 这样的和弦记号，播放时就会自动配上贝斯、和弦与鼓组；导出 MIDI 后可在任何音乐软件里继续精修。</p>
      </div>
      <div class="help-section">
        <h3>账号与云端存储</h3>
        <p>每个人用自己的账号登录，写好的谱子自动存到自己的空间里，互相看不到。换一台电脑、换一个浏览器，只要用同一个账号登录就能接着写。密码忘了可以在 NAS 上删掉 <code>/data/users.json</code> 重新建（会一并清空所有账号，谱子文件还在）。</p>
      </div>
      <div class="help-section">
        <h3>部署与数据</h3>
        <p>本程序跑在你自己的 NAS 上，工程文件以 JSON 保存在容器的 <code>/data</code> 目录里，建议把该目录挂载到 NAS 的共享文件夹并定期备份。断电、重启都不会丢谱子。</p>
      </div>`;
    openModal('使用说明', html, [{ text: '知道了', cls: 'btn primary', onClick: closeModal }]);
  }

  /* ================= 模态框 ================= */
  function openModal(title, bodyHtml, buttons) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = bodyHtml;
    el.modalFoot.innerHTML = '';
    (buttons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = b.cls || 'btn';
      btn.textContent = b.text;
      btn.addEventListener('click', b.onClick);
      el.modalFoot.appendChild(btn);
    });
    el.modalMask.hidden = false;
  }

  function closeModal() {
    el.modalMask.hidden = true;
    el.modalBody.innerHTML = '';
    el.modalFoot.innerHTML = '';
  }

  /* ================= 面板同步 ================= */
  function syncAllControls() {
    const score = state.score;
    el.title.value = score.title;
    el.subtitle.value = score.subtitle || '';
    el.styleSel.value = score.style;
    el.varSel.value = score.variation;
    el.keySel.value = score.key;
    el.modeSel.value = score.mode || 'major';
    el.timeNum.value = String(score.timeNum);
    el.timeDen.value = String(score.timeDen);
    el.tempo.value = score.tempo;
    el.tempoVal.textContent = score.tempo;
    el.melVol.value = score.melodyVolume;
    el.accVol.value = score.accompVolume;
    el.metro.checked = !!score.metronome;
    $('#showChords').checked = score.showChords !== false;
    $('#showLyrics').checked = score.showLyrics !== false;
    $('#showRuler').checked = score.showRuler !== false;
    el.lyrics.value = score.lyricsText != null ? score.lyricsText : M.lyricsToText(score);
    el.zoomSel.value = String(state.zoom);
    updateStyleDesc();
    syncPresetGrid();
    syncDurButtons();
    syncOctButtons();
    syncAccButtons();
    buildChordGrid();
    syncChordInput();
    updatePlayBtn();
  }

  function syncDurButtons() {
    $$('[data-dur]').forEach((b) => {
      const d = Number(b.dataset.dur);
      b.classList.toggle('active', Math.abs(d - state.cur.dur) < 1e-6);
    });
  }
  function syncOctButtons() {
    $$('#octaveRow button').forEach((b) => b.classList.toggle('active', Number(b.dataset.o) === state.cur.o));
  }
  function syncAccButtons() {
    $$('[data-acc]').forEach((b) => b.classList.toggle('active', b.dataset.acc === state.cur.acc));
  }
  function syncPresetGrid() {
    $$('#presetGrid button').forEach((b) => b.classList.toggle('active', b.dataset.preset === state.score.melodyPreset));
  }
  function updateStyleDesc() {
    const st = S.styleByName(state.score.style);
    el.styleDesc.textContent = st.desc + ' · 建议 ♩=' + st.tempo;
  }

  function buildChordGrid() {
    const score = state.score;
    state.gridCount = score.measures.length;
    el.chordGrid.innerHTML = score.measures.map((m, i) => `
      <div class="chord-cell" data-mi="${i}">
        <label>${i + 1}</label>
        <input value="${R.esc(m.chord || '')}" data-mi="${i}" placeholder="—" spellcheck="false">
      </div>`).join('');
    el.chordGrid.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const mi = Number(inp.dataset.mi);
        state.score.measures[mi].chord = inp.value.trim();
        commit();
        markDirty();
        render();
      });
      inp.addEventListener('focus', () => gotoMeasure(Number(inp.dataset.mi)));
    });
    el.chordGrid.querySelectorAll('label').forEach((lb) => {
      lb.addEventListener('click', () => gotoMeasure(Number(lb.parentNode.dataset.mi)));
    });
    updateChordGridSelection();
  }

  function updateChordGridSelection() {
    $$('.chord-cell', el.chordGrid).forEach((c) => {
      c.classList.toggle('current', Number(c.dataset.mi) === state.cursor.m);
    });
  }

  function syncChordInput() {
    const m = state.score.measures[state.cursor.m];
    el.chordInput.value = m ? m.chord || '' : '';
  }

  /* ================= 提示 ================= */
  let flashTimer = null;
  function flash(msg) {
    el.status.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.status.textContent = '就绪'; }, 2600);
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    // 工具条
    $('#toolstrip').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-dur')) setDuration(Number(b.dataset.dur));
      else if (b.hasAttribute('data-acc')) setAccidental(b.dataset.acc);
      else if (b.dataset.cmd) {
        const cmd = b.dataset.cmd;
        if (cmd === 'dot') toggleDot();
        else if (cmd === 'rest') writeNote(0, true);
        else if (cmd === 'tie') toggleFlag('tie');
        else if (cmd === 'slur') toggleFlag('slur');
        else if (cmd === 'fermata') toggleFlag('fermata');
        else if (cmd === 'breath') toggleFlag('breath');
        else if (cmd === 'addMeasure') addMeasure();
        else if (cmd === 'delMeasure') delMeasure();
        else if (cmd === 'repeatStart') toggleMeasureFlag('repeatStart');
        else if (cmd === 'repeatEnd') toggleMeasureFlag('repeatEnd');
        else if (cmd === 'volta') toggleMeasureFlag('volta');
      }
      b.blur();
    });

    $('#keypad').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const p = Number(b.dataset.p);
      if (p === 0) writeNote(0, true);
      else writeNote(p, false);
      b.blur();
    });

    $('#octaveRow').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      setOctave(Number(b.dataset.o));
      b.blur();
    });

    // 谱面点击
    el.wrap.addEventListener('click', (ev) => {
      const hit = ev.target.closest('.hit');
      if (hit && hit.dataset.m != null) {
        state.cursor = { m: Number(hit.dataset.m), t: Number(hit.dataset.t) };
        state.sel = { m: state.cursor.m, t: state.cursor.t };
        updateCursorVisual();
        updateStatus();
        syncChordInput();
        updateChordGridSelection();
        const tok = state.score.measures[state.cursor.m].tokens[state.cursor.t];
        if (tok) {
          state.cur.dur = tok.dur;
          state.cur.o = tok.o;
          state.cur.acc = tok.acc;
          syncDurButtons(); syncOctButtons(); syncAccButtons();
          engine.ensure();
          engine.blip(state.score, tok);
        }
        return;
      }
      const mh = ev.target.closest('.measure-hit');
      if (mh) {
        gotoMeasure(Number(mh.dataset.mi));
        state.cursor.t = state.score.measures[state.cursor.m].tokens.length;
        updateCursorVisual();
      }
    });

    // 键盘
    document.addEventListener('keydown', onKeyDown);

    // 顶栏
    $$('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'new') newProject();
        else if (act === 'open') openDialog();
        else if (act === 'save') saveProject(false);
        else if (act === 'midi') { MIDI.download(state.score); flash('已导出 MIDI 文件'); }
        else if (act === 'print') printPreview();
        else if (act === 'help') helpDialog();
        else if (act === 'preview') playAll();
        else if (act === 'exportJson') exportJson();
        else if (act === 'importJson') el.fileInput.click();
        else if (act === 'importMidi') $('#midiInput').click();
        else if (act === 'deleteProject') deleteProject();
        else if (act === 'password') changePasswordDialog();
      });
    });

    $('#btnPlay').addEventListener('click', togglePlay);
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $('#btnPanel').addEventListener('click', () => {
      $('.panel.right').classList.toggle('mobile-open');
    });
    $('#btnAudition').addEventListener('click', () => engine.audition(state.score.melodyPreset, 67));
    $('#btnAlign').addEventListener('click', () => { applyLyrics(el.lyrics.value); flash('歌词已重新对齐'); });
    $('#btnClearLyric').addEventListener('click', () => { el.lyrics.value = ''; applyLyrics(''); });

    el.title.addEventListener('input', () => {
      state.score.title = el.title.value;
      markDirty();
      render();
    });
    el.subtitle.addEventListener('input', () => {
      state.score.subtitle = el.subtitle.value;
      markDirty();
      render();
    });

    el.styleSel.addEventListener('change', () => {
      state.score.style = el.styleSel.value;
      const st = S.styleByName(state.score.style);
      state.score.tempo = st.tempo;
      el.tempo.value = st.tempo;
      el.tempoVal.textContent = st.tempo;
      updateStyleDesc();
      markDirty();
      render();
    });
    el.varSel.addEventListener('change', () => {
      state.score.variation = el.varSel.value;
      markDirty();
      render();
    });

    el.keySel.addEventListener('change', () => { state.score.key = el.keySel.value; markDirty(); render(); });
    el.modeSel.addEventListener('change', () => { state.score.mode = el.modeSel.value; markDirty(); render(); });
    el.timeNum.addEventListener('change', () => {
      const cap = Number(el.timeNum.value) * 4 / Number(el.timeDen.value);
      if (hasOverflow(cap)) { el.timeNum.value = state.score.timeNum; return; }
      state.score.timeNum = Number(el.timeNum.value);
      M.reflow(state.score, 0);
      markDirty();
      render();
    });
    el.timeDen.addEventListener('change', () => {
      const cap = Number(el.timeNum.value) * 4 / Number(el.timeDen.value);
      if (hasOverflow(cap)) { el.timeDen.value = state.score.timeDen; return; }
      state.score.timeDen = Number(el.timeDen.value);
      M.reflow(state.score, 0);
      markDirty();
      render();
    });

    el.tempo.addEventListener('input', () => {
      state.score.tempo = Number(el.tempo.value);
      el.tempoVal.textContent = el.tempo.value;
      markDirty();
      if (state.playing) stopPlay();
      else updateStatus();
    });
    el.melVol.addEventListener('input', () => {
      state.score.melodyVolume = Number(el.melVol.value);
      engine.setVolumes(state.score.melodyVolume, state.score.accompVolume);
      markDirty();
    });
    el.accVol.addEventListener('input', () => {
      state.score.accompVolume = Number(el.accVol.value);
      engine.setVolumes(state.score.melodyVolume, state.score.accompVolume);
      markDirty();
    });
    el.metro.addEventListener('change', () => { state.score.metronome = el.metro.checked; markDirty(); });

    el.lyrics.addEventListener('input', () => {
      state.score.lyricsText = el.lyrics.value;
      clearTimeout(state.alignTimer);
      state.alignTimer = setTimeout(() => {
        M.alignLyrics(state.score, el.lyrics.value);
        markDirty();
        render();
      }, 260);
    });

    el.chordInput.addEventListener('change', () => setChord(el.chordInput.value.trim()));
    el.chordInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { setChord(el.chordInput.value.trim()); el.chordInput.blur(); }
    });

    $('#presetGrid').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      state.score.melodyPreset = b.dataset.preset;
      syncPresetGrid();
      markDirty();
      engine.audition(state.score.melodyPreset, 67);
    });

    $('#showChords').addEventListener('change', (e) => { state.score.showChords = e.target.checked; markDirty(); render(); });
    $('#showLyrics').addEventListener('change', (e) => { state.score.showLyrics = e.target.checked; markDirty(); render(); });
    $('#showRuler').addEventListener('change', (e) => { state.score.showRuler = e.target.checked; markDirty(); render(); });

    el.zoomSel.addEventListener('change', () => {
      state.zoom = Number(el.zoomSel.value);
      applyZoom();
      updateCursorVisual();
    });

    $('#tabs').addEventListener('click', (ev) => {
      const t = ev.target.closest('.tab');
      if (!t) return;
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
    });

    $('#modalClose').addEventListener('click', closeModal);
    el.modalMask.addEventListener('click', (ev) => { if (ev.target === el.modalMask) closeModal(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !el.modalMask.hidden) closeModal();
    });

    el.fileInput.addEventListener('change', importJson);
    $('#midiInput').addEventListener('change', importMidi);

    window.addEventListener('beforeunload', (ev) => {
      if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
    });

    // 拖动谱面时保持光标可见
    el.scroll.addEventListener('scroll', () => {}, { passive: true });

    // 窗口尺寸变化时按新宽度重新排版，保证谱面始终铺满且字号清晰
    if (window.ResizeObserver) {
      let rzTimer = null;
      new ResizeObserver(() => {
        clearTimeout(rzTimer);
        rzTimer = setTimeout(() => {
          const w = computeRenderWidth();
          if (Math.abs(w - state.renderWidth) > 8) {
            state.renderWidth = w;
            render();
          }
        }, 220);
      }).observe(el.scroll);
    }
  }

  /* ================= 账号界面事件 ================= */
  function bindAuth() {
    el.authTabs.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-auth-tab]');
      if (!b) return;
      switchAuthTab(b.dataset.authTab);
      setTimeout(() => {
        if (authMode === 'register') el.authUser.focus();
        else if (el.authUser.value.trim()) el.authPass.focus();
        else el.authUser.focus();
      }, 20);
    });
    el.authForm.addEventListener('submit', submitAuth);
    el.btnLogout.addEventListener('click', logout);
  }

  function onKeyDown(ev) {
    // 登录界面挡住编辑器时，快捷键全部失效
    if (el.authScreen && !el.authScreen.hidden) return;
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (ev.key === 'Escape') ev.target.blur();
      return;
    }
    if (!el.modalMask.hidden) return;
    if (ev.metaKey || ev.altKey) return;

    if (ev.ctrlKey) {
      if (ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) redo(); else undo();
        return;
      }
      if (ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
      if (ev.key.toLowerCase() === 's') { ev.preventDefault(); saveProject(false); return; }
      if (ev.key.toLowerCase() === 'p') { ev.preventDefault(); printPreview(); return; }
      return;
    }

    const k = ev.key;
    if (/^[0-9]$/.test(k)) {
      ev.preventDefault();
      const n = Number(k);
      if (n === 0) writeNote(0, true); else writeNote(n, false);
      return;
    }
    const lower = k.toLowerCase();
    const durMap = { a: 4, s: 2, d: 1, f: 0.5, g: 0.25, h: 0.125 };
    const octMap = { q: -3, w: -2, e: -1, r: 0, t: 1, y: 2, u: 3 };
    const accMap = { z: 'bb', x: 'b', c: 'n', v: '#', b: '##' };

    if (durMap[lower] !== undefined) { ev.preventDefault(); setDuration(durMap[lower]); return; }
    if (octMap[lower] !== undefined) { ev.preventDefault(); setOctave(octMap[lower]); return; }
    if (accMap[lower] !== undefined) { ev.preventDefault(); setAccidental(accMap[lower]); return; }

    if (k === ' ') { ev.preventDefault(); togglePlay(); return; }
    if (k === 'ArrowLeft') { ev.preventDefault(); moveCursor(-1); return; }
    if (k === 'ArrowRight') { ev.preventDefault(); moveCursor(1); return; }
    if (k === 'ArrowUp') { ev.preventDefault(); moveMeasure(-1); return; }
    if (k === 'ArrowDown') { ev.preventDefault(); moveMeasure(1); return; }
    if (k === 'Backspace' || k === 'Delete') { ev.preventDefault(); deleteAtCursor(); return; }
    if (k === '.') { ev.preventDefault(); toggleDot(); return; }
    if (k === 'Insert') {
      ev.preventDefault();
      state.overwriteMode = !state.overwriteMode;
      flash(state.overwriteMode ? '覆盖模式：输入会替换光标处的音符' : '插入模式：输入会插入新音符，后面的音符往后挪');
      return;
    }
    if (k === 'Home') { ev.preventDefault(); state.cursor.t = 0; state.sel = null; updateCursorVisual(); updateStatus(); return; }
    if (k === 'End') { ev.preventDefault(); state.cursor.t = state.score.measures[state.cursor.m].tokens.length; state.sel = null; updateCursorVisual(); updateStatus(); return; }
  }

  /* ================= 导入导出 ================= */
  function exportJson() {
    const blob = new Blob([JSON.stringify(state.score, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (state.score.title || '工程') + '.ttc.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function importJson(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result));
        state.score = M.normalize(doc);
        state.projectId = null;
        state.cursor = { m: 0, t: 0 };
        state.sel = null;
        state.history = [JSON.stringify(state.score)];
        state.hIndex = 0;
        state.dirty = true;
        syncAllControls();
        render();
        saveProject(true);
        flash('工程已导入');
      } catch (e) {
        alert('导入失败：文件不是有效的工程 JSON');
      }
    };
    reader.readAsText(f);
    ev.target.value = '';
  }

  async function importMidi(ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (state.dirty && !confirm('导入 MIDI 会替换当前工程内容，确定继续吗？')) { ev.target.value = ''; return; }
    try {
      const r = await window.TT.MIDIImport.importFile(f, {
        title: f.name.replace(/\.(mid|midi)$/i, ''),
        key: state.score.key,
      });
      state.score = M.normalize(r.score);
      state.projectId = null;
      state.cursor = { m: 0, t: 0 };
      state.sel = null;
      state.history = [JSON.stringify(state.score)];
      state.hIndex = 0;
      state.dirty = true;
      syncAllControls();
      render();
      await saveProject(true);
      flash(`已从 MIDI 导入 ${r.noteCount} 个音符（第 ${r.trackIndex + 1} 轨）`);
    } catch (e) {
      alert('MIDI 导入失败：' + e.message);
    }
    ev.target.value = '';
  }

  async function deleteProject() {
    if (!state.projectId) { flash('这个工程还没保存过'); return; }
    if (!confirm('删除当前工程？此操作不可恢复。')) return;
    try {
      await api('/api/projects/' + state.projectId, { method: 'DELETE' });
    } catch (e) {
      if (needLogin(e)) return;
      flash('删除失败：' + e.message);
      return;
    }
    state.projectId = null;
    state.dirty = false;
    newProject();
  }

  /* ================= 启动 ================= */
  /** 登录成功后进入编辑器：拉取这个用户自己的作品列表 */
  async function enterApp(user) {
    currentUser = user || currentUser;
    state.user = currentUser;
    hideAuth();
    renderUserChip();
    el.saveState.textContent = '已登录';
    el.saveState.classList.remove('dirty');

    try {
      const r = await api('/api/projects');
      const list = r.projects || [];
      if (list.length) {
        const recent = (() => { try { return JSON.parse(localStorage.getItem('tt_recent') || '[]'); } catch (_) { return []; } })();
        const pick = recent.find((id) => list.some((p) => p.id === id)) || list[0].id;
        await loadProject(pick);
      } else {
        state.score = M.demoScore();
        state.projectId = null;
        state.sel = null;
        state.cursor = { m: 0, t: 0 };
        state.history = [JSON.stringify(state.score)];
        state.hIndex = 0;
        syncAllControls();
        render();
        await saveProject(true);
        flash('第一次使用：已为你准备了一首《小星星》示例，可以直接改成自己的谱子');
      }
    } catch (e) {
      if (needLogin(e)) return;
      state.score = M.demoScore();
      state.sel = null;
      state.cursor = { m: 0, t: 0 };
      state.history = [JSON.stringify(state.score)];
      state.hIndex = 0;
      syncAllControls();
      render();
      el.saveState.textContent = '离线编辑';
      flash('暂时连不上服务器，可以先编辑，恢复后点「保存」');
    }
    state.loaded = true;
  }

  async function boot() {
    initControls();
    bind();
    bindAuth();
    window.__tt = state; // 调试用：控制台可查看当前工程状态
    state.renderWidth = computeRenderWidth();

    // 先把登录界面亮出来，避免未登录的人看到编辑器一闪而过
    showAuth('login');

    try {
      const me = await api('/api/auth/me');
      await enterApp(me.user);
    } catch (e) {
      if (e.status === 401) {
        // 没登录 / 会话过期：停在登录界面，等用户注册或登录
        showAuth('login');
      } else {
        showAuth('login');
        setAuthError('连不上服务器：' + e.message + '。请确认容器是否在运行。');
      }
    }
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
