'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const http = require('http');
const https = require('https');

let win = null;

/* ---------------- ffmpeg discovery ---------------- */
let ffmpegCache = null;
function ffmpegCandidates() {
  const list = [];
  if (process.env.VIZZY_FFMPEG) list.push(process.env.VIZZY_FFMPEG);
  try {
    let p = require('ffmpeg-static');
    if (p) {
      p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      list.push(p);
    }
  } catch (e) { /* not installed */ }
  list.push('/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg', 'ffmpeg');
  return list;
}
function findFfmpeg() {
  if (ffmpegCache) return ffmpegCache;
  const tried = [];
  for (const c of ffmpegCandidates()) {
    try {
      if (c.includes(path.sep) && !fs.existsSync(c)) { tried.push(c + ' (missing)'); continue; }
      const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 15000 });
      if (r.status === 0) {
        ffmpegCache = { path: c, hasX264: /libx264/.test(r.stdout), hasVT: /h264_videotoolbox/.test(r.stdout), hasX265: /libx265/.test(r.stdout), hasHEVCVT: /hevc_videotoolbox/.test(r.stdout), hasProRes: /prores_ks/.test(r.stdout) };
        return ffmpegCache;
      }
      tried.push(c + ' (exit ' + r.status + ')');
    } catch (e) { tried.push(c + ' (' + e.message + ')'); }
  }
  return { error: 'FFmpeg could not be started.\nTried:\n' + tried.join('\n') + '\n\nFix: install it with Homebrew (brew install ffmpeg) and restart the app.' };
}

/* ---------------- window ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1560, height: 940, minWidth: 1280, minHeight: 720,
    backgroundColor: '#0f0b1c', title: 'Vizzy Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const send = (ch) => () => win && win.webContents.send('menu', ch);
  const tpl = [
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'New project', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Open project\u2026', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Save project', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { type: 'separator' },
      { label: 'Load audio\u2026', accelerator: 'CmdOrCtrl+L', click: send('audio') },
      { label: 'Export MP4\u2026', accelerator: 'CmdOrCtrl+E', click: send('export') },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(() => { buildMenu(); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { killFF(); app.quit(); });

/* ---------------- file dialogs / io ---------------- */
ipcMain.handle('dialog:open', async (e, opts) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: (opts && opts.filters) || [] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:save', async (e, opts) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: opts && opts.defaultPath, filters: (opts && opts.filters) || [] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('fs:read', async (e, p) => fs.promises.readFile(p));
ipcMain.handle('fs:readText', async (e, p) => fs.promises.readFile(p, 'utf8'));
ipcMain.handle('fs:writeBytes', async (e, p, bytes) => { await fs.promises.writeFile(p, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)); return true; });
ipcMain.handle('fs:writeText', async (e, p, text) => { await fs.promises.writeFile(p, text, 'utf8'); return true; });
ipcMain.handle('shell:reveal', async (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('app:confirm', async (e, message) => {
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'OK'], defaultId: 1, cancelId: 0, message });
  return r.response === 1;
});

/* ---------------- MP4 export (raw RGBA frames -> ffmpeg) ---------------- */
let ff = null, ffErr = '', ffExit = null, ffDone = null, ffOut = null;
function killFF() { if (ff) { try { ff.stdin.destroy(); ff.kill('SIGKILL'); } catch (e) { /* ignore */ } } ff = null; }

ipcMain.handle('export:capabilities', async () => {
  const info = findFfmpeg();
  if (info.error) return { ok: false, error: info.error };
  return { ok: true, h264: info.hasX264 || info.hasVT, hardware: info.hasVT, h265: info.hasX265 || info.hasHEVCVT, prores: info.hasProRes };
});

