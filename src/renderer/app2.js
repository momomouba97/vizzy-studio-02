/* Vizzy Studio - pro features UI: template gallery, AI lyrics, audio analysis, Magic Video, palette, fonts */
(function () {
  'use strict';
  const V = window.VizzyApp;
  const { state, h, btn, toast, openModal, closeModal, progressModal, commit, refreshAll, markDirty, api, clamp, r2 } = V;
  const $ = (s) => document.querySelector(s);
  const row = (l, c) => h('div', { class: 'field' }, h('label', null, l), h('div', { class: 'ctl' }, c));
  const sel = (opts, def) => { const s = h('select', null, opts.map((o) => h('option', { value: o[0] }, o[1]))); if (def != null) s.value = def; return s; };
  const wide = (cls) => $('#modal-card').classList.add(cls || 'wide');
  const tickUI = () => new Promise((r) => setTimeout(r, 0));

  /* =====================================================================
   *  Template gallery
   * ===================================================================== */
  const thumbEnv = VZ.createEnv(() => null);
  const thumbCache = {};
  function renderThumb(t, cv) {
    const asp = t.aspect || '16:9', { w, h: hh } = V.dimsFor(asp, 180);
    cv.width = w; cv.height = hh;
    const layers = t.build();
    layers.forEach((L) => { if (L.type === 'lyrics' && (!L.lines || !L.lines.length)) L.lines = JSON.parse(JSON.stringify(VZ.SAMPLE_LINES)); });
    const S = VZ.newSample(), A = thumbCache.A || (thumbCache.A = VZ.demoAnalysis());
    A.sample(7.3, S);
    VZ.renderFrame(cv.getContext('2d'), w, hh, 2.6, { bgColor: '#0b0b14', aspect: asp, meta: VZ.DEFAULT_META, layers }, S, thumbEnv);
  }
  function gallery() {
    let cat = 'All', q = '';
    const grid = h('div', { class: 'gallery' }), tabs = h('div', { class: 'tabs' });
    const search = h('input', { type: 'text', placeholder: 'Search templates…', style: 'margin-left:auto;width:200px' });
    const queue = [];
    let pumping = false;
    const pump = () => {
      if (pumping) return; pumping = true;
      const step = () => {
        const job = queue.shift();
        if (!job) { pumping = false; return; }
        if (job.cv.isConnected) { try { renderThumb(job.t, job.cv); } catch (e) { console.error(e); } }
        setTimeout(step, 0);
      };
      step();
    };
    const fill = () => {
      grid.replaceChildren(); queue.length = 0;
      VZ.TEMPLATE_LIST.filter((t) => (cat === 'All' || t.cat === cat) && (!q || (t.name + ' ' + t.desc).toLowerCase().includes(q))).forEach((t) => {
        const cv = h('canvas');
        cv.width = 320; cv.height = 180;
        grid.append(h('div', { class: 'tcard', onclick: () => applyTemplate(t) }, cv, h('div', { class: 'tn' }, t.name), h('div', { class: 'td' }, t.desc + (t.aspect !== '16:9' ? ' · ' + t.aspect : ''))));
        queue.push({ t, cv });
      });
      pump();
    };
    const drawTabs = () => {
      tabs.replaceChildren(...['All'].concat(VZ.TEMPLATE_CATS).map((c) => h('button', { class: 'btn' + (c === cat ? ' on' : ''), onclick: () => { cat = c; drawTabs(); fill(); } }, c)), search);
    };
    search.oninput = () => { q = search.value.trim().toLowerCase(); fill(); };
    openModal(h('h2', null, 'Templates  ', h('span', { class: 'hint' }, VZ.TEMPLATE_LIST.length + ' ready-made looks – your song, lyrics and cover art are kept')), tabs, grid,
      h('div', { class: 'modal-actions' }, btn('Close', closeModal)));
    wide('xl'); drawTabs(); fill();
  }
  function applyTemplate(t) {
    const P = state.project;
    commit('tpl');
    const oldLy = P.layers.find((l) => l.type === 'lyrics' && l.lines && l.lines.length);
    const oldCover = P.layers.find((l) => l.type === 'image' && l.src);
    const layers = t.build();
    const ly = layers.find((l) => l.type === 'lyrics');
    if (oldLy && ly) ly.lines = JSON.parse(JSON.stringify(oldLy.lines));
    if (oldCover) layers.filter((l) => l.type === 'image' && !l.src).forEach((l) => { l.src = oldCover.src; });
    P.layers = layers; state.sel = null;
    if (t.aspect && t.aspect !== P.aspect) { P.aspect = t.aspect; $('#aspect').value = t.aspect; }
    V.ensureAssets().then(markDirty);
    refreshAll(); closeModal(); toast('Template applied: ' + t.name);
  }

  /* =====================================================================
   *  AI lyrics (Whisper)
   * ===================================================================== */
  let progressCb = null;
  if (api.onAiProgress) api.onAiProgress((d) => { if (progressCb) progressCb(d); });
  const fmtMB = (b) => (b / 1e6).toFixed(0) + ' MB';

  async function ensureModel(id, ui) {
    const st = await api.aiStatus();
    if (!st.binary) throw new Error('The Whisper engine (whisper-cli) is not included in this build.\nInstall it with Homebrew:  brew install whisper-cpp\nthen restart Vizzy Studio.');
    if (st.models[id]) return;
    ui.set(0, 'Downloading the speech model (one time only, needs internet)…');
    progressCb = (d) => { if (d.kind === 'download' && d.total) ui.set(d.received / d.total, 'Downloading model… ' + fmtMB(d.received) + ' / ' + fmtMB(d.total)); };
    const r = await api.aiDownload(id);
    progressCb = null;
    if (!r.ok) throw new Error('Model download failed: ' + r.error);
  }

  /** Core pipeline used by the AI Lyrics dialog and by Magic Video. Returns array of lines. */
  async function generateLyrics(o, ui) {
    const A = state.A;
    if (!A || A.demo || !A.mono) throw new Error('Load a song first.');
    await ensureModel(o.model, ui);
    ui.set(0, 'Preparing audio…');
    await tickUI();
    const m16 = await VZ.resampleTo16k(A.mono, A.sr);
    const wav = VZ.encodeWav16(m16, 16000);
    ui.set(0, 'Listening to the song with Whisper… 0%');
    progressCb = (d) => { if (d.kind === 'transcribe') ui.set(d.percent / 100, 'Listening to the song with Whisper… ' + d.percent + '%'); };
    const r = await api.aiTranscribe({ wav, model: o.model, language: o.language, translate: !!o.translate, prompt: o.prompt || '' });
    progressCb = null;
    if (!r.ok) throw new Error(r.error);
    const words = VZ.parseWhisperJson(r.json);
    if (!words.length) throw new Error('No words were recognised. Try the Small or Large model, or pick the language manually.');
    if (o.userLines && o.userLines.length) {
      const al = VZ.alignLyrics(o.userLines, words);
      if (al.lines) return { lines: al.lines, info: 'Synced ' + al.matched + ' of ' + al.total + ' words to the audio.' };
      return { lines: VZ.groupWords(words, { maxWords: o.maxWords }), info: 'Your lyrics could not be matched to the audio, so the recognised text was used instead.', fallback: true };
    }
    return { lines: VZ.groupWords(words, { maxWords: o.maxWords }), info: words.length + ' words recognised.' };
  }
  V.generateLyrics = generateLyrics;

  function targetLyricsLayer(create) {
    const P = state.project;
    let L = V.selLayer();
    if (!L || L.type !== 'lyrics') L = P.layers.find((l) => l.type === 'lyrics');
    if (!L && create) {
      L = VZ.newLayer('lyrics', { name: 'Lyrics' });
      const i = P.layers.findIndex((l) => l.type === 'effect');
      if (i >= 0) P.layers.splice(i, 0, L); else P.layers.push(L);
    }
    return L;
  }

  function aiDialog() {
    if (!state.A || state.A.demo) { toast('Load a song first (♫ Load audio)'); return V.pickAudio(); }
    const model = sel(VZ.WHISPER_MODELS.map((m) => [m.id, m.label]), 'small');
    const lang = sel(VZ.WHISPER_LANGS, 'auto');
    const mode = sel([['auto', 'Generate lyrics automatically'], ['sync', 'Sync lyrics I paste (best accuracy)']], 'auto');
    const own = h('textarea', { class: 'ta-lg', placeholder: 'Paste the lyrics here, one line per row. Whisper will find when each line is sung.' });
    const trans = h('input', { type: 'checkbox' });
    const words = h('input', { type: 'number', min: 2, max: 14, step: 1, value: 7 });
    const status = h('div', { class: 'hint', style: 'margin:6px 0 0' });
    const showOwn = () => { own.style.display = mode.value === 'sync' ? '' : 'none'; own.classList.toggle('rtl', VZ.isRTL(own.value)); };
    mode.onchange = showOwn; own.oninput = showOwn; showOwn();
    api.aiStatus().then((st) => {
      status.textContent = !st.binary ? 'Whisper engine not found – install it with  brew install whisper-cpp  (it is bundled in release builds).' :
        'Models installed: ' + (Object.keys(st.models).filter((k) => st.models[k]).join(', ') || 'none yet – downloaded automatically on first use (needs internet once).');
    });
    const go = async () => {
      const userLines = mode.value === 'sync' ? own.value.split('\n').map((x) => x.trim()).filter(Boolean) : null;
      if (mode.value === 'sync' && !userLines.length) return toast('Paste your lyrics first');
      const pm = progressModal('AI lyrics', 'Starting…');
      const cancel = h('div', { class: 'modal-actions' }, btn('Cancel', () => api.aiCancel()));
      $('#modal-card').append(cancel);
      try {
        const res = await generateLyrics({ model: model.value, language: lang.value, translate: trans.checked, userLines, maxWords: +words.value || 7 }, pm);
        const L = targetLyricsLayer(true);
        commit('ai'); L.lines = res.lines; state.sel = L.id;
        pm.close(); refreshAll();
        openModal(h('h2', null, 'Lyrics ready ✔'), h('div', null, res.lines.length + ' lines added to “' + L.name + '”.'), h('div', { class: 'hint' }, res.info + ' Review and fix any words in the inspector – you can still nudge timing with the Shift buttons or Tap to sync.'),
          h('div', { class: 'modal-actions' }, btn('Done', closeModal, 'primary')));
      } catch (e) {
        pm.close();
        openModal(h('h2', null, e.message === 'Cancelled' ? 'Cancelled' : 'AI lyrics failed'), h('div', { class: 'err' }, String(e.message || e)), h('div', { class: 'modal-actions' }, btn('Close', closeModal)));
      }
    };
    openModal(h('h2', null, '🤖 AI Lyrics (Whisper, runs 100% on your Mac)'),
      row('Mode', mode), row('Model', model), row('Song language', lang), own,
      row('Words per line', words), row('Translate to English', trans), status,
      h('div', { class: 'hint' }, 'Tip: works best on clear vocals. For songs with heavy instruments, paste the real lyrics and use “Sync” – it is far more accurate than guessing the words.'),
      h('div', { class: 'modal-actions' }, btn('Cancel', closeModal), btn('Start', go, 'primary')));
    wide('wide');
  }

  /* =====================================================================
   *  Audio analysis
   * ===================================================================== */
  function analysisDialog() {
    const an = state.analysis;
    if (!state.A || state.A.demo) { toast('Load a song first'); return V.pickAudio(); }
    if (!an) { toast('Still analysing the song…'); return V.runDeepAnalysis(); }
    const lo = an.loudness;
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
    const regrid = () => { an.grid = VZ.beatGrid(an.bpm, an.gridStart, an.duration); V.drawTimeline(); };
    const bpm = h('b', null, Math.round(an.bpm * 10) / 10 + '');
    const upd = () => { bpm.textContent = Math.round(an.bpm * 10) / 10; regrid(); };
    const secs = h('div');
    an.sections.forEach((s) => secs.append(h('div', { class: 'lyric-row' }, h('span', { style: 'width:110px' }, s.label), h('span', { class: 'mono hint', style: 'flex:1' }, V.fmtT(s.t0) + ' → ' + V.fmtT(s.t1)), btn('Go', () => { V.seek(s.t0); closeModal(); }, 'small'))));
    const addFx = () => {
      commit('fxs');
      let n = 0;
      an.sections.slice(1).forEach((s) => { state.project.layers.push(VZ.newLayer('effect', { name: 'Flash @ ' + s.label, fx: 'flash', amount: 0.6, start: r2(s.t0 - 0.05), end: r2(s.t0 + 0.45) })); n++; });
      refreshAll(); toast(n + ' flash effects added at section changes');
    };
    const verdict = lo.clipping ? 'Peaks hit 0 dBFS – the file is clipping.' : lo.rmsDb > -9 ? 'Very loud master.' : lo.rmsDb < -22 ? 'Quiet – enable “Normalize loudness” when exporting.' : 'Healthy loudness.';
    openModal(h('h2', null, '📊 Audio analysis'),
      h('div', { class: 'stat-grid' }, h('div', { class: 'stat' }, bpm, h('span', null, 'BPM' + (an.bpmConfidence != null ? ' · ' + Math.round(an.bpmConfidence * 100) + '% sure' : ''))), stat(an.key, 'Key'), stat(Math.round(lo.rmsDb) + ' dB', 'Average level'), stat(V.fmtT(an.duration), 'Length')),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, h('span', { class: 'hint' }, 'Tempo looks off?'),
        btn('× 2', () => { an.bpm *= 2; upd(); }, 'small'), btn('÷ 2', () => { an.bpm /= 2; upd(); }, 'small'),
        h('span', { class: 'hint' }, 'Grid offset'), btn('−0.02 s', () => { an.gridStart = Math.max(0, an.gridStart - 0.02); upd(); }, 'small'), btn('+0.02 s', () => { an.gridStart += 0.02; upd(); }, 'small')),
      h('div', { class: 'hint' }, 'Peak ' + Math.round(lo.peakDb) + ' dB · dynamic range ' + Math.round(lo.range) + ' dB — ' + verdict),
      h('div', { class: 'group-title' }, 'Song structure (shown on the timeline ruler)'), secs,
      h('div', { style: 'margin-top:12px;display:flex;gap:6px' }, btn('⚡ Add flash effect at every section change', addFx, 'small primary')),
      h('div', { class: 'modal-actions' }, btn('Close', closeModal, 'primary')));
    wide('wide');
  }

  /* =====================================================================
   *  Palette from artwork
   * ===================================================================== */
  function imagePalette(img) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 64);
    const pal = VZ.extractPalette(g.getImageData(0, 0, 64, 64).data, 6);
    return VZ.paletteRoles(pal);
  }
  function recolor(layers, R) {
    const set = (L, o) => Object.assign(L, o);
    layers.forEach((L) => {
      if (L.type === 'background') { if (L.mode === 'gradient') set(L, { color: R.dark, color2: R.primary }); else if (L.mode === 'color') set(L, { color: R.dark }); }
      else if (L.type === 'visualizer') set(L, { color: R.primary, color2: R.accent });
      else if (L.type === 'particles') set(L, { color: R.light, color2: R.accent });
      else if (L.type === 'shape') { if ('color' in L) L.color = R.primary; if ('color2' in L) L.color2 = R.accent; }
      if ('glowColor' in L) L.glowColor = R.accent;
    });
  }
  async function paletteDialog(forced) {
    let src = forced;
    if (!src) {
      const cover = state.project.layers.find((l) => l.type === 'image' && l.src);
      const p = await api.openDialog({ filters: [{ name: 'Image', extensions: V.IMG_EXT }], defaultPath: cover ? cover.src.path : undefined });
      if (!p) return; src = p;
    }
    let R;
    try { const a = await V.loadAsset(src, 'image'); R = imagePalette(a.el); } catch (e) { return toast('Could not read that image'); }
    if (!R) return toast('No colours found');
    const sw = (c, n) => h('div', { style: 'text-align:center;font-size:10px;color:var(--muted)' }, h('i', { style: 'background:' + c, width: 1 }), n);
    openModal(h('h2', null, '🎨 Colours from your artwork'),
      h('div', { class: 'swatches' }, R.all.map((c) => h('i', { style: 'background:' + c, title: c }))),
      h('div', { class: 'hint', style: 'margin:0' }, 'Main ' + R.primary + ' · Accent ' + R.accent + ' · Dark ' + R.dark),
      h('div', { class: 'modal-actions' }, btn('Cancel', closeModal), btn('Recolor all layers', () => { commit('recolor'); recolor(state.project.layers, R); closeModal(); refreshAll(); toast('Colours matched to the artwork'); }, 'primary')));
    void sw;
  }

  /* =====================================================================
   *  Custom fonts
   * ===================================================================== */
  async function loadFonts(list) {
    for (const f of list || []) {
      if (VZ.FONTS.includes(f.name)) continue;
      try {
        const bytes = await api.readFile(f.path);
        const face = new FontFace(f.name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        await face.load(); document.fonts.add(face); VZ.FONTS.push(f.name);
      } catch (e) { toast('Font missing: ' + f.name); }
    }
  }
  async function importFont() {
    const p = await api.openDialog({ filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }] });
    if (!p) return;
    const name = V.baseName(p).replace(/\.[^.]+$/, '');
    await loadFonts([{ name, path: p }]);
    const P = state.project; P.fonts = (P.fonts || []).filter((f) => f.name !== name).concat([{ name, path: p }]);
    toast('Font “' + name + '” added – pick it in any text layer');
    V.renderInspector();
  }

  /* =====================================================================
   *  Magic Video
   * ===================================================================== */
  function magic() {
    const P = state.project;
    const o = { cover: null };
    const title = h('input', { type: 'text', value: P.meta.title === 'Song Title' ? '' : P.meta.title, placeholder: 'Song title' });
    const artist = h('input', { type: 'text', value: P.meta.artist === 'Artist Name' ? '' : P.meta.artist, placeholder: 'Artist' });
    const songName = h('span', { class: 'file-name' }, P.audio ? P.audio.name : 'No song yet');
    const coverName = h('span', { class: 'file-name' }, 'Optional');
    const lyrMode = sel([['none', 'No lyrics'], ['auto', 'Generate with AI'], ['sync', 'Sync my lyrics with AI']], 'none');
    const own = h('textarea', { class: 'ta-lg', placeholder: 'Paste the lyrics, one line per row' }); own.style.display = 'none';
    const recolorChk = h('input', { type: 'checkbox', checked: true });
    const tpls = VZ.TEMPLATE_LIST;
    const style = h('select', null, h('option', { value: '-1' }, '🎲 Surprise me'),
      VZ.TEMPLATE_CATS.map((c) => h('optgroup', { label: c }, tpls.map((t, i) => (t.cat === c ? h('option', { value: String(i) }, t.name) : null)))));
    lyrMode.onchange = () => { own.style.display = lyrMode.value === 'sync' ? '' : 'none'; own.classList.toggle('rtl', VZ.isRTL(own.value)); };
    own.oninput = () => own.classList.toggle('rtl', VZ.isRTL(own.value));
    const pickSong = async () => {
      const p = await api.openDialog({ filters: [{ name: 'Audio', extensions: V.AUDIO_EXT }] });
      if (!p) return; o.song = p; songName.textContent = V.baseName(p);
      if (!title.value) title.value = V.baseName(p).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    };
    const pickCover = async () => {
      const p = await api.openDialog({ filters: [{ name: 'Images', extensions: V.IMG_EXT }] });
      if (p) { o.cover = p; coverName.textContent = V.baseName(p); }
    };
    const go = async () => {
      if (!o.song && !P.audio) return toast('Choose a song first');
      if (lyrMode.value === 'sync' && !own.value.trim()) return toast('Paste your lyrics or switch the lyrics mode');
      closeModal();
      try {
        commit('magic');
        if (o.song) { P.audio = null; await V.loadAudio(o.song); }
        const i = +style.value, t = i >= 0 ? tpls[i] : tpls[Math.floor(Math.random() * tpls.length)];
        const layers = t.build();
        P.meta = { title: title.value.trim() || 'Song Title', artist: artist.value.trim() || '' };
        if (o.cover) {
          await V.loadAsset(o.cover, 'image');
          const src = { path: o.cover, name: V.baseName(o.cover) };
          layers.filter((l) => l.type === 'image' && !l.src).forEach((l) => { l.src = src; });
          const a = state.assets[o.cover];
          if (recolorChk.checked && a) { const R = imagePalette(a.el); if (R) recolor(layers, R); }
        }
        P.layers = layers; state.sel = null;
        if (t.aspect) { P.aspect = t.aspect; $('#aspect').value = t.aspect; }
        $('#project-name').value = P.name = P.meta.title || P.name;
        refreshAll();
        if (lyrMode.value !== 'none') {
          const pm = progressModal('Creating lyrics with AI', 'Starting…');
          try {
            const userLines = lyrMode.value === 'sync' ? own.value.split('\n').map((x) => x.trim()).filter(Boolean) : null;
            const res = await generateLyrics({ model: 'small', language: 'auto', userLines, maxWords: 7 }, pm);
            const L = targetLyricsLayer(true); L.lines = res.lines; pm.close(); refreshAll(); toast(res.info, 4500);
          } catch (e) {
            pm.close();
            openModal(h('h2', null, 'Video created – lyrics step failed'), h('div', { class: 'err' }, String(e.message || e)), h('div', { class: 'hint' }, 'You can retry from the AI Lyrics button.'), h('div', { class: 'modal-actions' }, btn('OK', closeModal, 'primary')));
          }
        }
        V.seek(0); toast('Your video is ready – press Space to preview, then Export');
      } catch (e) { toast('Magic Video failed: ' + (e.message || e), 5000); }
    };
    openModal(h('h2', null, '✨ Magic Video'), h('div', { class: 'hint', style: 'margin:0 0 10px' }, 'Pick a song and a style – Vizzy builds the whole video. You can fine-tune everything afterwards.'),
      row('Song', [songName, btn('Choose…', pickSong, 'small')]), row('Title', title), row('Artist', artist),
      row('Cover art', [coverName, btn('Choose…', pickCover, 'small')]), row('Match colours', [recolorChk, h('span', { class: 'hint' }, 'use the cover’s palette')]),
      row('Style', style), row('Lyrics', lyrMode), own,
      h('div', { class: 'modal-actions' }, btn('Cancel', closeModal), btn('Create video', go, 'primary')));
    wide('wide');
  }

  /* ---------- register ---------- */
  Object.assign(V.hooks, { gallery, ai: aiDialog, analysis: analysisDialog, palette: () => paletteDialog(), font: importFont, magic, loadFonts });
  V.loadFonts = loadFonts;
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyM') { e.preventDefault(); magic(); }
  });
})();
