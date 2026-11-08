// a small http layer: routes, errors, input validation (same error shapes the pages already read), cookies.

export class HttpError extends Error {
  constructor(status, detail) { super(typeof detail === 'string' ? detail : 'request failed'); this.status = status; this.detail = detail; }
}
export const fail = (status, detail) => { throw new HttpError(status, detail); };

// ---------------------------------------------------------------- validation
// each field is a function (value, present) -> value, throwing a Problem. the error list matches fastapi's 422 detail.
class Problem extends Error { constructor(msg, type = 'value_error') { super(msg); this.type = type; } }
const MISSING = Symbol('missing');

export const f = {
  str: (spec = {}) => v => {
    if (v === MISSING) { if (spec.default !== undefined) return spec.default; throw new Problem('Field required', 'missing'); }
    if (v === null && spec.nullable) return null;
    if (typeof v !== 'string') throw new Problem('Input should be a valid string', 'string_type');
    if (spec.min !== undefined && v.length < spec.min) throw new Problem(`String should have at least ${spec.min} characters`, 'string_too_short');
    if (spec.max !== undefined && v.length > spec.max) throw new Problem(`String should have at most ${spec.max} characters`, 'string_too_long');
    if (spec.pattern && !spec.pattern.test(v)) throw new Problem(`String should match pattern '${spec.pattern.source}'`, 'string_pattern_mismatch');
    return v;
  },
  int: (spec = {}) => v => {
    if (v === MISSING) { if (spec.default !== undefined) return spec.default; throw new Problem('Field required', 'missing'); }
    if (v === null && spec.nullable) return null;
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) v = Number(v);
    if (typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) === v && typeof v !== 'boolean') {
      if (spec.ge !== undefined && v < spec.ge) throw new Problem(`Input should be greater than or equal to ${spec.ge}`, 'greater_than_equal');
      if (spec.gt !== undefined && v <= spec.gt) throw new Problem(`Input should be greater than ${spec.gt}`, 'greater_than');
      if (spec.le !== undefined && v > spec.le) throw new Problem(`Input should be less than or equal to ${spec.le}`, 'less_than_equal');
      return v;
    }
    throw new Problem('Input should be a valid integer', 'int_type');
  },
  bool: (spec = {}) => v => {
    if (v === MISSING) { if (spec.default !== undefined) return spec.default; throw new Problem('Field required', 'missing'); }
    if (typeof v === 'boolean') return v;
    if (v === 0 || v === 1) return Boolean(v);
    if (typeof v === 'string' && ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(v.toLowerCase())) return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
    throw new Problem('Input should be a valid boolean', 'bool_type');
  },
  oneOf: (values, spec = {}) => v => {
    if (v === MISSING) { if (spec.default !== undefined) return spec.default; throw new Problem('Field required', 'missing'); }
    if (v === null && spec.nullable) return null;
    if (!values.includes(v)) throw new Problem(`Input should be ${values.map(x => `'${x}'`).join(', ')}`, 'literal_error');
    return v;
  },
  list: (item, spec = {}) => v => {
    if (v === MISSING) { if (spec.default !== undefined) return structuredClone(spec.default); throw new Problem('Field required', 'missing'); }
    if (!Array.isArray(v)) throw new Problem('Input should be a valid list', 'list_type');
    if (spec.min !== undefined && v.length < spec.min) throw new Problem(`List should have at least ${spec.min} items`, 'too_short');
    if (spec.max !== undefined && v.length > spec.max) throw new Problem(`List should have at most ${spec.max} items`, 'too_long');
    return v.map(x => item(x));
  },
  dict: (value, spec = {}) => v => {
    if (v === MISSING) { if (spec.default !== undefined) return { ...spec.default }; throw new Problem('Field required', 'missing'); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Problem('Input should be a valid dictionary', 'dict_type');
    const keys = Object.keys(v);
    if (spec.max !== undefined && keys.length > spec.max) throw new Problem(`Dictionary should have at most ${spec.max} items`, 'too_long');
    return Object.fromEntries(keys.map(k => [k, value(v[k])]));
  },
  any: () => v => (v === MISSING ? undefined : v),
  model: fields => v => validate(fields, v),
};
f.strOrList = () => v => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.every(x => typeof x === 'string')) return v;
  throw new Problem('Input should be a valid string or list of strings', 'string_type');
};

// validate an object against a field map. returns the clean object plus a hidden set of keys the caller sent.
export function validate(fields, body, loc = ['body']) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(422, [{ type: 'model_attributes_type', loc, msg: 'Input should be a valid dictionary or object', input: body ?? null }]);
  }
  const out = {}, errors = [];
  for (const [k, check] of Object.entries(fields)) {
    try {
      const val = check(Object.hasOwn(body, k) ? body[k] : MISSING);
      if (val !== undefined) out[k] = val;
    } catch (e) {
      if (e instanceof HttpError && Array.isArray(e.detail)) errors.push(...e.detail.map(d => ({ ...d, loc: [...loc, k, ...d.loc.slice(1)] })));
      else if (e instanceof Problem) errors.push({ type: e.type, loc: [...loc, k], msg: e.message, input: body[k] ?? null });
      else throw e;
    }
  }
  if (errors.length) throw new HttpError(422, errors);
  Object.defineProperty(out, '__sent', { value: new Set(Object.keys(body).filter(k => k in fields)), enumerable: false });
  return out;
}

// ---------------------------------------------------------------- cookies
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

export function cookie(name, value, { maxAge, httpOnly = true, secure = false, sameSite = 'Lax', path = '/' } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge !== undefined) s += `; Max-Age=${maxAge}`;
  if (httpOnly) s += '; HttpOnly';
  if (secure) s += '; Secure';
  return s;
}
export const clearCookie = name => `${name}=""; Path=/; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;

// ---------------------------------------------------------------- router
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  match(method, path) {
    let allowed = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) { allowed = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
      return { handler: r.handler, params };
    }
    return allowed ? 'method' : null;
  }
}

// an integer path parameter, as fastapi checked them
export function intParam(v, name) {
  if (!/^-?\d+$/.test(String(v))) fail(422, [{ type: 'int_parsing', loc: ['path', name], msg: 'Input should be a valid integer, unable to parse string as an integer', input: v }]);
  return Number(v);
}

// a reply that is not plain json: redirects, files, text
export class Reply {
  constructor(status, headers = {}, body = '') { this.status = status; this.headers = headers; this.body = body; }
  static redirect(location, status = 302) { return new Reply(status, { location }); }
}
