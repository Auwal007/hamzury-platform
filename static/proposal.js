/* hamzury proposal renderer: draws the proposal card, an image clients save to their phone.
   the full proposal page and its pdf come from proposal-doc.js. */
(function () {
  const C = { milk: '#f8f3eb', white: '#ffffff', ink: '#1d2433', ink2: '#3d4657', slate: '#586779', line: '#e6ddd1', choc: '#3b241a', bronze: '#b99770', done: '#1e7b4f' };
  const F = (w, px) => `${w} ${px}px "Inter", Arial, sans-serif`;
  const cap = t => { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const LOGO = (document.currentScript && document.currentScript.src || '').replace(/proposal\.js.*$/, 'img/hamzury.png');

  let logoP = null;
  function logo() {
    if (!logoP) logoP = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = LOGO; });
    return logoP;
  }
  async function ready() {
    try { await Promise.all([document.fonts.load(F(700, 40)), document.fonts.load(F(400, 40)), document.fonts.load(F(600, 40))]); } catch (e) { /* system font */ }
    return logo();
  }

  function wrap(ctx, text, maxW) {
    const out = [];
    String(text || '').split('\n').forEach(para => {
      const words = para.split(/\s+/).filter(Boolean); let line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(w => { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; });
      if (line) out.push(line);
    });
    return out;
  }
  // draw wrapped text, returns new y. maxLines trims with an ellipsis.
  function text(ctx, s, x, y, maxW, font, color, lh, maxLines) {
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
    let lines = wrap(ctx, s, maxW);
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '...'; }
    lines.forEach((l, k) => ctx.fillText(l, x, y + k * lh));
    return y + lines.length * lh;
  }
  function rule(ctx, W) { ctx.fillStyle = C.bronze; ctx.fillRect(0, 0, W * 0.23, 12); ctx.fillStyle = C.choc; ctx.fillRect(W * 0.23, 0, W, 12); }
  function hr(ctx, x, y, w) { ctx.fillStyle = C.line; ctx.fillRect(x, y, w, 2); }
  function journey(ctx, x, y, w, here) {
    const steps = ['Awareness', 'Strategy', 'Structure', 'Systems', 'Success'], gap = w / (steps.length - 1);
    ctx.fillStyle = C.line; ctx.fillRect(x, y - 1, w, 3);
    ctx.fillStyle = C.choc; ctx.fillRect(x, y - 1, gap * here, 3);
    steps.forEach((s, k) => {
      const cx = x + gap * k; ctx.beginPath(); ctx.arc(cx, y, k === here ? 13 : 9, 0, Math.PI * 2);
      ctx.fillStyle = k <= here ? C.choc : C.white; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = k <= here ? C.choc : C.line; ctx.stroke();
      ctx.font = F(k === here ? 700 : 500, 24); ctx.fillStyle = k === here ? C.choc : C.slate; ctx.textAlign = k === 0 ? 'left' : k === steps.length - 1 ? 'right' : 'center';
      ctx.fillText(s, cx, y + 50); ctx.textAlign = 'left';
    });
    ctx.font = F(600, 22); ctx.fillStyle = C.choc; ctx.textAlign = here === 0 ? 'left' : 'center';
    ctx.fillText('You are here', x + gap * here, y - 28); ctx.textAlign = 'left';
  }
  function canvas(W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d'); ctx.fillStyle = C.milk; ctx.fillRect(0, 0, W, H); return [c, ctx]; }

  /* ---------- the card: 1080 x 1350, made to be kept ---------- */
  async function card(d) {
    const img = await ready();
    const W = 1080, H = 1350, M = 84, CW = W - M * 2;
    const [cv, ctx] = canvas(W, H);
    rule(ctx, W);
    if (img) ctx.drawImage(img, M, 78, 220, 220 * img.height / img.width);
    ctx.font = F(600, 24); ctx.fillStyle = C.slate; ctx.textAlign = 'right'; ctx.fillText(d.date, W - M, 104); ctx.textAlign = 'left';
    let y = 220;
    ctx.font = F(600, 28); ctx.fillStyle = C.choc; ctx.fillText('My success journey', M, y); y += 78;
    y = text(ctx, `${cap(d.first)}, you took the first step.`, M, y, CW, F(700, 70), C.ink, 80, 3) + 14;
    y = text(ctx, `You stopped, looked honestly at ${d.business || 'your business'} and asked for a clear way forward. That is how growth starts, and we are proud to build it with you.`, M, y, CW, F(400, 33), C.ink2, 48, 4) + 34;
    hr(ctx, M, y, CW); y += 58;
    ctx.font = F(600, 24); ctx.fillStyle = C.slate; ctx.fillText('Our recommendation', M, y); y += 46;
    y = text(ctx, d.advice, M, y, CW, F(500, 32), C.ink, 46, Math.max(2, Math.floor((960 - y) / 46))) + 34;
    ctx.font = F(600, 24); ctx.fillStyle = C.slate; ctx.fillText('Your next step', M, y); y += 46;
    text(ctx, 'Open your roadmap and begin with the first level.', M, y, CW, F(500, 32), C.choc, 46, 2);
    journey(ctx, M + 10, 1150, CW - 20, 1);
    hr(ctx, M, 1238, CW);
    ctx.font = F(700, 26); ctx.fillStyle = C.ink; ctx.fillText(d.ref, M, 1288);
    ctx.font = F(500, 24); ctx.fillStyle = C.slate; ctx.textAlign = 'right'; ctx.fillText('Track it at hamzury.com', W - M, 1288); ctx.textAlign = 'left';
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }

  // save or share a blob: phones get the share sheet (save image / save to files), others a download.
  async function save(blob, filename, title) {
    const file = new File([blob], filename, { type: blob.type });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return 'shared'; } } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloaded';
  }

  window.HZProposal = { card, save, cap };
})();
