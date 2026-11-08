/* hamzury proposal renderer: draws the proposal card (an image clients save to their phone) and the
   full proposal + roadmap pdf, in the browser, from one data object. no libraries, no server. */
(function () {
  const C = { milk: '#f8f3eb', white: '#ffffff', ink: '#1d2433', ink2: '#3d4657', slate: '#586779', line: '#e6ddd1', choc: '#3b241a', bronze: '#b99770', done: '#1e7b4f' };
  const VC = { bizdoc: '#18875b', medialy: '#c63645', subt: '#2466bf', iotics: '#e4b329', hub: '#14233b', iwiin: '#8acb62' };
  const F = (w, px) => `${w} ${px}px "Inter", Arial, sans-serif`;
  const naira = m => '₦' + new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format((m || 0) / 100);
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
    const steps = ['awareness', 'strategy', 'structure', 'systems', 'success'], gap = w / (steps.length - 1);
    ctx.fillStyle = C.line; ctx.fillRect(x, y - 1, w, 3);
    ctx.fillStyle = C.choc; ctx.fillRect(x, y - 1, gap * here, 3);
    steps.forEach((s, k) => {
      const cx = x + gap * k; ctx.beginPath(); ctx.arc(cx, y, k === here ? 13 : 9, 0, Math.PI * 2);
      ctx.fillStyle = k <= here ? C.choc : C.white; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = k <= here ? C.choc : C.line; ctx.stroke();
      ctx.font = F(k === here ? 700 : 500, 24); ctx.fillStyle = k === here ? C.choc : C.slate; ctx.textAlign = k === 0 ? 'left' : k === steps.length - 1 ? 'right' : 'center';
      ctx.fillText(s, cx, y + 50); ctx.textAlign = 'left';
    });
    ctx.font = F(600, 22); ctx.fillStyle = C.choc; ctx.textAlign = here === 0 ? 'left' : 'center';
    ctx.fillText('you are here', x + gap * here, y - 28); ctx.textAlign = 'left';
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
    ctx.font = F(600, 28); ctx.fillStyle = C.choc; ctx.fillText('my success journey', M, y); y += 78;
    y = text(ctx, `${d.first}, you took the first step.`, M, y, CW, F(700, 70), C.ink, 80, 3) + 14;
    y = text(ctx, `you stopped, looked honestly at ${d.business || 'your business'} and asked for a clear way forward. that is how growth starts, and we are proud to build it with you.`, M, y, CW, F(400, 33), C.ink2, 48, 4) + 34;
    hr(ctx, M, y, CW); y += 58;
    ctx.font = F(600, 24); ctx.fillStyle = C.slate; ctx.fillText('our recommendation', M, y); y += 46;
    y = text(ctx, d.advice, M, y, CW, F(500, 32), C.ink, 46, Math.max(2, Math.floor((960 - y) / 46))) + 34;
    ctx.font = F(600, 24); ctx.fillStyle = C.slate; ctx.fillText('your next step', M, y); y += 46;
    text(ctx, 'open your roadmap and begin with the first level.', M, y, CW, F(500, 32), C.choc, 46, 2);
    journey(ctx, M + 10, 1150, CW - 20, 1);
    hr(ctx, M, 1238, CW);
    ctx.font = F(700, 26); ctx.fillStyle = C.ink; ctx.fillText(d.ref, M, 1288);
    ctx.font = F(500, 24); ctx.fillStyle = C.slate; ctx.textAlign = 'right'; ctx.fillText('track it at hamzury.com', W - M, 1288); ctx.textAlign = 'left';
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }

  /* ---------- the pdf: a4 pages drawn at 150 dpi ---------- */
  async function pdf(d) {
    const img = await ready();
    const W = 1240, H = 1754, M = 110, CW = W - M * 2, BOTTOM = H - 135;
    const pages = []; let cv, ctx, y;
    const footer = n => { hr(ctx, M, H - 110, CW); ctx.font = F(500, 22); ctx.fillStyle = C.slate; ctx.fillText(`hamzury · proposal for ${d.business || d.name} · ${d.ref}`, M, H - 68); ctx.textAlign = 'right'; ctx.fillText('page ' + n, W - M, H - 68); ctx.textAlign = 'left'; };
    const page = () => { if (cv) { footer(pages.length + 1); pages.push(cv); } [cv, ctx] = canvas(W, H); rule(ctx, W); if (img) ctx.drawImage(img, M, 70, 190, 190 * img.height / img.width); y = 200; };
    const need = h => { if (y + h > BOTTOM) page(); };
    const label = s => { need(90); ctx.font = F(600, 24); ctx.fillStyle = C.choc; ctx.fillText(s, M, y); y += 44; };
    const para = (s, font = F(400, 27), color = C.ink2, lh = 39) => {
      ctx.font = font; wrap(ctx, s, CW).forEach(l => { need(lh); ctx.font = font; ctx.fillStyle = color; ctx.fillText(l, M, y); y += lh; }); y += 10;
    };
    page();
    ctx.font = F(600, 24); ctx.fillStyle = C.slate; ctx.textAlign = 'right'; ctx.fillText(d.date + ' · ' + d.ref, W - M, 100); ctx.textAlign = 'left';
    ctx.font = F(600, 26); ctx.fillStyle = C.choc; ctx.fillText('proposal for ' + (d.business || d.name), M, y); y += 76;
    para(`${d.first}, you took the first step.`, F(700, 60), C.ink, 70); y += 6;
    para(`you stopped, looked honestly at ${d.business || 'your business'} and asked for a clear way forward. that is how growth starts. this proposal is built only on what you told us, and we are proud to build it with you.`, F(400, 30), C.ink2, 46);
    y += 14; journey(ctx, M + 10, y + 46, CW - 20, 1); y += 130; hr(ctx, M, y, CW); y += 56;
    label('our recommendation'); para(d.advice, F(500, 30), C.ink, 45); y += 18;
    label('how we work with you'); d.promises.forEach(s => para(s, F(400, 27), C.ink2, 40)); y += 12;
    if (d.management) { label('after delivery'); para(d.management); }
    // roadmap: the journey, no prices
    page();
    ctx.font = F(600, 26); ctx.fillStyle = C.choc; ctx.fillText('your journey to scale', M, y); y += 76;
    para(`this is the journey we recommend for ${d.business || 'your business'}. implemented in order, each level builds on the one before it, so the business grows on solid ground. begin with level one at hamzury.com, using your id ${d.ref}.`, F(400, 28), C.ink2, 42); y += 40;
    d.levels.forEach((lv, k) => {
      need(130);
      ctx.beginPath(); ctx.arc(M + 26, y - 12, 26, 0, Math.PI * 2); ctx.fillStyle = C.choc; ctx.fill();
      ctx.font = F(700, 25); ctx.fillStyle = C.white; ctx.textAlign = 'center'; ctx.fillText(String(k + 1), M + 26, y - 3); ctx.textAlign = 'left';
      ctx.font = F(700, 38); ctx.fillStyle = C.ink; ctx.fillText(lv.name, M + 76, y); y += 40;
      ctx.font = F(400, 25); ctx.fillStyle = C.slate; ctx.fillText(lv.meaning, M + 76, y); y += 30;
      lv.items.forEach(it => {
        ctx.font = F(400, 23); const why = it.why ? wrap(ctx, it.why, CW - 100).slice(0, 2) : [];
        need(56 + why.length * 30); hr(ctx, M + 76, y, CW - 76); y += 40;
        ctx.fillStyle = VC[it.venture] || C.slate; ctx.fillRect(M + 76, y - 18, 12, 12);
        ctx.font = F(600, 28); ctx.fillStyle = C.ink; ctx.fillText(wrap(ctx, it.name, CW - 300)[0], M + 100, y);
        ctx.font = F(500, 22); ctx.fillStyle = C.slate; ctx.textAlign = 'right'; ctx.fillText(it.vname, W - M, y); ctx.textAlign = 'left';
        ctx.font = F(400, 23); ctx.fillStyle = C.ink2; why.forEach(l => { y += 30; ctx.fillText(l, M + 100, y); });
        y += 8;
      });
      y += 54;
    });
    footer(pages.length + 1); pages.push(cv);
    return pagesToPdf(pages);
  }

  function pagesToPdf(pages) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); len += u.length; };
    const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
    const n = pages.length, kids = pages.map((_, k) => `${3 + k * 3} 0 R`).join(' ');
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
    pages.forEach((cv, k) => {
      const pg = 3 + k * 3, im = pg + 1, ct = pg + 2;
      const bin = atob(cv.toDataURL('image/jpeg', 0.9).split(',')[1]); const jpg = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
      const content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
      obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
      obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream'); });
      obj(ct, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    });
    const total = 3 + n * 3, xref = len;
    push(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
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

  window.HZProposal = { card, pdf, save };
})();
