import { Injectable, signal } from '@angular/core';

export type ToastKind = 'ok' | 'error' | 'info';
export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  duration: number;
  leaving: boolean;
}

/** Notificaciones con barra que muestra cuánto falta para cerrarse. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(text: string, kind: ToastKind = 'info', duration = 3500) {
    const id = ++this.seq;
    this.toasts.update((t) => [...t.slice(-2), { id, text, kind, duration, leaving: false }]);
    setTimeout(() => this.dismiss(id), duration);
  }
  ok(text: string) { this.show(text, 'ok'); }
  error(text: string) { this.show(text, 'error', 4500); }

  dismiss(id: number) {
    this.toasts.update((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 180);
  }
}

export function errorMessage(err: unknown, fallback = 'Algo salió mal. Intenta de nuevo.'): string {
  const e = err as { error?: unknown; status?: number };
  if (e?.status === 0) return 'Sin conexión con el servidor. ¿Está corriendo el backend en el puerto 8000?';
  if (e?.status && e.status >= 500) return `Error del servidor (${e.status}). Revisa la terminal del backend.`;
  const body = e?.error as Record<string, unknown> | undefined;
  if (body && typeof body === 'object') {
    if (typeof body['detail'] === 'string') return body['detail'];
    const first = Object.values(body)[0];
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
    if (typeof first === 'string') return first;
  }
  return fallback;
}
