import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonReorder, IonReorderGroup, ReorderEndCustomEvent } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { API } from '../../core/config';
import { QueueEntry, RocolaState, Song } from '../../core/models';
import { errorMessage, ToastService } from '../../core/toast.service';
import { CoverComponent, EqComponent, fmtTime, MarqueeDirective } from '../../shared/ui';
import { OwnerStore } from './owner-store';

interface HistoryItem { id: number; song: Song; status: string; table: string; is_background: boolean; played_at: string; }

@Component({
  selector: 'app-cola',
  imports: [FormsModule, IonIcon, IonReorderGroup, IonReorder, CoverComponent, EqComponent, MarqueeDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel-grid">
      <!-- Sonando -->
      <section class="card now-admin animate-fade-up" [style.--glow]="state()?.current?.song?.color">
        <div class="now-glow"></div>
        @if (state()?.current; as cur) {
          <app-cover [song]="cur.song" [size]="96" [radius]="18" />
          <div class="now-meta">
            <span class="now-label"><app-eq [paused]="state()!.is_paused" /> {{ state()!.is_paused ? 'En pausa' : 'Sonando ahora' }}</span>
            <h2 appMarquee><span>{{ cur.song.title }}</span></h2>
            <p class="muted truncate">{{ cur.song.artist }} · {{ cur.is_background ? 'Playlist de fondo' : 'Mesa ' + (cur.table || '—') }}</p>
            @if (cur.dedication) { <p class="small faint">“{{ cur.dedication }}”</p> }
            <p class="sound-hint small"><ion-icon name="volume-high" /> El sonido sale <b>solo</b> del equipo donde está abierto el reproductor.
              @if (store.business(); as b) {
                <a [href]="'/player/' + b.slug + '?token=' + b.player_token" target="_blank">Reproducir en este equipo →</a>
              }
            </p>
            @for (c of [cur]; track c.id) {
              <div class="progress" [class.paused]="state()!.is_paused" style="margin-top:12px"
                   [style.--song-dur]="(c.song.duration || 180) + 's'" [style.--song-delay]="-(store.elapsedMs() / 1000) + 's'"><div class="bar"></div></div>
            }
          </div>
          <div class="now-actions">
            <button class="btn icon" (click)="togglePause()" [attr.aria-label]="state()!.is_paused ? 'Reanudar' : 'Pausar'">
              <ion-icon [name]="state()!.is_paused ? 'play' : 'pause'" />
            </button>
            <button class="btn primary" (click)="skip()" [class.loading]="busy()"><ion-icon name="play-skip-forward" /> Saltar</button>
          </div>
        } @else {
          <div class="empty-state" style="padding:12px;flex:1">
            <ion-icon class="empty-state-icon" name="tv" />
            <h3>El reproductor no está sonando</h3>
            <p>Abre el reproductor en el PC o TV conectado a los parlantes y pulsa «Iniciar rocola».</p>
          </div>
        }
      </section>

      <!-- Cola -->
      <section class="card animate-fade-up" style="animation-delay:.05s">
        <h3 class="card-title"><ion-icon name="list" /> Cola de pedidos <span class="chip accent">{{ queue().length }}</span>
          <span class="spacer"></span><span class="faint small hide-sm">Arrastra ☰ para reordenar</span></h3>
        @if (!queue().length) {
          <div class="empty-state"><ion-icon class="empty-state-icon" name="musical-notes" /><h3>Sin pedidos</h3>
            <p>Mientras tanto suena tu playlist de fondo.</p></div>
        } @else {
          <ion-reorder-group [disabled]="false" (ionReorderEnd)="onReorder($event)" class="stagger">
            @for (q of queue(); track q.id) {
              <div class="song-row queue-admin">
                <ion-reorder slot="start"><ion-icon name="reorder-three" class="grip" /></ion-reorder>
                <span class="pos-num">{{ q.position }}</span>
                <app-cover [song]="q.song" [size]="44" [radius]="10" />
                <div class="meta">
                  <div class="title">{{ q.song.title }}</div>
                  <div class="artist">{{ q.song.artist }} @if (q.dedication) { · “{{ q.dedication }}” }</div>
                </div>
                <span class="chip">{{ q.table ? (q.table === 'Barra' ? 'Barra' : 'Mesa ' + q.table) : '—' }}</span>
                <button class="btn icon sm danger" (click)="remove(q)" aria-label="Quitar de la cola"><ion-icon name="trash" /></button>
              </div>
            }
          </ion-reorder-group>
        }
      </section>

      <!-- Agregar rápido -->
      <section class="card animate-fade-up" style="animation-delay:.1s">
        <h3 class="card-title"><ion-icon name="add-circle" /> Agregar desde la barra</h3>
        <div class="search-box"><ion-icon name="search" />
          <input class="input" placeholder="Buscar en tu catálogo…" [ngModel]="q()" (ngModelChange)="onSearch($event)" /></div>
        <div class="stack" style="gap:2px;margin-top:10px">
          @for (s of results(); track s.id) {
            <div class="song-row" (click)="add(s)">
              <app-cover [song]="s" [size]="40" [radius]="10" />
              <div class="meta"><div class="title">{{ s.title }}</div><div class="artist">{{ s.artist }}</div></div>
              <span class="add-btn"><ion-icon name="add" /></span>
            </div>
          }
        </div>
      </section>

      <!-- Historial -->
      <section class="card animate-fade-up" style="animation-delay:.15s">
        <h3 class="card-title"><ion-icon name="time" /> Sonó recientemente
          <span class="spacer"></span><button class="btn icon sm ghost" (click)="loadHistory()" aria-label="Actualizar"><ion-icon name="refresh" /></button></h3>
        <div class="stack" style="gap:2px">
          @for (h of history(); track h.id) {
            <div class="song-row compact">
              <app-cover [song]="h.song" [size]="36" [radius]="8" />
              <div class="meta"><div class="title">{{ h.song.title }}</div>
                <div class="artist">{{ h.is_background ? 'Fondo' : 'Mesa ' + (h.table || '—') }} · {{ time(h.played_at) }}</div></div>
              @if (h.status === 'skipped') { <span class="chip warn">Saltada</span> }
            </div>
          } @empty { <p class="muted small">Aún no ha sonado nada.</p> }
        </div>
      </section>
    </div>
  `,
})
export class ColaPage implements OnInit, OnDestroy {
  readonly store = inject(OwnerStore);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  readonly state = this.store.state;
  readonly queue = computed(() => this.state()?.queue ?? []);
  readonly q = signal('');
  readonly results = signal<Song[]>([]);
  readonly history = signal<HistoryItem[]>([]);
  readonly busy = signal(false);
  readonly fmt = fmtTime;
  private timer?: ReturnType<typeof setTimeout>;
  private historyTimer?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.onSearch('');
    this.loadHistory();
    this.historyTimer = setInterval(() => this.loadHistory(), 30000);
  }
  ngOnDestroy() {
    clearInterval(this.historyTimer);
    clearTimeout(this.timer);
  }

  time(iso: string) {
    return iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
  }

  private async act(req: Promise<RocolaState>, ok?: string) {
    try {
      this.store.applyState(await req);
      if (ok) this.toast.ok(ok);
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  async skip() {
    this.busy.set(true);
    await this.act(firstValueFrom(this.http.post<RocolaState>(`${API}/owner/queue/skip/`, {})));
    this.busy.set(false);
    this.loadHistory();
  }
  togglePause() {
    this.act(firstValueFrom(this.http.post<RocolaState>(`${API}/owner/queue/pause/`, { paused: !this.state()?.is_paused })));
  }
  remove(q: QueueEntry) {
    this.act(firstValueFrom(this.http.delete<RocolaState>(`${API}/owner/queue/${q.id}/`)), `Quitaste «${q.song.title}»`);
  }
  add(s: Song) {
    this.act(firstValueFrom(this.http.post<RocolaState>(`${API}/owner/queue/add/`, { song: s.id })), `«${s.title}» agregada a la cola`);
  }

  onReorder(ev: ReorderEndCustomEvent) {
    const ids = this.queue().map((q) => q.id);
    const [moved] = ids.splice(ev.detail.from, 1);
    ids.splice(ev.detail.to, 0, moved);
    ev.detail.complete(false); // Angular vuelve a pintar la lista desde el estado
    this.act(firstValueFrom(this.http.post<RocolaState>(`${API}/owner/queue/reorder/`, { ids })));
  }

  onSearch(v: string) {
    this.q.set(v);
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        const res = await firstValueFrom(this.http.get<Song[]>(`${API}/owner/songs/`, { params: { q: v } }));
        this.results.set(res.filter((s) => !s.is_blocked).slice(0, 6));
      } catch { /* */ }
    }, 250);
  }

  async loadHistory() {
    try {
      this.history.set(await firstValueFrom(this.http.get<HistoryItem[]>(`${API}/owner/history/`)));
    } catch { /* */ }
  }
}
