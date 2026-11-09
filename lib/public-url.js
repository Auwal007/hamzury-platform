// One public origin for client messages, WhatsApp templates and payment returns.
export function publicBaseUrl(env) {
  const value = (env.HAMZURY_PUBLIC_BASE_URL || '').trim();
  const hosted = env.HAMZURY_ENV === 'production' || (env.VERCEL === '1' && env.VERCEL_ENV !== 'development');
  const message = 'HAMZURY_PUBLIC_BASE_URL must be an HTTP(S) website origin, e.g. https://www.hamzury.com';
  let url;
  if (value) {
    try { url = new URL(value); } catch { throw new Error(message); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(message);
    }
  }
  const hostname = url?.hostname.toLowerCase().replace(/\.$/, '');
  const local = hostname === 'localhost' || hostname?.endsWith('.localhost') || /^127\./.test(hostname || '')
    || ['0.0.0.0', '[::1]', '[::]'].includes(hostname);
  if (hosted && (!url || url.protocol !== 'https:' || local)) {
    throw new Error('deployed links require HAMZURY_PUBLIC_BASE_URL to be a public HTTPS website, e.g. https://www.hamzury.com; localhost is only for local development');
  }
  return url?.origin || '';
}
