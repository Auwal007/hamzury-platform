// upload checks: the contents must match the file type, archives must be safe, and (when required) a scanner must pass it.
import zlib from 'node:zlib';
import { HttpError } from './http.js';

export const MAX_UPLOAD = 25 * 1024 * 1024;
export const ALLOWED_UPLOADS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.zip', '.txt', '.csv'];
const RISKY = ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.js', '.vbs', '.sh', '.com', '.scr'];

export const extOf = name => { const m = /(\.[^./\\]+)$/.exec(String(name)); return m ? m[1].toLowerCase() : ''; };
export const baseName = (name, fallback) => (String(name || '').split(/[\\/]/).pop() || fallback).slice(0, 120);

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = zlib.crc32 || (buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; });

function validPng(d) {
  if (d.length < 33 || !d.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let p = 8, first = true;
  while (p + 12 <= d.length) {
    const len = d.readUInt32BE(p), type = d.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > d.length) return false;
    if (first) {
      if (type !== 'IHDR' || len !== 13) return false;
      const w = d.readUInt32BE(p + 8), h = d.readUInt32BE(p + 12);
      if (!w || !h || w * h > 40_000_000) return false;
      first = false;
    }
    if (crc32(d.subarray(p + 4, p + 8 + len)) !== d.readUInt32BE(p + 8 + len)) return false;
    if (type === 'IEND') return true;
    p += 12 + len;
  }
  return false;
}

function validJpeg(d) {
  if (d.length < 4 || d[0] !== 0xFF || d[1] !== 0xD8) return false;
  let p = 2;
  while (p + 4 <= d.length) {
    if (d[p] !== 0xFF) return false;
    const marker = d[p + 1];
    if (marker === 0xFF) { p++; continue; }
    if (marker === 0xD9 || marker === 0xDA) return false;  // image data before any size: not a real jpeg
    const len = d.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > d.length) return false;
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      if (len < 7) return false;
      const h = d.readUInt16BE(p + 5), w = d.readUInt16BE(p + 7);
      return w > 0 && h > 0 && w * h <= 40_000_000;
    }
    p += 2 + len;
  }
  return false;
}

// reads a zip's central directory and checks every entry, like zipfile + testzip
function validZip(d, ext) {
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) if (d.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return false;
  const count = d.readUInt16LE(eocd + 10), cdOffset = d.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || cdOffset === 0xFFFFFFFF || count > 2000) return false;
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > d.length || d.readUInt32LE(p) !== 0x02014b50) return false;
    const nameLen = d.readUInt16LE(p + 28), extraLen = d.readUInt16LE(p + 30), commentLen = d.readUInt16LE(p + 32);
    entries.push({ flags: d.readUInt16LE(p + 8), method: d.readUInt16LE(p + 10), crc: d.readUInt32LE(p + 16), csize: d.readUInt32LE(p + 20),
      size: d.readUInt32LE(p + 24), attr: d.readUInt32LE(p + 38), offset: d.readUInt32LE(p + 42), name: d.toString('utf8', p + 46, p + 46 + nameLen) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.reduce((s, e) => s + e.size, 0) > 100 * 1024 * 1024) return false;
  for (const e of entries) {
    const parts = e.name.replace(/\\/g, '/').split('/');
    if ((e.flags & 1) || e.name.startsWith('/') || e.name.startsWith('\\') || parts.includes('..') || e.name.includes(':')
        || ((e.attr >>> 16) & 0o170000) === 0o120000 || RISKY.includes(extOf(e.name)) || e.name.toLowerCase().includes('vbaproject.bin')) return false;
  }
  const required = { '.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml' }[ext];
  const names = new Set(entries.map(e => e.name));
  if (required && !(names.has(required) && names.has('[Content_Types].xml'))) return false;
  for (const e of entries) {  // testzip: every entry must decompress to its recorded checksum
    if (e.offset + 30 > d.length || d.readUInt32LE(e.offset) !== 0x04034b50) return false;
    const start = e.offset + 30 + d.readUInt16LE(e.offset + 26) + d.readUInt16LE(e.offset + 28);
    const raw = d.subarray(start, start + e.csize);
    if (raw.length !== e.csize) return false;
    let out;
    if (e.method === 0) out = raw;
    else if (e.method === 8) { try { out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(e.size, 1) }); } catch { return false; } }
    else return false;
    if (out.length !== e.size || crc32(out) >>> 0 !== e.crc) return false;
  }
  return true;
}

function validText(d) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(d); } catch { return false; }
  for (const ch of text) { const c = ch.charCodeAt(0); if (c === 0 || (c < 32 && !'\t\r\n'.includes(ch))) return false; }
  return true;
}

export async function validateUpload(cfg, name, data) {
  const ext = extOf(name);
  if (!ALLOWED_UPLOADS.includes(ext) || !data || !data.length || data.length > MAX_UPLOAD) throw new HttpError(400, 'choose a supported, non-empty file of 25 mb or less');
  let valid;
  if (ext === '.pdf') valid = data.subarray(0, 5).toString('latin1') === '%PDF-';
  else if (ext === '.png') valid = validPng(data);
  else if (ext === '.jpg' || ext === '.jpeg') valid = validJpeg(data);
  else if (['.doc', '.xls', '.ppt'].includes(ext)) valid = data.subarray(0, 8).equals(Buffer.from('D0CF11E0A1B11AE1', 'hex'));
  else if (['.docx', '.xlsx', '.pptx', '.zip'].includes(ext)) { try { valid = validZip(data, ext); } catch { valid = false; } }
  else valid = validText(data);
  if (!valid) throw new HttpError(400, 'file contents do not match the type, or the archive contains unsafe content');
  if (cfg.requireScan) await scan(cfg, name, data);
}

// a scanning service you run or subscribe to: it receives the file and answers {"clean": true|false}. it fails closed.
async function scan(cfg, name, data) {
  if (!cfg.scanUrl) throw new HttpError(503, 'file security scanner is unavailable. please try later');
  let res;
  try {
    const r = await fetch(cfg.scanUrl, { method: 'POST', body: data, signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), ...(cfg.scanToken ? { authorization: 'Bearer ' + cfg.scanToken } : {}) } });
    res = r.ok ? await r.json() : null;
  } catch { res = null; }
  if (!res || typeof res.clean !== 'boolean') throw new HttpError(503, 'file security scanner is unavailable. please try later');
  if (!res.clean) throw new HttpError(400, 'file failed the security scan');
}
