/* Vizzy Studio \u2013 UI / app logic */
(function () {
  'use strict';
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r2 = (v) => Math.round(v * 100) / 100;

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'style') e.style.cssText = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else if (k === 'value') e.value = v;
        else if (k === 'checked') e.checked = !!v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  const btn = (label, fn, cls) => h('button', { class: 'btn ' + (cls || ''), onclick: fn }, label);
  const fmtT = (t) => {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  };
  const baseName = (p) => String(p || '').split(/[\\/]/).pop();
  const extOf = (p) => (String(p).split('.').pop() || '').toLowerCase();
  const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', aiff: 'audio/aiff', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm' };
  const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aiff'];
  const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
  const VID_EXT = ['mp4', 'mov', 'm4v', 'webm'];

  /* ---------------- state ---------------- */
  function newProject() {
    return { name: 'Untitled project', aspect: '16:9', bgColor: '#0b0b14', audio: null, duration: 30, meta: { title: 'Song Title', artist: 'Artist Name' }, layers: VZ.TEMPLATE_LIST[0].build() };
  }
  const state = {
    project: newProject(), sel: null, playing: false, t: 0, wall0: 0, t0: 0,
    A: VZ.demoAnalysis(), audioEl: null, audioUrl: null, assets: {}, undo: [], redo: [],
    tap: null, analysis: null, clipboard: null, previewShort: 540, guides: false, dirty: true, exporting: false, sample: VZ.newSample(), projectPath: null,
  };
  let pps = 60; // timeline pixels per second

  const getDur = () => (state.A && !state.A.demo ? state.A.duration : state.project.duration || 30);
  const findLayer = (id) => state.project.layers.find((l) => l.id === id);
  const selLayer = () => (state.sel ? findLayer(state.sel) : null);
  const markDirty = () => { state.dirty = true; };
  const hooks = {};
  const hook = (n) => { if (hooks[n]) hooks[n](); else toast('Not available'); };

  function dimsFor(aspect, short) {
    const [a, b] = aspect.split(':').map(Number);
    let w, hh;
    if (a >= b) { hh = short; w = Math.round((short * a) / b); } else { w = short; hh = Math.round((short * b) / a); }
    return { w: w + (w % 2), h: hh + (hh % 2) };
  }

  /* ---------------- toast / modal ---------------- */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2800);
  }
  function openModal(...kids) {
    const card = $('#modal-card');
    card.className = 'modal-card'; card.replaceChildren(...kids.flat());
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal-card').replaceChildren(); }
  function progressModal(title, text) {
    const bar = h('i'), msg = h('div', { class: 'hint', style: 'margin:0' }, text || '');
    openModal(h('h2', null, title), h('div', { class: 'progress' }, bar), msg);
    return { set(p, t) { bar.style.width = clamp(p, 0, 1) * 100 + '%'; if (t != null) msg.textContent = t; }, close: closeModal };
  }

  /* ---------------- undo ---------------- */
  let lastUndoAt = 0, lastUndoKey = '';
  const snap = () => JSON.stringify(state.project);
  function commit(key) {
    const now = Date.now();
    if (key !== lastUndoKey || now - lastUndoAt > 800) {
      state.undo.push(snap());
      if (state.undo.length > 100) state.undo.shift();
      state.redo = [];
    }
    lastUndoKey = key; lastUndoAt = now; markDirty();
  }
  async function undo() {
    if (!state.undo.length) return;
    state.redo.push(snap());
    await applyProject(JSON.parse(state.undo.pop()));
  }
  async function redo() {
    if (!state.redo.length) return;
    state.undo.push(snap());
    await applyProject(JSON.parse(state.redo.pop()));
  }

  /* ---------------- assets ---------------- */
  async function loadAsset(path, kind) {
    if (state.assets[path]) return state.assets[path];
    const bytes = await api.readFile(path);
    const blob = new Blob([bytes], { type: MIME[extOf(path)] || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    let el;
    if (kind === 'video') {
      el = document.createElement('video');
      el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
      await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('Cannot decode video')); });
    } else {
      el = new Image(); el.src = url; await el.decode();
    }
    state.assets[path] = { el, kind, url };
    return state.assets[path];
  }
  async function ensureAssets() {
    for (const L of state.project.layers) {
      if (!L.src || !L.src.path || state.assets[L.src.path]) continue;
      const kind = VZ.isVideoLayer(L) ? 'video' : 'image';
      try { await loadAsset(L.src.path, kind); } catch (e) { toast('Missing file: ' + baseName(L.src.path)); }
    }
  }
  async function chooseAsset(L, f) {
    const kind = f.kind(L);
    const p = await api.openDialog({ filters: [{ name: kind === 'video' ? 'Video' : 'Images', extensions: kind === 'video' ? VID_EXT : IMG_EXT }] });
    if (!p) return;
    try { await loadAsset(p, kind); } catch (e) { return toast('Could not open that file'); }
    commit('asset' + L.id); L.src = { path: p, name: baseName(p) };
    markDirty(); renderInspector();
  }

  /* ---------------- audio ---------------- */
  function clearAudio() {
    if (state.audioEl) { state.audioEl.pause(); state.audioEl = null; }
    if (state.audioUrl) { URL.revokeObjectURL(state.audioUrl); state.audioUrl = null; }
    state.A = VZ.demoAnalysis(); state.analysis = null;
  }
  async function loadAudio(path) {
    const pm = progressModal('Analyzing audio', 'Reading ' + baseName(path) + '\u2026');
    try {
      const bytes = await api.readFile(path);
      pm.set(0.05, 'Decoding\u2026');
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buf = await ac.decodeAudioData(ab);
      ac.close();
      const n = buf.length, mono = new Float32Array(n), chs = buf.numberOfChannels;
      for (let c = 0; c < chs; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / chs; }
      const A = await VZ.analyze(mono, buf.sampleRate, (p) => pm.set(0.1 + p * 0.9, 'Analyzing spectrum\u2026 ' + Math.round(p * 100) + '%'));
      if (state.audioEl) state.audioEl.pause();
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = URL.createObjectURL(new Blob([bytes], { type: MIME[extOf(path)] || 'audio/mpeg' }));
      state.audioEl = new Audio(state.audioUrl);
      state.audioEl.volume = +$('#volume').value;
      state.audioEl.preload = 'auto';
      state.A = A;
      state.project.audio = { path, name: baseName(path) };
      state.project.duration = A.duration;
      state.t = 0; state.playing = false; state.analysis = null;
      pm.close();
      fitTimeline(); refreshAll();
      runDeepAnalysis();
    } catch (e) {
      pm.close();
      openModal(h('h2', null, 'Could not load audio'), h('div', { class: 'err' }, String(e && e.message ? e.message : e)), h('div', { class: 'modal-actions' }, btn('Close', closeModal)));
    }
  }
  let analysisJob = 0;
  async function runDeepAnalysis() {
    const A = state.A, job = ++analysisJob;
    if (!A || A.demo || !A.mono) return;
    try {
      const r = await VZ.deepAnalyze(A);
      if (job !== analysisJob || A !== state.A) return;
      state.analysis = r; drawTimeline(); if (!selLayer()) renderInspector();
    } catch (e) { console.error('analysis failed', e); }
  }
  async function pickAudio() {
    const p = await api.openDialog({ filters: [{ name: 'Audio', extensions: AUDIO_EXT }] });
    if (p) { commit('audio'); await loadAudio(p); }
  }

  /* ---------------- transport ---------------- */
  function getTime() {
    if (!state.playing) return state.t;
    if (state.audioEl) return state.audioEl.currentTime;
    return state.t0 + (performance.now() - state.wall0) / 1000;
  }
  function play() {
    const d = getDur();
    if (state.t >= d - 0.05) state.t = 0;
    state.playing = true;
    if (state.audioEl) { state.audioEl.currentTime = state.t; state.audioEl.play().catch(() => {}); }
    else { state.t0 = state.t; state.wall0 = performance.now(); }
    $('#btn-play').textContent = '\u275a\u275a';
  }
  function pause() {
    if (state.playing) state.t = getTime();
    state.playing = false;
    if (state.audioEl) state.audioEl.pause();
    $('#btn-play').textContent = '\u25b6';
    markDirty();
  }
  function seek(t) {
    t = clamp(t, 0, getDur());
    state.t = t;
    if (state.audioEl) state.audioEl.currentTime = t;
    if (state.playing && !state.audioEl) { state.t0 = t; state.wall0 = performance.now(); }
    markDirty();
  }
  const togglePlay = () => (state.playing ? pause() : play());

  /* ---------------- project apply ---------------- */
  async function applyProject(obj) {
    const prevAudio = state.project.audio && state.project.audio.path;
    for (const L of obj.layers) { const T = VZ.TYPES[L.type]; if (T) Object.assign(L, Object.assign(T.defaults(), L)); }
    obj.layers = obj.layers.filter((L) => VZ.TYPES[L.type]);
    obj.meta = Object.assign({ title: 'Song Title', artist: 'Artist Name' }, obj.meta || {});
    state.project = obj;
    if (state.sel && !findLayer(state.sel)) state.sel = null;
    $('#project-name').value = obj.name; $('#aspect').value = obj.aspect;
    if (hooks.loadFonts) { try { await hooks.loadFonts(obj.fonts); } catch (e) { /* ignore */ } }
    await ensureAssets();
    const newAudio = obj.audio && obj.audio.path;
    if (newAudio !== prevAudio) {
      if (newAudio) { try { await loadAudio(newAudio); } catch (e) { /* shown in loadAudio */ } } else clearAudio();
    }
    refreshAll();
  }
  async function newProj() {
    if (!(await api.confirm('Start a new project? Unsaved changes will be lost.'))) return;
    state.undo = []; state.redo = []; state.projectPath = null; state.sel = null;
    clearAudio(); state.t = 0; state.playing = false;
    state.project = newProject();
    await applyProject(state.project);
  }
  async function saveProject() {
    let p = state.projectPath;
    if (!p) p = await api.saveDialog({ defaultPath: (state.project.name || 'project') + '.vizzy', filters: [{ name: 'Vizzy project', extensions: ['vizzy'] }] });
    if (!p) return;
    try { await api.writeText(p, JSON.stringify(state.project, null, 1)); state.projectPath = p; toast('Saved ' + baseName(p)); } catch (e) { toast('Save failed: ' + e.message); }
  }
  async function openProject() {
    const p = await api.openDialog({ filters: [{ name: 'Vizzy project', extensions: ['vizzy', 'json'] }] });
    if (!p) return;
    try {
      const obj = JSON.parse(await api.readText(p));
      if (!obj || !Array.isArray(obj.layers)) throw new Error('Not a Vizzy project');
      state.undo = []; state.redo = []; state.projectPath = p;
      obj.audio = obj.audio || null; obj.duration = obj.duration || 30; obj.aspect = obj.aspect || '16:9'; obj.bgColor = obj.bgColor || '#0b0b14';
      state.project.audio = null; clearAudio();
      await applyProject(obj);
      if (!obj.audio) state.analysis = null;
      toast('Opened ' + baseName(p));
    } catch (e) { toast('Could not open: ' + e.message, 4000); }
  }

  /* ---------------- layers ---------------- */
  async function addLayer(type) {
    let over = {};
    if (type === 'image') {
      const p = await api.openDialog({ filters: [{ name: 'Images', extensions: IMG_EXT }] });
      if (!p) return;
      try { await loadAsset(p, 'image'); } catch (e) { return toast('Could not open that image'); }
      over = { src: { path: p, name: baseName(p) }, name: baseName(p) };
    }
    commit('add');
    const L = VZ.newLayer(type, over);
    state.project.layers.push(L);
    state.sel = L.id;
    refreshAll();
  }
  function deleteLayer(id) {
    const Ld = findLayer(id); if (Ld && Ld.locked) return toast('Layer is locked');
    commit('del');
    state.project.layers = state.project.layers.filter((l) => l.id !== id);
    if (state.sel === id) state.sel = null;
    refreshAll();
  }
  function duplicateLayer(id) {
    const i = state.project.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    commit('dup');
    const c = JSON.parse(JSON.stringify(state.project.layers[i]));
    c.id = VZ.uid(); c.name += ' copy';
    state.project.layers.splice(i + 1, 0, c);
    state.sel = c.id; refreshAll();
  }
  function moveLayer(id, dir) { // dir +1 = toward front
    const a = state.project.layers, i = a.findIndex((l) => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= a.length) return;
    commit('move');
    [a[i], a[j]] = [a[j], a[i]];
    refreshAll();
  }
  function selectLayer(id) {
    state.sel = id;
    renderLayers(); renderInspector(); markSelClip();
  }

  function renderAddGrid() {
    const g = $('#add-grid'); g.replaceChildren();
    for (const type of ['visualizer', 'text', 'lyrics', 'image', 'video', 'shape', 'particles', 'effect', 'background']) {
      const T = VZ.TYPES[type];
      g.append(h('button', { class: 'btn', onclick: () => addLayer(type) }, h('span', { class: 'ic' }, T.icon), T.label.replace(' / Logo', '')));
    }
  }
  function renderLayers() {
    const box = $('#layer-list'); box.replaceChildren();
    const arr = state.project.layers;
    for (let i = arr.length - 1; i >= 0; i--) {
      const L = arr[i], T = VZ.TYPES[L.type];
      box.append(h('div', { class: 'layer' + (L.id === state.sel ? ' sel' : '') + (L.visible ? '' : ' off'), onclick: () => selectLayer(L.id) },
        h('span', { class: 'ic' }, T.icon),
        h('span', { class: 'nm' }, L.name),
        h('button', { class: 'mini', title: 'Lock / unlock', onclick: (e) => { e.stopPropagation(); L.locked = !L.locked; renderLayers(); } }, L.locked ? '\ud83d\udd12' : '\u25cb'),
        h('button', { class: 'mini', title: 'Show / hide', onclick: (e) => { e.stopPropagation(); commit('vis'); L.visible = !L.visible; refreshAll(); } }, L.visible ? '\ud83d\udc41' : '\u2715'),
        h('button', { class: 'mini', title: 'Move forward', onclick: (e) => { e.stopPropagation(); moveLayer(L.id, 1); } }, '\u25b2'),
        h('button', { class: 'mini', title: 'Move back', onclick: (e) => { e.stopPropagation(); moveLayer(L.id, -1); } }, '\u25bc'),
        h('button', { class: 'mini', title: 'Duplicate', onclick: (e) => { e.stopPropagation(); duplicateLayer(L.id); } }, '\u29c9'),
        h('button', { class: 'mini', title: 'Delete', onclick: (e) => { e.stopPropagation(); deleteLayer(L.id); } }, '\ud83d\uddd1')));
    }
  }

  /* ---------------- inspector ---------------- */
  function setVal(L, f, v) {
    commit('f' + L.id + f.key);
    L[f.key] = v;
    if (f.onChange) f.onChange(L);
    markDirty();
    if (f.key === 'start' || f.key === 'end') drawTimeline();
  }
  function fieldEl(L, f) {
    const val = L[f.key];
    const row = h('div', { class: 'field' + (f.type === 'textarea' ? ' block' : '') }, h('label', null, f.label));
    const ctl = h('div', { class: 'ctl' });
    row.append(ctl);
    switch (f.type) {
      case 'range': {
        const r = h('input', { type: 'range', min: f.min, max: f.max, step: f.step }); r.value = val;
        const n = h('input', { type: 'number', min: f.min, max: f.max, step: f.step }); n.value = r2(val);
        r.oninput = () => { const v = +r.value; n.value = r2(v); setVal(L, f, v); };
        n.onchange = () => { let v = parseFloat(n.value); if (isNaN(v)) v = f.min; r.value = v; setVal(L, f, v); };
        ctl.append(r, n); break;
      }
      case 'number': {
        const n = h('input', { type: 'number', min: f.min, step: f.step, placeholder: f.placeholder || '' });
        n.value = val == null ? '' : r2(val);
        n.onchange = () => {
          if (n.value === '' && f.nullable) return setVal(L, f, null);
          let v = parseFloat(n.value); if (isNaN(v)) v = f.min || 0;
          setVal(L, f, v);
        };
        n.style.width = '100%'; ctl.append(n); break;
      }
      case 'select': {
        const opts = typeof f.options === 'function' ? f.options() : f.options;
        const s = h('select', null, opts.map((o) => h('option', { value: o[0] }, o[1])));
        s.value = String(val);
        s.onchange = () => {
          const o = opts.find((x) => String(x[0]) === s.value);
          setVal(L, f, o && typeof o[0] === 'number' ? Number(s.value) : s.value);
          renderInspector();
        };
        ctl.append(s); break;
      }
      case 'checkbox': {
        const c = h('input', { type: 'checkbox', checked: !!val });
        c.onchange = () => { setVal(L, f, c.checked); renderInspector(); };
        ctl.append(c); break;
      }
      case 'color': {
        const c = h('input', { type: 'color', value: val || '#ffffff' });
        c.oninput = () => setVal(L, f, c.value);
        ctl.append(c); break;
      }
      case 'textarea': {
        const t = h('textarea'); t.value = val || '';
        t.oninput = () => setVal(L, f, t.value);
        row.replaceChildren(h('label', null, f.label), t); break;
      }
      case 'asset': {
        ctl.append(h('span', { class: 'file-name' }, val && val.name ? val.name : 'No file'), btn('Choose\u2026', () => chooseAsset(L, f), 'small'));
        if (val) ctl.append(btn('\u2715', () => { commit('asset' + L.id); L.src = null; markDirty(); renderInspector(); }, 'small'));
        break;
      }
    }
    return row;
  }
  function renderInspector() {
    const box = $('#inspector'); box.replaceChildren();
    const L = selLayer();
    if (!L) {
      $('#inspector-title').textContent = 'Project';
      const P = state.project;
      box.append(h('div', { class: 'group-title' }, 'Project'));
      const nm = h('input', { type: 'text', value: P.name }); nm.oninput = () => { P.name = nm.value; $('#project-name').value = nm.value; };
      const row = (l, c) => h('div', { class: 'field' }, h('label', null, l), h('div', { class: 'ctl' }, c));
      box.append(row('Name', nm));
      const bc = h('input', { type: 'color', value: P.bgColor }); bc.oninput = () => { commit('bgc'); P.bgColor = bc.value; };
      box.append(row('Base color', bc));
      const tt = h('input', { type: 'text', value: P.meta.title }); tt.oninput = () => { commit('mt'); P.meta.title = tt.value; markDirty(); };
      const ar = h('input', { type: 'text', value: P.meta.artist }); ar.oninput = () => { commit('ma'); P.meta.artist = ar.value; markDirty(); };
      box.append(h('div', { class: 'group-title' }, 'Song info  (fills {title} / {artist} in text layers)'), row('Title', tt), row('Artist', ar));
      box.append(h('div', { class: 'group-title' }, 'Audio'));
      box.append(row('Song', [h('span', { class: 'file-name' }, P.audio ? P.audio.name : 'None (demo animation)'), btn(P.audio ? 'Change…' : 'Load…', pickAudio, 'small')]));
      if (!P.audio) {
        const d = h('input', { type: 'number', min: 1, step: 1, value: P.duration });
        d.onchange = () => { commit('dur'); P.duration = clamp(parseFloat(d.value) || 30, 1, 3600); drawTimeline(); };
        box.append(row('Video length (s)', d));
      } else {
        box.append(row('Length', fmtT(P.duration)));
        const an = state.analysis;
        if (an) {
          box.append(row('Tempo', Math.round(an.bpm) + ' BPM'), row('Key', an.key), row('Loudness', Math.round(an.loudness.rmsDb) + ' dBFS RMS · peak ' + Math.round(an.loudness.peakDb) + ' dB' + (an.loudness.clipping ? ' (clipping!)' : '')));
        } else box.append(h('div', { class: 'hint', style: 'margin:4px 0' }, 'Analyzing tempo, key and structure…'));
      }
      box.append(h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:12px' },
        btn('✨ Magic Video', () => hook('magic'), 'small primary'), btn('🤖 AI Lyrics', () => hook('ai'), 'small'), btn('📊 Audio analysis', () => hook('analysis'), 'small'), btn('🎨 Palette from image', () => hook('palette'), 'small'), btn('Aa Import font', () => hook('font'), 'small')));
      box.append(h('div', { class: 'empty-note' }, 'Select a layer on the left to edit it. Drag on the preview to move the selected layer.'));
      return;
    }
    const T = VZ.TYPES[L.type];
    $('#inspector-title').textContent = T.label;
    const nm = h('input', { type: 'text', value: L.name });
    nm.oninput = () => { commit('nm' + L.id); L.name = nm.value; const el = document.querySelector('.layer.sel .nm'); if (el) el.textContent = L.name; drawTimeline(); };
    box.append(h('div', { class: 'field', style: 'margin-top:10px' }, h('label', null, 'Layer name'), h('div', { class: 'ctl' }, nm)));
    let lastGroup = null;
    for (const f of T.fields) {
      if (f.show && !f.show(L)) continue;
      if (f.group && f.group !== lastGroup) { box.append(h('div', { class: 'group-title' }, f.group)); lastGroup = f.group; }
      box.append(fieldEl(L, f));
    }
    if (T.lyrics) box.append(lyricsEditor(L));
  }

  /* ---------------- lyrics ---------------- */
  function distribute(L, texts) {
    const d = getDur(), n = texts.length, step = d / (n + 1);
    L.lines = texts.map((tx, i) => ({ t0: r2(step * (i + 0.5)), t1: null, text: tx }));
  }
  function pasteLyrics(L) {
    const ta = h('textarea', { style: 'min-height:220px' });
    ta.placeholder = 'One lyric line per row\u2026';
    ta.value = (L.lines || []).map((l) => l.text).join('\n');
    openModal(h('h2', null, 'Paste lyrics'), h('div', { class: 'hint', style: 'margin:0 0 8px' }, 'One line per row. Then use \u201cTap to sync\u201d to time them to the song.'), ta,
      h('div', { class: 'modal-actions' }, btn('Cancel', closeModal), btn('Apply', () => {
        const texts = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (texts.length) {
          commit('lyr');
          const old = L.lines || [];
          if (old.length === texts.length) texts.forEach((tx, i) => { old[i].text = tx; });
          else distribute(L, texts);
        }
        closeModal(); renderInspector(); markDirty();
      }, 'primary')));
    setTimeout(() => ta.focus(), 30);
  }
  async function importLyrics(L) {
    const p = await api.openDialog({ filters: [{ name: 'Lyrics / subtitles', extensions: ['lrc', 'srt', 'vtt', 'txt'] }] });
    if (!p) return;
    const text = await api.readText(p);
    let lines = VZ.parseLyricsFile(text, p, 0);
    commit('lyr');
    if (lines.length) L.lines = lines;
    else {
      const texts = text.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!texts.length) return toast('No lyrics found in that file');
      distribute(L, texts); toast('No timestamps found \u2013 lines spread evenly. Use Tap to sync.', 4000);
    }
    renderInspector(); markDirty();
  }
  function startTap(L) {
    if (!L.lines || !L.lines.length) return toast('Paste or import lyrics first');
    state.tap = { id: L.id, idx: 0 };
    seek(0); play(); renderInspector();
  }
  function tapNow() {
    const tp = state.tap; if (!tp) return;
    const L = findLayer(tp.id); if (!L) { state.tap = null; return; }
    commit('tap');
    L.lines[tp.idx].t0 = Math.max(0, r2(getTime() - 0.12));
    tp.idx++;
    if (tp.idx >= L.lines.length) { stopTap(); toast('All lines timed \u2714'); } else renderInspector();
    markDirty();
  }
  function stopTap() {
    const tp = state.tap; state.tap = null;
    if (tp) { const L = findLayer(tp.id); if (L) L.lines.sort((a, b) => a.t0 - b.t0); }
    renderInspector(); markDirty();
  }
  function lyricsEditor(L) {
    if (!L.lines) L.lines = [];
    const box = h('div');
    box.append(h('div', { class: 'group-title' }, 'Lyrics lines (' + L.lines.length + ')'));
    box.append(h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
      btn('Paste text\u2026', () => pasteLyrics(L), 'small'), btn('Import .lrc / .srt', () => importLyrics(L), 'small'),
      btn('Tap to sync', () => startTap(L), 'small primary'),
      btn('+ Line', () => { commit('lyr'); L.lines.push({ t0: r2(getTime()), t1: null, text: 'New line' }); L.lines.sort((a, b) => a.t0 - b.t0); renderInspector(); }, 'small'),
      btn('Clear', () => { commit('lyr'); L.lines = []; renderInspector(); }, 'small danger')));
    box.append(h('div', { style: 'display:flex;gap:4px;align-items:center;margin:8px 0' }, h('span', { class: 'hint', style: 'margin:0 4px 0 0' }, 'Shift all:'),
      ...[-0.5, -0.1, 0.1, 0.5].map((d) => btn((d > 0 ? '+' : '') + d + 's', () => { commit('lyr'); L.lines.forEach((l) => { l.t0 = Math.max(0, r2(l.t0 + d)); }); renderInspector(); }, 'small'))));
    const tp = state.tap && state.tap.id === L.id ? state.tap : null;
    if (tp) {
      const nxt = L.lines[tp.idx];
      box.append(h('div', { class: 'tap-box' },
        h('div', null, 'Press ', h('b', null, 'Space'), ' (or the button) right when this line starts:'),
        h('div', { style: 'font-size:15px;margin:6px 0;font-weight:600;user-select:text' }, '\u201c' + (nxt ? nxt.text : '') + '\u201d'),
        h('div', { style: 'display:flex;gap:6px' }, btn('TAP  \u23ce', tapNow, 'primary'), btn('Back', () => { if (tp.idx > 0) tp.idx--; renderInspector(); }, 'small'), btn('Stop', stopTap, 'small'))));
    }
    const list = h('div', { class: 'lyric-list' });
    L.lines.forEach((ln, i) => {
      const t0 = h('input', { type: 'number', step: 0.1, min: 0 }); t0.value = r2(ln.t0);
      t0.onchange = () => { commit('lyr'); ln.t0 = Math.max(0, parseFloat(t0.value) || 0); L.lines.sort((a, b) => a.t0 - b.t0); renderInspector(); };
      const tx = h('input', { class: 'txt', type: 'text' }); tx.value = ln.text;
      tx.oninput = () => { commit('lt' + L.id + i); ln.text = tx.value; markDirty(); };
      list.append(h('div', { class: 'lyric-row' + (tp && tp.idx === i ? ' cur' : '') }, t0, tx,
        h('button', { class: 'mini btn small', title: 'Set to playhead time', onclick: () => { commit('lyr'); ln.t0 = r2(getTime()); L.lines.sort((a, b) => a.t0 - b.t0); renderInspector(); } }, '\u23f1'),
        h('button', { class: 'mini btn small', title: 'Delete line', onclick: () => { commit('lyr'); L.lines.splice(i, 1); renderInspector(); } }, '\u2715')));
    });
    box.append(list);
    return box;
  }

  /* ---------------- timeline ---------------- */
  function fitTimeline() {
    const w = $('#tl-scroll').clientWidth - 70, d = getDur();
    const v = clamp(Math.floor(w / Math.max(1, d)), 5, 300);
    $('#tl-zoom').value = v; pps = v;
  }
  function drawTimeline() {
    const d = getDur();
    pps = Math.min(+$('#tl-zoom').value, 30000 / Math.max(1, d));
    const W = Math.ceil(d * pps), inner = $('#tl-inner');
    inner.style.width = W + 60 + 'px';
    const cv = $('#tl-wave'); cv.width = W; cv.style.width = W + 'px';
    const g = cv.getContext('2d'), H = cv.height;
    g.fillStyle = '#120d24'; g.fillRect(0, 0, W, H);
    // waveform
    const A = state.A;
    if (A && A.mono) {
      const sr = A.sr, mono = A.mono, top = 20, hh = H - top - 2, mid = top + hh / 2;
      g.fillStyle = '#6d56d9';
      for (let x = 0; x < W; x++) {
        const i0 = Math.floor((x / pps) * sr), i1 = Math.min(mono.length, Math.floor(((x + 1) / pps) * sr));
        const step = Math.max(1, Math.floor((i1 - i0) / 48));
        let mn = 0, mx = 0;
        for (let i = i0; i < i1; i += step) { const v = mono[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        const y0 = mid - Math.min(1, mx * 1.6) * (hh / 2), y1 = mid - Math.max(-1, mn * 1.6) * (hh / 2);
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }
    }
    // beat grid + sections from the audio analysis
    const an = state.analysis;
    if (an && an.grid && pps * (60 / Math.max(1, an.bpm)) >= 5) {
      an.grid.forEach((bt, bi) => { g.fillStyle = bi % 4 === 0 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)'; g.fillRect(Math.round(bt * pps), 18, 1, H - 18); });
    }
    // ruler
    g.fillStyle = '#171229'; g.fillRect(0, 0, W, 18);
    if (an && an.sections) an.sections.forEach((sc, si) => {
      const x0 = Math.round(sc.t0 * pps), x1 = Math.round(sc.t1 * pps);
      g.fillStyle = /Chorus/.test(sc.label) ? 'rgba(236,72,153,.35)' : /Intro|Outro/.test(sc.label) ? 'rgba(56,189,248,.28)' : 'rgba(124,92,255,.28)';
      g.fillRect(x0, 0, Math.max(1, x1 - x0 - 1), 9);
      g.fillStyle = '#e9e6f7'; g.font = '8px Menlo, monospace'; g.textBaseline = 'middle';
      if (x1 - x0 > 50) g.fillText(sc.label, x0 + 4, 5);
    });
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
    let iv = steps.find((s) => s * pps >= 70) || 300;
    g.fillStyle = '#9a93bd'; g.font = '10px Menlo, monospace'; g.textBaseline = 'middle';
    for (let t = 0; t <= d; t += iv) {
      const x = Math.round(t * pps);
      g.fillRect(x, 10, 1, 8);
      g.fillText(Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'), x + 3, an && an.sections ? 14 : 8);
    }
    // rows
    const rows = $('#tl-rows'); rows.replaceChildren();
    const arr = state.project.layers;
    for (let i = arr.length - 1; i >= 0; i--) {
      const L = arr[i], s = L.start || 0, e = L.end == null ? d : Math.min(L.end, d);
      const clip = h('div', { class: 'clip' + (L.id === state.sel ? ' sel' : '') + (L.visible ? '' : ' off'), 'data-id': L.id, style: 'left:' + s * pps + 'px;width:' + Math.max(8, (e - s) * pps) + 'px', title: L.name },
        h('span', { class: 'h l' }), L.name, h('span', { class: 'h r' }));
      clip.addEventListener('mousedown', (ev) => clipDrag(ev, L, clip));
      rows.append(h('div', { class: 'tl-row' }, clip));
    }
    updatePlayhead();
  }
  function markSelClip() { document.querySelectorAll('.clip').forEach((c) => c.classList.toggle('sel', c.dataset.id === state.sel)); }
  function updatePlayhead() { $('#tl-playhead').style.left = Math.round(getTime() * pps) + 'px'; }
  function clipDrag(ev, L, clip) {
    ev.preventDefault();
    if (state.sel !== L.id) selectLayer(L.id);
    const mode = ev.target.classList.contains('l') ? 'l' : ev.target.classList.contains('r') ? 'r' : 'm';
    const d = getDur(), x0 = ev.clientX, s0 = L.start || 0, e0 = L.end == null ? d : L.end;
    commit('clip' + Date.now());
    const move = (e) => {
      const dt = (e.clientX - x0) / pps;
      let s = s0, en = e0;
      if (mode === 'l') s = clamp(s0 + dt, 0, e0 - 0.2);
      else if (mode === 'r') en = clamp(e0 + dt, s0 + 0.2, d);
      else { const len = e0 - s0; s = clamp(s0 + dt, 0, d - len); en = s + len; }
      L.start = r2(s); L.end = en >= d - 0.05 ? null : r2(en);
      clip.style.left = L.start * pps + 'px';
      clip.style.width = Math.max(8, ((L.end == null ? d : L.end) - L.start) * pps) + 'px';
      markDirty();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); renderInspector(); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }
  function waveScrub(ev) {
    const cv = $('#tl-wave');
    const at = (e) => seek((e.clientX - cv.getBoundingClientRect().left) / pps);
    at(ev);
    const move = (e) => at(e), up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }

  /* ---------------- preview ---------------- */
  const pcv = () => $('#preview');
  function fitStage() {
    const st = $('#stage'), c = pcv();
    const { w, h: hh } = dimsFor(state.project.aspect, state.previewShort);
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    const aw = st.clientWidth - 28, ah = st.clientHeight - 28, s = Math.max(0.1, Math.min(aw / w, ah / hh));
    c.style.width = Math.floor(w * s) + 'px'; c.style.height = Math.floor(hh * s) + 'px';
    drawGuides(); markDirty();
  }
  function drawGuides() {
    const o = $('#overlay'), c = pcv(); if (!o) return;
    o.width = c.clientWidth; o.height = c.clientHeight; o.style.width = c.clientWidth + 'px'; o.style.height = c.clientHeight + 'px';
    const g = o.getContext('2d'); g.clearRect(0, 0, o.width, o.height);
    if (!state.guides) return;
    const W = o.width, H = o.height;
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(W / 3, 0); g.lineTo(W / 3, H); g.moveTo((2 * W) / 3, 0); g.lineTo((2 * W) / 3, H); g.moveTo(0, H / 3); g.lineTo(W, H / 3); g.moveTo(0, (2 * H) / 3); g.lineTo(W, (2 * H) / 3); g.stroke();
    g.strokeStyle = 'rgba(56,189,248,.8)'; g.setLineDash([]);
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.strokeStyle = 'rgba(250,204,21,.8)'; g.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    g.strokeStyle = 'rgba(244,114,182,.8)'; g.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
  }
  const previewEnv = VZ.createEnv((p) => (state.assets[p] ? state.assets[p].el : null));

  function syncVideos(t) {
    for (const L of state.project.layers) {
      if (!VZ.isVideoLayer(L) || !L.src || !L.visible) continue;
      const a = state.assets[L.src.path]; if (!a) continue;
      const v = a.el, want = VZ.videoTimeFor(L, t, v.duration);
      if (state.playing) {
        if (v.paused) v.play().catch(() => {});
        if (Math.abs(v.currentTime - want) > 0.4) v.currentTime = want;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
      }
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    if (state.exporting) return;
    let t = getTime();
    if (state.playing && t >= getDur() - 0.02) { if (state.loop && !state.tap) { seek(0); t = 0; } else { t = getDur(); pause(); state.t = t; if (state.tap) stopTap(); } }
    const live = state.playing || state.A.demo;
    if (live || state.dirty) {
      state.dirty = false;
      const c = pcv(), ts = state.A.demo && !state.playing ? performance.now() / 1000 : t;
      state.A.sample(ts, state.sample);
      syncVideos(t);
      VZ.renderFrame(c.getContext('2d'), c.width, c.height, t, state.project, state.sample, previewEnv);
    }
    $('#time-label').textContent = fmtT(t) + ' / ' + fmtT(getDur());
    if (!seeking) $('#seek').value = (t / Math.max(0.001, getDur())) * 1000;
    updatePlayhead();
    if (state.playing) { // keep playhead visible
      const sc = $('#tl-scroll'), x = t * pps;
      if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 80);
    }
  }
  let seeking = false;

  function setupPreviewDrag() {
    const c = pcv();
    c.addEventListener('mousedown', (ev) => {
      const L = selLayer();
      if (!L || L.locked || VZ.TYPES[L.type].noTransform) return;
      ev.preventDefault();
      const rc = c.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY, lx = L.x, ly = L.y;
      commit('drag' + Date.now());
      const move = (e) => { L.x = r2(lx + (e.clientX - x0) / rc.width); L.y = r2(ly + (e.clientY - y0) / rc.height); markDirty(); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); renderInspector(); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
  }

  /* ---------------- export ---------------- */
  const tick = () => new Promise((r) => setTimeout(r, 0));
  async function seekVideosForExport(t) {
    for (const L of state.project.layers) {
      if (!VZ.isVideoLayer(L) || !L.src || !L.visible) continue;
      const a = state.assets[L.src.path]; if (!a) continue;
      const v = a.el; if (!v.paused) v.pause();
      const want = VZ.videoTimeFor(L, t, v.duration);
      if (Math.abs(v.currentTime - want) > 0.001) {
        await new Promise((res) => { const to = setTimeout(res, 800); v.onseeked = () => { clearTimeout(to); res(); }; v.currentTime = want; });
      }
    }
  }
  const ASPECTS = [['16:9', '16:9 YouTube'], ['9:16', '9:16 Shorts / Reels'], ['1:1', '1:1 Square'], ['4:5', '4:5 Instagram'], ['4:3', '4:3'], ['21:9', '21:9 Cinema']];
  let caps = null;
  async function exportDialog() {
    const P = state.project, d = getDur();
    if (!(d > 0)) return toast('Nothing to export');
    if (state.playing) pause();
    if (!caps) { try { caps = await api.exportCaps(); } catch (e) { caps = { ok: true, h264: true }; } }
    const sel = (opts, def) => { const s = h('select', null, opts.map((o) => h('option', { value: o[0] }, o[1]))); s.value = def; return s; };
    const sRes = sel([[480, '480p'], [720, '720p'], [1080, '1080p (Full HD)'], [1440, '1440p (2K)'], [2160, '2160p (4K)']], 1080);
    const sFps = sel([[24, '24 fps'], [25, '25 fps'], [30, '30 fps'], [48, '48 fps'], [60, '60 fps']], 30);
    const codecs = [['h264', 'H.264 / MP4 (works everywhere)']];
    if (caps && caps.h265) codecs.push(['h265', 'H.265 HEVC / MP4 (smaller files)']);
    if (caps && caps.prores) codecs.push(['prores', 'Apple ProRes 422 / MOV (editing)']);
    const sCodec = sel(codecs, 'h264');
    const sQ = sel([['fast', 'Fast (smaller file)'], ['balanced', 'Balanced'], ['high', 'High quality']], 'balanced');
    const sEnc = sel([['software', 'Software (best quality)'], ['hardware', 'Hardware VideoToolbox (faster)']], 'software');
    const from = h('input', { type: 'number', min: 0, step: 0.1, value: 0 }), to = h('input', { type: 'number', min: 0.1, step: 0.1, value: r2(d) });
    const norm = h('input', { type: 'checkbox' }), fin = h('input', { type: 'number', min: 0, step: 0.5, value: 0 }), fout = h('input', { type: 'number', min: 0, step: 0.5, value: 0 });
    const asp = ASPECTS.map((a) => { const c = h('input', { type: 'checkbox', checked: a[0] === P.aspect }); c.value = a[0]; return c; });
    const info = h('div', { class: 'hint', style: 'margin:10px 0 0' });
    const rng = () => { const a = clamp(parseFloat(from.value) || 0, 0, d - 0.1), b = clamp(parseFloat(to.value) || d, a + 0.1, d); return [a, b]; };
    const upd = () => {
      const [a, b] = rng(), { w, h: hh } = dimsFor(P.aspect, +sRes.value);
      info.textContent = w + ' × ' + hh + ' · ' + fmtT(b - a) + ' · ' + Math.ceil((b - a) * +sFps.value) + ' frames' + (P.audio ? '' : ' · no audio (silent video)');
    };
    [sRes, sFps, from, to].forEach((x) => (x.onchange = upd)); upd();
    const row = (l, c) => h('div', { class: 'field' }, h('label', null, l), h('div', { class: 'ctl' }, c));
    const go = () => {
      const [a, b] = rng();
      const aspects = ASPECTS.map((x) => x[0]).filter((x, i) => asp[i].checked);
      runExport({ short: +sRes.value, fps: +sFps.value, quality: sQ.value, encoder: sEnc.value, codec: sCodec.value, from: a, to: b, normalize: norm.checked, fadeIn: +fin.value || 0, fadeOut: +fout.value || 0, aspects: aspects.length ? aspects : [P.aspect] });
    };
    openModal(h('h2', null, 'Export video'), row('Resolution', sRes), row('Frame rate', sFps), row('Format', sCodec), row('Quality', sQ), row('Encoder', sEnc),
      h('div', { class: 'group-title' }, 'Range (seconds)'), row('From / to', [from, to]),
      h('div', { class: 'group-title' }, 'Audio'), row('Normalize loudness', [norm, h('span', { class: 'hint' }, 'streaming level (-14 LUFS)')]), row('Fade in / out (s)', [fin, fout]),
      h('div', { class: 'group-title' }, 'Aspect ratios to render'),
      h('div', { class: 'aspects' }, ASPECTS.map((a, i) => h('label', { class: 'chk' }, asp[i], ' ' + a[1]))), info,
      h('div', { class: 'modal-actions' }, btn('Cancel', closeModal), btn('Choose file & export', go, 'primary')));
    $('#modal-card').classList.add('wide');
  }
  function audioFilterFor(o, len) {
    const f = [];
    if (o.normalize) f.push('loudnorm=I=-14:TP=-1.5:LRA=11');
    if (o.fadeIn > 0) f.push('afade=t=in:st=0:d=' + o.fadeIn);
    if (o.fadeOut > 0) f.push('afade=t=out:st=' + Math.max(0, len - o.fadeOut).toFixed(3) + ':d=' + o.fadeOut);
    return f.join(',') || null;
  }
  async function renderOne(o, aspect, out, ui) {
    const P = state.project, len = o.to - o.from, { w, h: hh } = dimsFor(aspect, o.short);
    const start = await api.exportStart({ outPath: out, w, h: hh, fps: o.fps, quality: o.quality, encoder: o.encoder, codec: o.codec, audioPath: P.audio ? P.audio.path : null, startAt: o.from, audioFilter: audioFilterFor(o, len), duration: len });
    if (!start.ok) return { error: start.error };
    if (start.note) ui.note(start.note);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const env = VZ.createEnv((p) => (state.assets[p] ? state.assets[p].el : null));
    const proj = Object.assign({}, P, { aspect });
    const S = VZ.newSample(), total = Math.ceil(len * o.fps), t0 = performance.now();
    let pending = null, failure = null;
    try {
      for (let i = 0; i < total && !ui.cancelled(); i++) {
        const t = o.from + i / o.fps;
        state.A.sample(t, S);
        await seekVideosForExport(t);
        VZ.renderFrame(ctx, w, hh, t, proj, S, env);
        const img = ctx.getImageData(0, 0, w, hh);
        if (pending) { const r = await pending; if (r && r.error) throw new Error(r.error); }
        pending = api.exportFrame(new Uint8Array(img.data.buffer));
        if (i % 4 === 0) {
          const el = (performance.now() - t0) / 1000, p = (i + 1) / total;
          ui.progress(p, 'Frame ' + (i + 1) + ' / ' + total + ' · ' + ((i + 1) / Math.max(0.1, el)).toFixed(1) + ' fps · about ' + Math.ceil(el / p - el) + ' s left');
          await tick();
        }
      }
      if (pending) { const r = await pending; if (r && r.error) throw new Error(r.error); }
    } catch (e) { failure = e.message || String(e); }
    if (ui.cancelled()) { await api.exportCancel(); return { cancelled: true }; }
    if (failure) { await api.exportCancel(); return { error: failure }; }
    const fin = await api.exportFinish();
    if (!fin.ok) return { error: fin.error };
    return { ok: true, seconds: Math.round((performance.now() - t0) / 1000) };
  }
  async function runExport(o) {
    const P = state.project;
    o = Object.assign({ codec: 'h264', from: 0, to: getDur(), aspects: [P.aspect], fadeIn: 0, fadeOut: 0 }, o);
    const ext = o.codec === 'prores' ? 'mov' : 'mp4';
    const out0 = await api.saveDialog({ defaultPath: (P.name || 'video') + '.' + ext, filters: [{ name: ext === 'mov' ? 'QuickTime movie' : 'MP4 video', extensions: [ext] }] });
    if (!out0) return;
    const base = out0.replace(/\.(mp4|mov)$/i, '');
    let cancelled = false;
    const bar = h('i'), msg = h('div', { class: 'hint', style: 'margin:0' }, 'Starting…'), notes = h('div', { class: 'hint' });
    openModal(h('h2', null, 'Exporting…'), h('div', { class: 'progress' }, bar), msg, notes, h('div', { class: 'modal-actions' }, btn('Cancel', () => { cancelled = true; })));
    state.exporting = true;
    const results = [];
    for (let k = 0; k < o.aspects.length && !cancelled; k++) {
      const a = o.aspects[k], out = o.aspects.length > 1 ? base + '_' + a.replace(':', 'x') + '.' + ext : base + '.' + ext;
      const label = o.aspects.length > 1 ? '(' + (k + 1) + '/' + o.aspects.length + ' · ' + a + ') ' : '';
      const r = await renderOne(o, a, out, { cancelled: () => cancelled, progress: (p, t) => { bar.style.width = ((k + p) / o.aspects.length) * 100 + '%'; msg.textContent = label + t; }, note: (n) => { notes.textContent = n; } });
      if (r.error) { state.exporting = false; markDirty(); return openModal(h('h2', null, 'Export failed'), h('div', { class: 'err' }, r.error), h('div', { class: 'modal-actions' }, btn('Close', closeModal))); }
      if (r.ok) results.push({ out, seconds: r.seconds });
    }
    state.exporting = false; markDirty();
    if (cancelled) { closeModal(); return toast('Export cancelled'); }
    openModal(h('h2', null, 'Export finished ✔'), ...results.map((r) => h('div', { style: 'user-select:text;margin:2px 0' }, baseName(r.out) + '  ·  ' + r.seconds + ' s')),
      h('div', { class: 'modal-actions' }, btn('Show in Finder', () => api.reveal(results[0].out)), btn('Close', closeModal, 'primary')));
  }
  async function exportStill() {
    const P = state.project, { w, h: hh } = dimsFor(P.aspect, 1080);
    const out = await api.saveDialog({ defaultPath: (P.name || 'frame') + '.png', filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (!out) return;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const env = VZ.createEnv((p) => (state.assets[p] ? state.assets[p].el : null)), S = VZ.newSample(), t = getTime();
    state.A.sample(state.A.demo ? 5 : t, S); await seekVideosForExport(t);
    VZ.renderFrame(cv.getContext('2d'), w, hh, t, P, S, env);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    await api.writeBytes(out, new Uint8Array(await blob.arrayBuffer()));
    toast('Saved ' + baseName(out));
  }

  /* ---------------- refresh / init ---------------- */
  function refreshAll() { renderLayers(); renderInspector(); drawTimeline(); fitStage(); markDirty(); }

  function handleDrop(files) {
    for (const f of files) {
      const p = api.pathForFile(f), ext = extOf(p);
      if (AUDIO_EXT.includes(ext)) { commit('audio'); loadAudio(p); }
      else if (IMG_EXT.includes(ext)) {
        loadAsset(p, 'image').then(() => { commit('add'); const L = VZ.newLayer('image', { src: { path: p, name: baseName(p) }, name: baseName(p) }); state.project.layers.push(L); state.sel = L.id; refreshAll(); }).catch(() => toast('Could not open image'));
      } else if (['lrc', 'srt', 'vtt'].includes(ext)) {
        let L = selLayer(); if (!L || L.type !== 'lyrics') L = state.project.layers.find((l) => l.type === 'lyrics');
        if (!L) { toast('Add a Lyrics layer first'); continue; }
        api.readText(p).then((tx) => { commit('lyr'); L.lines = VZ.parseLyricsFile(tx, p, 0); state.sel = L.id; refreshAll(); });
      } else if (ext === 'vizzy') { api.readText(p).then((tx) => { state.projectPath = p; applyProject(JSON.parse(tx)); }); }
    }
  }

  /* ---------------- autosave / recovery ---------------- */
  const AUTOSAVE_KEY = 'vizzy.autosave.v2';
  function startAutosave() {
    let last = '';
    setInterval(() => {
      try {
        const j = JSON.stringify(state.project);
        if (j !== last && !state.exporting) { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), project: state.project })); last = j; }
      } catch (e) { /* storage unavailable */ }
    }, 15000);
  }
  async function offerRecovery() {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null'); } catch (e) { rec = null; }
    if (!rec || !rec.project || !Array.isArray(rec.project.layers)) return;
    const hasWork = rec.project.audio || rec.project.layers.length !== VZ.TEMPLATE_LIST[0].build().length;
    if (!hasWork) return;
    const when = new Date(rec.at).toLocaleString();
    openModal(h('h2', null, 'Restore your last session?'), h('div', { class: 'hint', style: 'margin:0' }, 'An automatic backup from ' + when + ' was found' + (rec.project.name ? ' ("' + rec.project.name + '")' : '') + '.'),
      h('div', { class: 'modal-actions' }, btn('Start fresh', closeModal), btn('Restore', async () => { closeModal(); state.project.audio = null; await applyProject(rec.project); toast('Session restored'); }, 'primary')));
  }

  function init() {
    renderAddGrid();
    $('#btn-templates').onclick = () => hook('gallery');
    $('#btn-magic').onclick = () => hook('magic');
    $('#btn-ai').onclick = () => hook('ai');
    $('#btn-analysis').onclick = () => hook('analysis');
    $('#q-preview').onchange = (e) => { state.previewShort = +e.target.value; fitStage(); };
    $('#chk-guides').onchange = (e) => { state.guides = e.target.checked; drawGuides(); };
    $('#btn-still').onclick = exportStill;
    $('#chk-loop').onchange = (e) => { state.loop = e.target.checked; };
    startAutosave();
    $('#project-name').oninput = (e) => { state.project.name = e.target.value; };
    $('#aspect').onchange = (e) => { commit('aspect'); state.project.aspect = e.target.value; fitStage(); };
    $('#btn-open').onclick = openProject; $('#btn-save').onclick = saveProject;
    $('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
    $('#btn-audio').onclick = pickAudio; $('#btn-export').onclick = () => exportDialog();
    $('#btn-play').onclick = togglePlay;
    const sk = $('#seek');
    sk.addEventListener('mousedown', () => { seeking = true; });
    sk.addEventListener('input', () => seek((sk.value / 1000) * getDur()));
    window.addEventListener('mouseup', () => { seeking = false; });
    $('#volume').oninput = (e) => { if (state.audioEl) state.audioEl.volume = +e.target.value; };
    $('#tl-zoom').oninput = drawTimeline;
    $('#tl-fit').onclick = () => { fitTimeline(); drawTimeline(); };
    $('#tl-wave').addEventListener('mousedown', waveScrub);
    $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal' && !state.exporting) closeModal(); });
    window.addEventListener('resize', () => { fitStage(); });
    new ResizeObserver(fitStage).observe($('#stage'));
    setupPreviewDrag();

    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (state.tap && (e.code === 'Space' || e.code === 'Enter') && tag !== 'textarea') { e.preventDefault(); tapNow(); return; }
      if (e.code === 'Escape' && !state.exporting) closeModal();
      if (typing) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if ((e.code === 'Delete' || e.code === 'Backspace') && state.sel) { e.preventDefault(); deleteLayer(state.sel); }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC' && state.sel) { state.clipboard = JSON.stringify(selLayer()); toast('Layer copied'); }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyV' && state.clipboard) { commit('paste'); const c = JSON.parse(state.clipboard); c.id = VZ.uid(); c.name += ' copy'; c.locked = false; state.project.layers.push(c); state.sel = c.id; refreshAll(); }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD' && state.sel) { e.preventDefault(); duplicateLayer(state.sel); }
      else if (e.code === 'KeyG' && !e.metaKey && !e.ctrlKey) { $('#chk-guides').click(); }
      else if (/^Arrow(Up|Down)$/.test(e.code) && selLayer() && !selLayer().locked && !VZ.TYPES[selLayer().type].noTransform) { e.preventDefault(); commit('nudge'); const L = selLayer(), st = e.shiftKey ? 0.02 : 0.005; L.y = r2(L.y + (e.code === 'ArrowUp' ? -st : st)); markDirty(); }
      else if (e.code === 'ArrowLeft') seek(getTime() - (e.shiftKey ? 5 : 1));
      else if (e.code === 'ArrowRight') seek(getTime() + (e.shiftKey ? 5 : 1));
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); handleDrop([...e.dataTransfer.files]); });

    api.onMenu((ch) => ({ new: newProj, open: openProject, save: saveProject, audio: pickAudio, export: exportDialog, undo, redo, magic: () => hook('magic'), gallery: () => hook('gallery'), ai: () => hook('ai') }[ch] || (() => {}))());

    state.project.layers.forEach((L) => { /* ensure defaults */ });
    refreshAll(); fitTimeline(); drawTimeline();
    requestAnimationFrame(loop);
    offerRecovery();
  }

  window.VizzyApp = {
    state, applyProject, loadAudio, exportDialog, runExport, getDur, hooks, h, btn, toast, openModal, closeModal, progressModal, commit, refreshAll, markDirty, renderInspector, renderLayers, drawTimeline,
    loadAsset, ensureAssets, findLayer, selLayer, seek, play, pause, getTime, fmtT, baseName, extOf, dimsFor, clamp, r2, api, fitStage, runDeepAnalysis, pickAudio, MIME, IMG_EXT, VID_EXT, AUDIO_EXT, selectLayer,
  }; // handy for debugging/tests
  init();
})();
