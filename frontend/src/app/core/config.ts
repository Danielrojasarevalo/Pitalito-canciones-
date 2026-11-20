/**
 * URL del backend: siempre el mismo origen de la página.
 * - En desarrollo, el servidor de Angular reenvía /api, /ws y /media a Django (proxy.conf.json).
 * - En producción lo hace Nginx.
 * - Se puede forzar con window.ROCOLA_API = 'https://api.midominio.com' en index.html.
 */
const w = window as unknown as { ROCOLA_API?: string };
export const API_BASE: string = w.ROCOLA_API ?? location.origin;

export const API = `${API_BASE}/api`;

export function mediaUrl(path?: string | null): string {
  if (!path) return '';
  return /^https?:/.test(path) ? path : API_BASE + path;
}

export function wsUrl(slug: string): string {
  return `${API_BASE.replace(/^http/, 'ws')}/ws/rocola/${slug}/`;
}

/**
 * Dirección que los celulares pueden abrir. Si el panel se abrió con "localhost",
 * se pregunta al backend la IP del PC y se usa con nip.io (ej. 192-168-1-11.nip.io).
 */
let originCache: Promise<string> | null = null;
export function publicOrigin(): Promise<string> {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return Promise.resolve(location.origin);
  originCache ??= fetch(`${API}/public/server-info/`)
    .then((r) => r.json())
    .then((d: { lan_ip?: string }) =>
      d.lan_ip ? `${location.protocol}//${d.lan_ip.replaceAll('.', '-')}.nip.io${location.port ? ':' + location.port : ''}` : location.origin,
    )
    .catch(() => location.origin);
  return originCache;
}

/** Enlace que abre la página del cliente (lo que va dentro del QR). */
export function clientUrl(slug: string, table?: string | number, origin = location.origin): string {
  const base = `${origin}/m/${slug}`;
  return table ? `${base}?mesa=${encodeURIComponent(String(table))}` : base;
}
