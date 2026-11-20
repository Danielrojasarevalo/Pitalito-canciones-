import { signal } from '@angular/core';
import { wsUrl } from './config';
import { RocolaState } from './models';

/**
 * Conexión en vivo con la cola de un negocio.
 * Reintenta con espera creciente y, mientras no hay WebSocket, consulta por HTTP
 * cada pocos segundos para que la pantalla nunca se quede desactualizada.
 */
export class RocolaLive {
  readonly state = signal<RocolaState | null>(null);
  readonly connected = signal(false);
  /** Diferencia reloj servidor − reloj local (ms), para calcular el progreso. */
  clockOffset = 0;

  private ws?: WebSocket;
  private retry = 0;
  private closed = false;
  private pollTimer?: ReturnType<typeof setInterval>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly slug: string,
    private fallbackFetch: () => Promise<RocolaState>,
  ) {
    this.connect();
    this.pollTimer = setInterval(() => {
      if (!this.connected()) this.refresh();
    }, 5000);
  }

  apply(state: RocolaState) {
    this.clockOffset = Date.parse(state.server_time) - Date.now();
    this.state.set(state);
  }

  async refresh() {
    try { this.apply(await this.fallbackFetch()); } catch { /* sin red */ }
  }

  /** Milisegundos transcurridos de la canción actual según el servidor. */
  elapsedMs(): number {
    const cur = this.state()?.current;
    if (!cur?.started_at) return 0;
    return Math.max(0, Date.now() + this.clockOffset - Date.parse(cur.started_at));
  }

  private connect() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(wsUrl(this.slug));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.retry = 0;
      this.connected.set(true);
      this.pingTimer = setInterval(() => this.ws?.readyState === 1 && this.ws.send('{"type":"ping"}'), 25000);
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') this.apply(msg.state);
      } catch { /* ignorar */ }
    };
    this.ws.onclose = () => {
      this.connected.set(false);
      clearInterval(this.pingTimer);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(15000, 800 * 2 ** this.retry++) + Math.random() * 400;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  destroy() {
    this.closed = true;
    clearInterval(this.pollTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
