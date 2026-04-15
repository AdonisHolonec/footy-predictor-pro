// api/footy-predictor.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// forÈ›eazÄƒ Node 20 pe Vercel
export const config = { runtime: 'nodejs' };

const allowed = (process.env.FOOTY_ALLOWED_PATHS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const path = String(req.query.path || '');
    if (!path.startsWith('/')) {
      res.status(400).json({ error: "Query `path` is required and must start with '/'" });
      return;
    }
    if (allowed.length && !allowed.includes(path)) {
      res.status(403).json({ error: 'path_not_allowed', path, allowed });
      return;
    }

    const qs = new URLSearchParams(req.query as any);
    qs.delete('path');

    const base = process.env.UPSTREAM_BASE_URL || 'https://api-football-v1.p.rapidapi.com';
    const url = `${base}${path}${qs.toString() ? `?${qs.toString()}` : ''}`;

    const rapidKey =
      process.env.X_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY || '';
    const rapidHost =
      process.env.X_RAPIDAPI_HOST || process.env.RAPIDAPI_HOST || '';

    if (!rapidKey) {
      res.status(500).json({ error: 'missing_rapidapi_key' });
      return;
    }
    if (!rapidHost) {
      res.status(500).json({ error: 'missing_rapidapi_host' });
      return;
    }

    const controller = new AbortController();
    const timeout = Number(process.env.UPSTREAM_TIMEOUT_MS || 5000);
    const tm = setTimeout(() => controller.abort(new Error('timeout')), timeout);

    const r = await fetch(url, {
      headers: {
        'x-rapidapi-key': rapidKey,
        'x-rapidapi-host': rapidHost,
        'accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(tm);

    const ct = r.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await r.json()
      : { preview: await r.text() };

    res.status(r.status).json(body);
  } catch (err: any) {
    console.error('footy-predictor error', {
      message: err?.message,
      stack: err?.stack,
    });
    res.status(500).json({ error: 'function_crashed', message: err?.message });
  }
}
