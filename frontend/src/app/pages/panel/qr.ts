import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import QRCode from 'qrcode';
import { firstValueFrom } from 'rxjs';
import { API, clientUrl, publicOrigin } from '../../core/config';
import { errorMessage, ToastService } from '../../core/toast.service';
import { OwnerStore } from './owner-store';

interface QrCard { label: string; url: string; img: string; }

@Component({
  selector: 'app-qr',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isLocalhost && origin().includes('localhost')) {
      <div class="card warn-card animate-fade-up no-print">
        <ion-icon name="alert-circle" />
        <div><b>Estás usando «localhost».</b>
          <p class="muted small">Los celulares no pueden abrir ese enlace. Abre este panel con la IP de tu computador en la red
            (por ejemplo <code>http://192.168.1.20:4200</code>) o con tu dominio, y los QR se generarán con esa dirección.</p></div>
      </div>
    }

    @if (isIp) {
      <div class="card warn-card animate-fade-up no-print">
        <ion-icon name="alert-circle" />
        <div><b>Estás usando un número IP.</b>
          <p class="muted small">YouTube no deja sonar la música en direcciones con IP. Abre el panel con
            <a [href]="nipOrigin + '/panel/qr'">{{ nipOrigin }}</a> y vuelve a generar e imprimir los QR desde ahí.</p></div>
      </div>
    }

    <div class="panel-grid two no-print">
      <section class="card animate-fade-up">
        <h3 class="card-title"><ion-icon name="tv" /> Enlace del reproductor</h3>
        <p class="muted small">Ábrelo en el computador, TV o tablet conectado a los parlantes. Es privado: no lo compartas.</p>
        <div class="copy-box"><code class="truncate">{{ playerUrl() }}</code>
          <button class="btn icon sm" (click)="copy(playerUrl())" aria-label="Copiar"><ion-icon name="copy" /></button></div>
        <div class="row" style="margin-top:12px">
          <a class="btn primary sm" [href]="playerUrl()" target="_blank"><ion-icon name="tv" /> Abrir</a>
          <button class="btn sm ghost" (click)="regenerate()"><ion-icon name="refresh" /> Cambiar enlace</button>
        </div>
      </section>
      <section class="card animate-fade-up" style="animation-delay:.05s">
        <h3 class="card-title"><ion-icon name="phone-portrait" /> Enlace para clientes</h3>
        <p class="muted small">Puedes compartirlo también por WhatsApp o redes sociales.</p>
        <div class="copy-box"><code class="truncate">{{ general() }}</code>
          <button class="btn icon sm" (click)="copy(general())" aria-label="Copiar"><ion-icon name="copy" /></button></div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary sm" (click)="print()"><ion-icon name="print" /> Imprimir todos los QR</button>
        </div>
      </section>
    </div>

    <div class="qr-toolbar no-print animate-fade-up">
      <h3 class="card-title" style="margin:0"><ion-icon name="qr-code" /> Mesas <span class="chip accent">{{ store.business()?.tables_count }}</span></h3>
      <span class="spacer"></span>
      <button class="btn sm ghost" (click)="changeTables(-1)" [disabled]="busy() || (store.business()?.tables_count ?? 1) <= 1">
        <ion-icon name="trash" /> Quitar última mesa
      </button>
      <button class="btn primary" (click)="changeTables(1)" [class.loading]="busy()">
        <ion-icon name="add-circle" /> Agregar mesa
      </button>
    </div>

    <section class="qr-grid stagger">
      @for (c of cards(); track c.label) {
        <article class="qr-card" [class.is-new]="c.label === newLabel()">
          <div class="qr-brand"><span class="brand-disc sm"></span> {{ store.business()?.name }}</div>
          @if (c.img) { <img [src]="c.img" [alt]="'QR ' + c.label" /> } @else { <div class="skeleton" style="aspect-ratio:1"></div> }
          <h3>{{ c.label }}</h3>
          <p>Escanea y pide tu canción 🎵</p>
        </article>
      }
    </section>
  `,
})
export class QrPage {
  readonly store = inject(OwnerStore);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  readonly isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
  readonly isIp = /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname) && location.hostname !== '127.0.0.1';
  readonly nipOrigin = `${location.protocol}//${location.hostname.replaceAll('.', '-')}.nip.io${location.port ? ':' + location.port : ''}`;
  readonly cards = signal<QrCard[]>([]);
  readonly busy = signal(false);
  readonly newLabel = signal('');
  readonly origin = signal(location.origin);
  readonly general = computed(() => clientUrl(this.store.business()?.slug ?? '', undefined, this.origin()));
  readonly playerUrl = computed(() => {
    const b = this.store.business();
    return b ? `${this.origin()}/player/${b.slug}?token=${b.player_token}` : '';
  });

  constructor() {
    publicOrigin().then((o) => this.origin.set(o));
    effect(() => {
      const b = this.store.business();
      const origin = this.origin();
      if (b) untracked(() => this.build(b.slug, b.tables_count, origin));
    });
  }

  async build(slug: string, tables: number, origin: string) {
    const items = [{ label: 'QR general', url: clientUrl(slug, undefined, origin) }];
    for (let i = 1; i <= tables; i++) items.push({ label: `Mesa ${i}`, url: clientUrl(slug, i, origin) });
    const prev = new Map(this.cards().map((c) => [c.url, c.img]));
    this.cards.set(items.map((x) => ({ ...x, img: prev.get(x.url) ?? '' })));
    const opts = { margin: 1, width: 420, color: { dark: '#140d26', light: '#ffffff' } };
    const imgs = await Promise.all(items.map((x) => prev.get(x.url) || QRCode.toDataURL(x.url, opts)));
    this.cards.set(items.map((x, i) => ({ ...x, img: imgs[i] })));
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.ok('Enlace copiado');
    } catch {
      prompt('Copia el enlace:', text);
    }
  }

  print() { window.print(); }

  /** Suma o quita una mesa; el QR nuevo se genera solo y la tarjeta entra animada. */
  async changeTables(delta: number) {
    const b = this.store.business();
    if (!b) return;
    const next = Math.max(1, b.tables_count + delta);
    this.busy.set(true);
    try {
      await this.store.save({ tables_count: next });
      if (delta > 0) {
        this.newLabel.set(`Mesa ${next}`);
        this.toast.ok(`Mesa ${next} agregada con su código QR`);
        setTimeout(() => document.querySelector('.qr-card.is-new')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
      } else {
        this.toast.ok(`Se quitó la mesa ${b.tables_count}`);
      }
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async regenerate() {
    if (!confirm('El enlace actual del reproductor dejará de funcionar. ¿Continuar?')) return;
    await firstValueFrom(this.http.post(`${API}/owner/business/player-token/`, {}));
    await this.store.load();
    this.toast.ok('Nuevo enlace generado');
  }
}