ipcMain.handle('export:start', async (e, o) => {
  killFF();
  const info = findFfmpeg();
  if (info.error) return { ok: false, error: info.error };
  const codec = o.codec === 'h265' || o.codec === 'prores' ? o.codec : 'h264';
  let encoder = o.encoder === 'hardware' ? 'hardware' : 'software';
  let note = '';
  const q = { fast: { crf: 23, bpp: 0.07 }, balanced: { crf: 19, bpp: 0.12 }, high: { crf: 15, bpp: 0.2 } }[o.quality] || { crf: 19, bpp: 0.12 };
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', o.w + 'x' + o.h, '-r', String(o.fps), '-i', 'pipe:0'];
  if (o.audioPath) { if (o.startAt > 0) args.push('-ss', String(o.startAt)); args.push('-i', o.audioPath); }
  args.push('-map', '0:v:0');
  if (o.audioPath) {
    args.push('-map', '1:a:0');
    if (o.audioFilter) args.push('-af', o.audioFilter);
    if (codec === 'prores') args.push('-c:a', 'pcm_s16le'); else args.push('-c:a', 'aac', '-b:a', '256k');
  }
  if (codec === 'prores') {
    if (!info.hasProRes) return { ok: false, error: 'This FFmpeg has no ProRes encoder. Choose H.264 instead.' };
    args.push('-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le');
    encoder = 'software';
  } else if (codec === 'h265') {
    if (encoder === 'software' && !info.hasX265) { encoder = 'hardware'; note = 'No libx265 in this FFmpeg, using the hardware HEVC encoder.'; }
    if (encoder === 'hardware' && !info.hasHEVCVT) { if (info.hasX265) { encoder = 'software'; note = 'Hardware HEVC not available, using software.'; } else return { ok: false, error: 'This FFmpeg has no H.265 encoder. Choose H.264 instead.' }; }
    if (encoder === 'hardware') args.push('-c:v', 'hevc_videotoolbox', '-b:v', String(Math.round(o.w * o.h * o.fps * q.bpp * 0.7)), '-allow_sw', '1', '-tag:v', 'hvc1');
    else args.push('-c:v', 'libx265', '-preset', 'veryfast', '-crf', String(q.crf + 4), '-tag:v', 'hvc1');
    args.push('-pix_fmt', 'yuv420p');
  } else {
    if (encoder === 'software' && !info.hasX264) {
      if (info.hasVT) { encoder = 'hardware'; note = 'This FFmpeg has no libx264, so the hardware encoder is used.'; }
      else return { ok: false, error: 'This FFmpeg build has no H.264 encoder.' };
    }
    if (encoder === 'hardware' && !info.hasVT) { encoder = 'software'; note = 'Hardware encoder not available, using software.'; }
    if (encoder === 'hardware') args.push('-c:v', 'h264_videotoolbox', '-b:v', String(Math.round(o.w * o.h * o.fps * q.bpp)), '-allow_sw', '1', '-profile:v', 'high');
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q.crf), '-profile:v', 'high');
    args.push('-pix_fmt', 'yuv420p');
  }
  args.push('-r', String(o.fps), '-t', String(o.duration));
  if (codec !== 'prores') args.push('-movflags', '+faststart');
  args.push(o.outPath);
  ffErr = ''; ffExit = null; ffOut = o.outPath;
  try {
    ff = spawn(info.path, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (err) { return { ok: false, error: 'Could not start FFmpeg: ' + err.message }; }
  ff.stderr.on('data', (d) => { ffErr += d.toString(); if (ffErr.length > 8000) ffErr = ffErr.slice(-8000); });
  ff.stdin.on('error', () => { /* handled through exit code */ });
  ffDone = new Promise((resolve) => {
    ff.on('error', (err) => { ffErr += '\n' + err.message; ffExit = -1; resolve(-1); });
    ff.on('close', (code) => { ffExit = code; resolve(code); });
  });
  return { ok: true, note, encoder, codec, ffmpeg: info.path };
});

ipcMain.handle('export:frame', async (e, buf) => {
  if (!ff || ffExit !== null) return { error: ffErr || 'FFmpeg stopped unexpectedly.' };
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const ok = ff.stdin.write(b);
  if (!ok) {
    await Promise.race([
      new Promise((res) => ff.stdin.once('drain', res)),
      ffDone,
    ]);
  }
  if (ffExit !== null) return { error: ffErr || 'FFmpeg stopped unexpectedly.' };
  return { ok: true };
});

ipcMain.handle('export:finish', async () => {
  if (!ff) return { ok: false, error: 'Export was not running.' };
  try { ff.stdin.end(); } catch (e) { /* ignore */ }
  const code = await ffDone;
  const out = ffOut, err = ffErr;
  ff = null;
  return code === 0 ? { ok: true, path: out } : { ok: false, error: err || 'FFmpeg exited with code ' + code };
});

ipcMain.handle('export:cancel', async () => {
  const out = ffOut;
  killFF();
  if (out) { try { await fs.promises.unlink(out); } catch (e) { /* ignore */ } }
  return true;
});


/* ---------------- AI: Whisper (whisper.cpp, open source) ---------------- */
const MODEL_FILES = {
  tiny: 'ggml-tiny.bin', base: 'ggml-base.bin', small: 'ggml-small.bin', 'large-v3-turbo-q5_0': 'ggml-large-v3-turbo-q5_0.bin',
};
const modelBase = () => process.env.VIZZY_MODEL_BASE || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const modelsDir = () => path.join(app.getPath('userData'), 'models');
const sendWin = (ch, payload) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); } catch (e) { /* ignore */ } };

function findWhisper() {
  const list = [];
  if (process.env.VIZZY_WHISPER) list.push(process.env.VIZZY_WHISPER);
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'bin', 'whisper-cli'));
  list.push(path.join(__dirname, '..', 'bin', 'whisper-cli'), '/usr/local/bin/whisper-cli', '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cpp', '/opt/homebrew/bin/whisper-cpp');
  for (const c of list) { try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (e) { /* next */ } }
  return null;
}

