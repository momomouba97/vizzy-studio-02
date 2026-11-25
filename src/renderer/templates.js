/* Vizzy Studio \u2013 template library. Every template is a function that returns fresh layers. */
(function (root) {
  'use strict';
  const VZ = root.VZ;
  const N = (type, o) => VZ.newLayer(type, o);
  const bg = (c1, c2, a, o) => N('background', Object.assign({ mode: 'gradient', color: c1, color2: c2, angle: a == null ? 160 : a }, o || {}));
  const solid = (c) => N('background', { mode: 'color', color: c });
  const fx = (f, amount, o) => N('effect', Object.assign({ fx: f, amount }, o || {}));
  const viz = (style, o) => N('visualizer', Object.assign({ style }, o || {}));
  const txt = (text, o) => N('text', Object.assign({ text }, o || {}));
  const part = (mode, o) => N('particles', Object.assign({ mode }, o || {}));
  const lyr = (o) => N('lyrics', Object.assign({ name: 'Lyrics', lines: [] }, o || {}));
  const cover = (o) => N('image', Object.assign({ name: 'Cover art', src: null, shape: 'circle', size: 28 }, o || {}));
  const shape = (s, o) => N('shape', Object.assign({ shape: s }, o || {}));
  const TITLE = (o) => txt('{title}', Object.assign({ name: 'Title', size: 8, upper: true, spacing: 4 }, o || {}));
  const ARTIST = (o) => txt('{artist}', Object.assign({ name: 'Artist', size: 3.2, weight: 400, upper: true, spacing: 8, opacity: 0.8 }, o || {}));
  const beat = (f, amount, o) => fx(f, amount, Object.assign({ reactBand: 'beat', reactAmount: 1 }, o || {}));

  const LIST = [];
  const add = (cat, name, desc, build, aspect) => LIST.push({ id: cat[0] + LIST.length, cat, name, desc, build, aspect: aspect || '16:9' });

  /* ================= VISUALIZER ================= */
  add('Visualizer', 'Neon Mirror', 'Glowing mirrored bars, rising particles', () => [
    bg('#0a0221', '#5b21b6', 160), part('rise', { count: 90, color2: '#f0abfc' }),
    viz('mirror', { name: 'Mirrored bars', count: 56, width: 74, height: 30, y: 0.62, color: '#22d3ee', color2: '#e879f9', glow: 8, symmetric: true }),
    TITLE({ y: 0.2, size: 9, glow: 4 }), ARTIST({ y: 0.29 }), fx('vignette', 0.7), beat('flash', 0.25, { name: 'Beat flash' })]);
  add('Visualizer', 'Circle Pulse', 'Radial bars around a cover disc', () => [
    bg('#020617', '#1e3a8a', 120),
    viz('circlebars', { name: 'Circle bars', count: 90, radius: 17, length: 14, y: 0.46, symmetric: true, color: '#38bdf8', color2: '#f472b6', glow: 6, gap: 0.45 }),
    shape('circle', { name: 'Disc', y: 0.46, width: 31, height: 31, color: '#1e293b', color2: '#0f172a', reactBand: 'bass', reactAmount: 0.15 }),
    cover({ y: 0.46, size: 29 }), TITLE({ y: 0.88, size: 5 }), ARTIST({ y: 0.94, size: 2.4 }), fx('grain', 0.35), fx('vignette', 0.6)]);
  add('Visualizer', 'Sunburst Glow', 'Golden rays exploding from the cover', () => [
    bg('#0f0524', '#7f1d1d', 200),
    viz('sunburst', { name: 'Sun rays', count: 72, radius: 15, length: 16, y: 0.46, color: '#fde047', color2: '#f97316', glow: 10, symmetric: true, gap: 0.3 }),
    shape('circle', { name: 'Core', y: 0.46, width: 30, height: 30, color: '#fde68a', color2: '#f97316', glow: 12, reactBand: 'bass', reactAmount: 0.08 }),
    cover({ y: 0.46, size: 27 }), TITLE({ y: 0.9, size: 5, glow: 4, glowColor: '#f97316' }), beat('bloom', 0.6, { reactAmount: 0.6 }), fx('vignette', 0.65)]);
  add('Visualizer', 'Ridge Lines', 'Joy-Division style stacked waveforms', () => [
    solid('#05050a'),
    viz('ridge', { name: 'Ridge', count: 70, lines: 16, width: 62, height: 56, y: 0.56, color: '#ffffff', color2: '#8b5cf6', lineWidth: 0.5, sens: 1.1, symmetric: true }),
    TITLE({ y: 0.11, size: 3.6, weight: 300, spacing: 14 }), ARTIST({ y: 0.16, size: 2 }), fx('grain', 0.3)]);
  add('Visualizer', 'Vinyl Night', 'Spinning record, embers and warm light', () => [
    bg('#140a1e', '#4a1d3d', 150), part('embers', { count: 50, color: '#fbbf24', color2: '#f97316', glow: 6 }),
    viz('vinyl', { name: 'Vinyl', x: 0.3, y: 0.5, radius: 24, color: '#f59e0b', color2: '#ef4444' }),
    TITLE({ x: 0.74, y: 0.44, size: 7, align: 'left', maxWidth: 42, upper: false, spacing: 0 }), ARTIST({ x: 0.74, y: 0.55, align: 'left', maxWidth: 42, size: 3 }),
    fx('lightleak', 0.35), fx('grain', 0.4), fx('vignette', 0.6)]);
  add('Visualizer', 'Starfield Warp', 'Hyperspace stars + circular waveform', () => [
    bg('#000000', '#0b1030', 180),
    viz('starfield', { name: 'Stars', count: 120, color: '#ffffff', color2: '#7dd3fc', lineWidth: 0.5 }),
    viz('circlewave', { name: 'Circle wave', y: 0.46, radius: 14, length: 9, color: '#7dd3fc', color2: '#c084fc', glow: 8, lineWidth: 0.5 }),
    TITLE({ y: 0.82, size: 5 }), ARTIST({ y: 0.89, size: 2.4 }), beat('zoom', 0.35, { reactBand: 'bass' }), fx('bloom', 0.4)]);
  add('Visualizer', 'Spectrogram', 'Scrolling frequency heat-map', () => [
    bg('#021b1f', '#0b3b44', 180),
    viz('spectrogram', { name: 'Spectrogram', count: 80, width: 90, height: 50, y: 0.54, color: '#fef08a', color2: '#0f766e', sens: 1.3 }),
    TITLE({ y: 0.1, size: 4.5, spacing: 10 }), fx('scanlines', 0.4), fx('vignette', 0.6)]);
  add('Visualizer', 'SoundCloud Waveform', 'Full-song waveform with play progress', () => [
    bg('#1f2937', '#0b1220', 160),
    viz('waveprogress', { name: 'Waveform', count: 90, width: 82, height: 24, y: 0.58, color: '#ff7a1a', color2: '#9ca3af', gap: 0.4, rounded: true }),
    TITLE({ y: 0.34, size: 6, upper: false, spacing: 0 }), ARTIST({ y: 0.42, size: 3.2, color: '#9ca3af', opacity: 1 }), fx('vignette', 0.5)]);
  add('Visualizer', 'Bubble Pop', 'Playful bubbles on a pastel sky', () => [
    bg('#fbc2eb', '#a6c1ee', 160), part('bokeh', { count: 30, color: '#ffffff', color2: '#ffd6ec', blend: 'screen', size: 1 }),
    viz('bubbles', { name: 'Bubbles', count: 26, width: 92, height: 56, y: 0.7, color: '#ffffff', color2: '#ff6fb5', lineWidth: 0.5 }),
    TITLE({ y: 0.25, size: 9, color: '#4c1d95', upper: false, spacing: 0 }), ARTIST({ y: 0.34, color: '#6d28d9', opacity: 1 })]);
  add('Visualizer', 'Neon Tunnel', 'Fly through glowing hexagons', () => [
    bg('#05010f', '#1a0338', 180),
    viz('tunnel', { name: 'Tunnel', y: 0.5, radius: 12, lines: 14, color: '#22d3ee', color2: '#f0abfc', lineWidth: 0.6, glow: 8 }),
    TITLE({ y: 0.5, size: 7, spacing: 8, glow: 8, glowColor: '#22d3ee', animIn: 'zoomIn', animDur: 0.9 }),
    beat('rgbsplit', 0.5), fx('bloom', 0.5), fx('vignette', 0.6)]);
  add('Visualizer', 'Plasma Wave', 'Liquid plasma with a bright waveform', () => [
    bg('#0b0420', '#2d1b69', 160),
    viz('plasma', { name: 'Plasma', width: 100, height: 100, y: 0.5, color: '#ff3d81', color2: '#2d1b69' }),
    viz('wave', { name: 'Waveform', width: 80, height: 18, y: 0.5, color: '#ffffff', color2: '#ffffff', glow: 6, lineWidth: 0.5, sens: 1.2 }),
    TITLE({ y: 0.86, size: 4.5 }), fx('grade', 1, { sat: 1.25, contrast: 1.1 }), fx('vignette', 0.5)]);
  add('Visualizer', 'Hexagon Pulse', 'Honeycomb reacting across the spectrum', () => [
    bg('#06060f', '#10102a', 170),
    viz('hexgrid', { name: 'Hex grid', count: 120, width: 100, height: 100, y: 0.5, color: '#38bdf8', color2: '#312e81', symmetric: true }),
    TITLE({ y: 0.5, size: 8, spacing: 10, glow: 6 }), fx('vignette', 0.7), beat('flash', 0.15)]);
  add('Visualizer', 'Retro Synthwave', 'Sunset, LED bars and scanlines', () => [
    bg('#1b0538', '#ff4d8d', 180), shape('circle', { name: 'Sun', y: 0.5, width: 38, height: 38, color: '#ffe46b', color2: '#ff3d81', glow: 14, reactBand: 'bass', reactAmount: 0.06 }),
    viz('segments', { name: 'LED bars', count: 48, width: 100, height: 22, y: 0.84, color: '#ff3d81', color2: '#22d3ee', symmetric: true, gap: 0.25 }),
    TITLE({ y: 0.2, size: 11, weight: 900, italic: true, font: 'Impact', gradient: true, color: '#ffe46b', color2: '#ff3d81', spacing: 2 }),
    fx('scanlines', 0.35), fx('bloom', 0.5), fx('grain', 0.2)]);
  add('Visualizer', 'Oscilloscope', 'Green phosphor Lissajous scope', () => [
    solid('#020a04'),
    viz('lissajous', { name: 'Scope', width: 56, height: 56, y: 0.48, color: '#4ade80', color2: '#bbf7d0', glow: 10, lineWidth: 0.4, sens: 1.4 }),
    TITLE({ y: 0.92, size: 3, font: 'Menlo', color: '#4ade80', weight: 400, spacing: 8 }),
    fx('scanlines', 0.6), fx('grain', 0.5), fx('rgbsplit', 0.25), fx('vignette', 0.8)]);
  add('Visualizer', 'LED Equalizer', 'Classic hi-fi segment meter', () => [
    solid('#08080c'),
    viz('segments', { name: 'Equalizer', count: 40, width: 82, height: 54, y: 0.56, color: '#ef4444', color2: '#22c55e', gap: 0.3 }),
    TITLE({ y: 0.13, size: 5, spacing: 10 }), ARTIST({ y: 0.2 }), fx('vignette', 0.5)]);
  add('Visualizer', 'Glitch VHS', 'Distorted tape look that hits on the beat', () => [
    bg('#000000', '#312e81', 180),
    viz('bars', { name: 'Bars', count: 48, width: 80, height: 34, y: 0.7, color: '#a3e635', color2: '#22d3ee', gap: 0.3, rounded: false }),
    TITLE({ y: 0.3, size: 11, weight: 900, font: 'Impact', spacing: 2 }),
    beat('rgbsplit', 0.6), beat('glitch', 0.7), fx('scanlines', 0.5), fx('grain', 0.4)]);
  add('Visualizer', 'EDM Drop', 'Heavy shake, zoom and flashes on every beat', () => [
    bg('#000000', '#220033', 180),
    viz('mirror', { name: 'Mirror bars', count: 36, width: 96, height: 62, y: 0.5, color: '#ff2e93', color2: '#2ee6ff', gap: 0.2, rounded: false, glow: 10, symmetric: true }),
    TITLE({ y: 0.5, size: 13, weight: 900, font: 'Impact', outline: 0.5, opacity: 0.92 }),
    beat('zoom', 0.4, { reactBand: 'bass' }), beat('shake', 0.35), beat('rgbsplit', 0.4), beat('flash', 0.18)]);
  add('Visualizer', 'Cinematic Dust', 'Film look: letterbox, bokeh and light leaks', () => [
    bg('#0e0a08', '#2a1a10', 170), part('bokeh', { count: 26, color: '#ffd9a0', color2: '#ffb072', blend: 'screen' }), part('twinkle', { count: 70, size: 0.5, color: '#fff1d6' }),
    viz('wave', { name: 'Waveform', width: 56, height: 8, y: 0.54, color: '#fff1d6', color2: '#ffb072', lineWidth: 0.25, sens: 1.1, glow: 4, opacity: 0.85 }),
    TITLE({ y: 0.4, size: 7, font: 'Didot', weight: 400, spacing: 12, animIn: 'fade', animDur: 1.5 }), ARTIST({ y: 0.47, size: 2.4, spacing: 10 }),
    fx('lightleak', 0.35), fx('grade', 1, { sat: 0.9, contrast: 1.1 }), fx('letterbox', 0.6), fx('grain', 0.3), fx('vignette', 0.6)]);
  add('Visualizer', 'Lo-fi Cassette', 'Warm tape, grain and sleepy bars', () => [
    bg('#2b1b12', '#7a4a2b', 160),
    viz('bars', { name: 'Bars', count: 24, width: 36, height: 14, y: 0.64, color: '#f3d9b1', color2: '#d08a4a', gap: 0.45, rounded: true }),
    TITLE({ y: 0.4, size: 6, font: 'Courier New', color: '#f3d9b1', spacing: 6 }), ARTIST({ y: 0.48, size: 2.6, font: 'Courier New', color: '#f3d9b1' }),
    fx('duotone', 0.35, { color: '#2b1b12', color2: '#f3d9b1' }), fx('grain', 0.6), fx('scanlines', 0.15), fx('vignette', 0.7)]);
  add('Visualizer', 'Minimal Wave', 'Clean white waveform on black', () => [
    solid('#0b0b0f'),
    viz('wave', { name: 'Waveform', width: 80, height: 22, y: 0.5, color: '#ffffff', color2: '#a78bfa', lineWidth: 0.45, glow: 5, sens: 1.3 }),
    TITLE({ y: 0.78, size: 5, weight: 300, spacing: 6 })]);
  add('Visualizer', 'Kaleido Trip', 'Psychedelic kaleidoscope plasma', () => [
    solid('#000000'),
    viz('plasma', { name: 'Plasma', width: 100, height: 100, y: 0.5, color: '#00e5ff', color2: '#7c3aed' }),
    viz('circlebars', { name: 'Ring', count: 60, radius: 12, length: 10, y: 0.5, color: '#ffffff', color2: '#fbcfe8', glow: 6, symmetric: true }),
    fx('kaleidoscope', 1, { segments: 8 }), fx('bloom', 0.5), TITLE({ y: 0.9, size: 4 })]);
  add('Visualizer', 'Fire & Embers', 'Burning bars with flying sparks', () => [
    bg('#1a0000', '#7a1200', 180), part('embers', { count: 90, color: '#ffd36e', color2: '#ff5a1a', glow: 6, size: 1.1 }),
    viz('bars', { name: 'Flames', count: 48, width: 100, height: 42, y: 0.76, color: '#ffe27a', color2: '#ff3b00', gap: 0.1, rounded: false, glow: 10, sens: 1.2 }),
    TITLE({ y: 0.28, size: 11, font: 'Impact', gradient: true, color: '#ffe27a', color2: '#ff3b00', glow: 8, glowColor: '#ff3b00' }),
    fx('lightleak', 0.25), fx('bloom', 0.5), fx('vignette', 0.7), fx('grain', 0.25)]);
  add('Visualizer', 'Aurora Chill', 'Soft spectrum and fireflies', () => [
    bg('#021a2b', '#3b0f5e', 200), part('fireflies', { count: 40, color: '#d9ffee', color2: '#c4b5fd', glow: 6 }),
    viz('spectrum', { name: 'Spectrum', count: 80, width: 100, height: 40, y: 0.78, color: '#7dffcf', color2: '#a78bfa', symmetric: true, glow: 6, opacity: 0.85 }),
    TITLE({ y: 0.28, size: 6, weight: 300, spacing: 8 }), ARTIST({ y: 0.36 }), fx('bloom', 0.35), fx('vignette', 0.5)]);
  add('Visualizer', 'Album Player', 'Streaming-app look with progress bar', () => [
    bg('#18181b', '#27272a', 160),
    shape('rect', { name: 'Cover placeholder', x: 0.3, y: 0.5, width: 36, height: 36, radius: 2, color: '#6d28d9', color2: '#db2777', gradient: true }),
    cover({ x: 0.3, y: 0.5, size: 36, shape: 'rounded' }),
    TITLE({ x: 0.74, y: 0.4, size: 5, upper: false, spacing: 0, align: 'left', maxWidth: 38 }), ARTIST({ x: 0.74, y: 0.49, size: 3, align: 'left', maxWidth: 38, color: '#a1a1aa', opacity: 1, upper: false, spacing: 0 }),
    viz('progressbar', { name: 'Progress', x: 0.74, y: 0.6, width: 38, lineWidth: 0.7, color: '#1db954', color2: '#52525b' }),
    viz('bars', { name: 'Mini bars', x: 0.74, y: 0.72, width: 38, height: 8, count: 28, color: '#1db954', color2: '#14532d', gap: 0.4, rounded: true }), fx('vignette', 0.4)]);

  /* ================= LYRICS ================= */
  add('Lyrics', 'Karaoke Classic', 'Words light up as they are sung', () => [
    bg('#1f1147', '#be185d', 200), part('twinkle', { count: 100, glow: 4 }),
    lyr({ anim: 'karaoke', color: '#ffffff', hiColor: '#facc15', size: 7.5, weight: 800, y: 0.5, maxWidth: 80, glow: 3, outline: 0.3 }),
    viz('spectrum', { name: 'Bottom spectrum', count: 64, width: 100, height: 18, y: 0.93, color: '#f9a8d4', color2: '#7c3aed', symmetric: true, opacity: 0.8 }), fx('vignette', 0.55)]);
  add('Lyrics', 'Kinetic Pop', 'Big bold words popping one by one', () => [
    bg('#ffdd00', '#ff4d6d', 160), part('confetti', { count: 60, size: 1.2, color: '#ffffff', color2: '#111111' }),
    lyr({ anim: 'wordpop', color: '#111111', hiColor: '#ffffff', font: 'Impact', size: 12, upper: true, y: 0.5, maxWidth: 86, dim: 0.12, weight: 900 }), fx('grain', 0.15)]);
  add('Lyrics', 'Typewriter Mono', 'Terminal-style typing', () => [
    solid('#0b0f0b'),
    lyr({ anim: 'typewriter', font: 'Menlo', weight: 400, size: 5.5, color: '#9dffb0', align: 'left', maxWidth: 66, y: 0.5, glow: 4, glowColor: '#22c55e' }),
    fx('scanlines', 0.4), fx('grain', 0.3), fx('vignette', 0.7)]);
  add('Lyrics', 'Neon Flicker', 'Buzzing neon sign', () => [
    bg('#05020a', '#1a0630', 180),
    lyr({ anim: 'flicker', color: '#ff7ad9', glow: 8, glowColor: '#ff2db3', font: 'Futura', size: 8.5, weight: 700, y: 0.5 }), fx('bloom', 0.5), fx('vignette', 0.7)]);
  add('Lyrics', 'Cinematic Subtitle', 'Film subtitles with letterbox', () => [
    bg('#0a0a0a', '#1a1612', 180), part('bokeh', { count: 20, color: '#ffd9a0', color2: '#ffb072', blend: 'screen' }),
    TITLE({ y: 0.44, size: 8, font: 'Didot', weight: 400, spacing: 14, animIn: 'fade', animDur: 1.4, end: 6, fade: 0.6 }),
    lyr({ anim: 'fade', font: 'Georgia', italic: true, size: 4.6, weight: 400, y: 0.82, maxWidth: 70, color: '#f5efe6', outline: 0.3 }),
    fx('letterbox', 0.7), fx('grade', 1, { sat: 0.9, contrast: 1.1 }), fx('grain', 0.3)]);
  add('Lyrics', 'Bouncy Letters', 'Every letter drops in with a bounce', () => [
    bg('#3b82f6', '#a855f7', 150), part('confetti', { count: 40, size: 1, color: '#ffffff', color2: '#fde047' }),
    lyr({ anim: 'bounce', font: 'Avenir Next', weight: 900, size: 9.5, color: '#ffffff', y: 0.5, maxWidth: 82, outline: 0.4, outlineColor: '#4c1d95' })]);
  add('Lyrics', 'Glitch Lyrics', 'Digital glitch-in on every line', () => [
    solid('#000000'), lyr({ anim: 'glitch', font: 'Impact', upper: true, size: 10.5, color: '#ffffff', y: 0.5 }),
    beat('rgbsplit', 0.6), beat('glitch', 0.6), fx('scanlines', 0.4)]);
  add('Lyrics', 'Stacked Lines', 'Previous \u00b7 current \u00b7 next, elegant fade', () => [
    bg('#0f172a', '#1e293b', 160), part('twinkle', { count: 40, size: 0.6 }),
    lyr({ mode: 'stack', anim: 'pop', size: 6, dim: 0.3, y: 0.5, weight: 700 }), fx('vignette', 0.5)]);
  add('Lyrics', 'Gradient Wave', 'Wavy colour-shifting letters', () => [
    bg('#0d0221', '#ff0080', 200),
    lyr({ anim: 'wave', color: '#7cf9ff', hiColor: '#ff7ad9', size: 9.5, weight: 900, y: 0.5, maxWidth: 82 }), fx('bloom', 0.35)]);
  add('Lyrics', 'Arabic Elegant', 'Right-to-left gold karaoke', () => [
    bg('#0b1224', '#1b2a4a', 170), part('twinkle', { count: 70, color: '#ffd166', glow: 4 }),
    TITLE({ y: 0.13, size: 4, font: 'Geeza Pro', color: '#ffd166', upper: false, spacing: 0 }),
    lyr({ anim: 'karaoke', font: 'Geeza Pro', size: 8, weight: 700, color: '#f5e6c8', hiColor: '#ffd166', y: 0.5, maxWidth: 80, glow: 3, glowColor: '#ffd166' }), fx('vignette', 0.55)]);
  add('Lyrics', 'Pill Captions', 'Short-video style highlighted captions', () => [
    bg('#111827', '#4338ca', 170),
    TITLE({ y: 0.12, size: 5 }),
    viz('mirror', { name: 'Bars', count: 30, width: 70, height: 14, y: 0.38, color: '#facc15', color2: '#f472b6', gap: 0.35, rounded: true, symmetric: true }),
    lyr({ anim: 'wordpop', font: 'Avenir Next', weight: 800, size: 6.5, color: '#111827', hiColor: '#111827', boxOpacity: 0.95, boxColor: '#facc15', boxPad: 1.4, y: 0.72, maxWidth: 80, dim: 0.0 })], '9:16');
  add('Lyrics', 'Reels Karaoke', 'Vertical karaoke with progress waveform', () => [
    bg('#0f172a', '#7c3aed', 170),
    TITLE({ y: 0.1, size: 4.6 }), ARTIST({ y: 0.145, size: 2.6 }),
    lyr({ anim: 'karaoke', size: 7, color: '#ffffff', hiColor: '#22d3ee', outline: 0.3, y: 0.5, maxWidth: 84, weight: 800 }),
    viz('waveprogress', { name: 'Progress waveform', count: 60, width: 80, height: 7, y: 0.9, color: '#22d3ee', color2: '#ffffff', gap: 0.4, rounded: true }), fx('vignette', 0.45)], '9:16');

  /* ================= SOCIAL / VERTICAL ================= */
  add('Social', 'Shorts Neon', 'Vertical neon ring + title + lyrics', () => [
    bg('#0a0221', '#5b21b6', 170),
    viz('circlebars', { name: 'Ring', count: 70, radius: 22, length: 16, y: 0.36, color: '#22d3ee', color2: '#e879f9', glow: 8, symmetric: true }),
    cover({ y: 0.36, size: 40 }),
    TITLE({ y: 0.64, size: 8, maxWidth: 86, glow: 4 }), ARTIST({ y: 0.7 }),
    lyr({ anim: 'pop', size: 5, y: 0.82, maxWidth: 84 }), fx('bloom', 0.4), fx('vignette', 0.5)], '9:16');
  add('Social', 'Reels Bars', 'Tall mirrored bars with a bold title', () => [
    bg('#111111', '#2a2a2a', 170),
    viz('mirror', { name: 'Mirror bars', count: 28, width: 88, height: 36, y: 0.5, color: '#ff2e93', color2: '#facc15', gap: 0.3, rounded: true, symmetric: true, glow: 6 }),
    TITLE({ y: 0.18, size: 9, maxWidth: 86, font: 'Impact' }), ARTIST({ y: 0.26 }), beat('zoom', 0.3, { reactBand: 'bass' })], '9:16');
  add('Social', 'Square Vinyl', 'Instagram square with spinning record', () => [
    bg('#1c1917', '#44403c', 150), viz('vinyl', { name: 'Vinyl', y: 0.43, radius: 30, color: '#f97316', color2: '#be123c' }),
    TITLE({ y: 0.85, size: 7, upper: false, spacing: 0 }), ARTIST({ y: 0.93, size: 3.4 }), fx('grain', 0.3), fx('vignette', 0.55)], '1:1');
  add('Social', 'Story Waveform', 'Story-size waveform with progress', () => [
    bg('#0b1220', '#1e3a8a', 170),
    TITLE({ y: 0.36, size: 8, maxWidth: 86 }), ARTIST({ y: 0.42 }),
    viz('waveprogress', { name: 'Waveform', count: 56, width: 84, height: 14, y: 0.56, color: '#38bdf8', color2: '#94a3b8', gap: 0.4, rounded: true }),
    viz('progressbar', { name: 'Progress', y: 0.66, width: 84, lineWidth: 0.5, color: '#38bdf8', color2: '#475569' }), fx('vignette', 0.5)], '9:16');

  VZ.TEMPLATE_LIST = LIST;
  VZ.TEMPLATE_CATS = ['Visualizer', 'Lyrics', 'Social'];
  VZ.TEMPLATES = {}; // name -> build (compat)
  LIST.forEach((t) => { VZ.TEMPLATES[t.name] = t.build; });
  VZ.SAMPLE_LINES = [
    { t0: 0.5, t1: 6, text: 'Feel the music in your soul', words: [0.5, 1.1, 1.8, 2.4, 2.9, 3.6].map((t0, i) => ({ t0, t1: t0 + 0.55, text: ['Feel', 'the', 'music', 'in', 'your', 'soul'][i] })) },
    { t0: 6.2, t1: 10, text: 'Let it carry you home', words: [] },
  ];
  VZ.DEFAULT_META = { title: 'Song Title', artist: 'Artist Name' };
})(typeof window !== 'undefined' ? window : globalThis);