ipcMain.handle('ai:status', async () => {
  const dir = modelsDir();
  const models = {};
  for (const id of Object.keys(MODEL_FILES)) {
    const f = path.join(dir, MODEL_FILES[id]);
    let installed = false;
    try { installed = fs.statSync(f).size > 1e6; } catch (e) { /* missing */ }
    models[id] = installed;
  }
  return { binary: findWhisper(), models, dir };
});

let dlReq = null, dlCancelled = false;
ipcMain.handle('ai:downloadModel', async (e, id) => {
  const file = MODEL_FILES[id];
  if (!file) return { ok: false, error: 'Unknown model' };
  await fs.promises.mkdir(modelsDir(), { recursive: true });
  const dest = path.join(modelsDir(), file), part = dest + '.part';
  dlCancelled = false;
  const get = (url, hops) => new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    dlReq = lib.get(url, { headers: { 'User-Agent': 'VizzyStudio' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), hops + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('Download failed (HTTP ' + res.statusCode + ')')); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0, lastSend = 0;
      const out = fs.createWriteStream(part);
      res.on('data', (c) => { got += c.length; const now = Date.now(); if (now - lastSend > 200) { lastSend = now; sendWin('ai:progress', { kind: 'download', id, received: got, total }); } });
      res.pipe(out);
      out.on('finish', () => { if (total && got < total) return reject(new Error('Download incomplete')); resolve(got); });
      out.on('error', reject); res.on('error', reject);
    });
    dlReq.on('error', reject);
  });
  try {
    await get(modelBase() + file, 0);
    await fs.promises.rename(part, dest);
    return { ok: true };
  } catch (err) {
    try { await fs.promises.unlink(part); } catch (e2) { /* ignore */ }
    return { ok: false, error: dlCancelled ? 'Cancelled' : err.message };
  }
});

let aiProc = null, aiCancelled = false;
function runWhisper(bin, args) {
  return new Promise((resolve) => {
    let log = '';
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    aiProc = p;
    const onData = (d) => {
      const t = d.toString(); log += t; if (log.length > 6000) log = log.slice(-6000);
      const m = t.match(/progress\s*=\s*(\d+)%/g);
      if (m) { const last = m[m.length - 1].match(/(\d+)%/); sendWin('ai:progress', { kind: 'transcribe', percent: +last[1] }); }
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('error', (err) => resolve({ code: -1, log: err.message }));
    p.on('close', (code) => { aiProc = null; resolve({ code, log }); });
  });
}

ipcMain.handle('ai:transcribe', async (e, o) => {
  const bin = findWhisper();
  if (!bin) return { ok: false, error: 'The Whisper engine (whisper-cli) is not included in this build.\nInstall it with Homebrew:  brew install whisper-cpp\nthen restart Vizzy Studio.' };
  const file = MODEL_FILES[o.model];
  if (!file) return { ok: false, error: 'Unknown model' };
  const modelPath = path.join(modelsDir(), file);
  if (!fs.existsSync(modelPath)) return { ok: false, error: 'Model not downloaded yet.' };
  const id = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const wavPath = path.join(os.tmpdir(), 'vizzy-' + id + '.wav'), outPrefix = path.join(os.tmpdir(), 'vizzy-' + id);
  await fs.promises.writeFile(wavPath, Buffer.from(o.wav.buffer, o.wav.byteOffset, o.wav.byteLength));
  aiCancelled = false;
  const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
  const build = (withPrompt) => {
    const a = ['-m', modelPath, '-f', wavPath, '-l', o.language || 'auto', '-ml', '1', '-sow', '-oj', '-of', outPrefix, '-pp', '-t', String(threads)];
    if (o.translate) a.push('-tr');
    if (withPrompt && o.prompt) a.push('--prompt', String(o.prompt).slice(0, 600));
    return a;
  };
  try {
    let r = await runWhisper(bin, build(true));
    if (r.code !== 0 && !aiCancelled && o.prompt) r = await runWhisper(bin, build(false));
    if (aiCancelled) return { ok: false, error: 'Cancelled' };
    if (r.code !== 0) return { ok: false, error: 'Whisper failed (exit ' + r.code + ').\n' + r.log.slice(-1200) };
    const json = JSON.parse(await fs.promises.readFile(outPrefix + '.json', 'utf8'));
    return { ok: true, json };
  } catch (err) {
    return { ok: false, error: 'Whisper output could not be read: ' + err.message };
  } finally {
    for (const f of [wavPath, outPrefix + '.json']) { try { await fs.promises.unlink(f); } catch (e2) { /* ignore */ } }
  }
});

ipcMain.handle('ai:cancel', async () => {
  aiCancelled = true; dlCancelled = true;
  if (aiProc) { try { aiProc.kill('SIGKILL'); } catch (e) { /* ignore */ } }
  if (dlReq) { try { dlReq.destroy(); } catch (e) { /* ignore */ } }
  return true;
});
