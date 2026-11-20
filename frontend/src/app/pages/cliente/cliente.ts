import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, computed, effect, inject, input, OnDestroy, OnInit, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon, IonSegment, IonSegmentButton } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { API } from '../../core/config';
import { PublicBusiness, QueueEntry, RocolaState, Song } from '../../core/models';
import { RocolaLive } from '../../core/realtime';
import { errorMessage, ToastService } from '../../core/toast.service';
import { AmbientComponent, CoverComponent, EqComponent, fmtTime, MarqueeDirective } from '../../shared/ui';

type SheetState = 'form' | 'sending' | 'done' | 'error';

function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
}

@Component({
  selector: 'app-cliente',
  imports: [FormsModule, RouterLink, IonIcon, IonSegment, IonSegmentButton, AmbientComponent, CoverComponent, EqComponent, MarqueeDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cliente.html',
})
export class Cliente implements OnInit, OnDestroy {
  slug = input.required<string>();
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  readonly business = signal<PublicBusiness | null>(null);
  readonly notFound = signal(false);
  live?: RocolaLive;
  private readonly liveReady = signal(false);
  readonly state = computed<RocolaState | null>(() => (this.liveReady() ? (this.live?.state() ?? null) : null));

  readonly tab = signal<'buscar' | 'cola'>('buscar');
  readonly query = signal('');
  readonly results = signal<Song[]>([]);
  readonly searching = signal(true);
  readonly table = signal<string>('');
  readonly tick = signal(0);
  readonly expanded = signal(false);

  // Hoja para pedir
  readonly sheetSong = signal<Song | null>(null);
  readonly sheetState = signal<SheetState>('form');
  readonly sheetError = signal('');
  readonly lastPlace = signal(0);
  dedication = '';
  tablePick = '';

  readonly mine = signal<number[]>([]);
  readonly liked = signal<number[]>([]);
  readonly heartAnim = signal(0);
  private clientId = '';
  private searchTimer?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setInterval>;

  readonly current = computed(() => this.state()?.current ?? null);
  readonly queue = computed(() => this.state()?.queue ?? []);
  readonly myInQueue = computed(() => this.queue().filter((q) => this.mine().includes(q.id)));
  readonly currentIsMine = computed(() => !!this.current() && this.mine().includes(this.current()!.id));
  readonly elapsed = computed(() => (this.tick(), (this.live?.elapsedMs() ?? 0) / 1000));
  readonly tables = computed(() => Array.from({ length: this.business()?.tables_count ?? 10 }, (_, i) => String(i + 1)));
  readonly skeletons = Array.from({ length: 7 });
  readonly fmt = fmtTime;

  constructor() {
    // Si el servidor confirma que mi pedido empezó a sonar, avisar
    let lastCurrent = 0;
    effect(() => {
      const cur = this.current();
      if (cur && cur.id !== lastCurrent) {
        if (lastCurrent && this.mine().includes(cur.id)) this.toast.ok(`¡Está sonando tu canción: ${cur.song.title}!`);
        lastCurrent = cur.id;
      }
    });
  }

  async ngOnInit() {
    const slug = this.slug();
    this.clientId = store<string>('rocola.client', '') || crypto.randomUUID?.() || String(Math.random()).slice(2);
    save('rocola.client', this.clientId);
    this.mine.set(store<number[]>(`rocola.mine.${slug}`, []));
    this.liked.set(store<number[]>('rocola.liked', []));
    const mesa = this.route.snapshot.queryParamMap.get('mesa');
    if (mesa) save(`rocola.table.${slug}`, mesa);
    this.table.set(mesa ?? store<string>(`rocola.table.${slug}`, ''));

    try {
      const res = await firstValueFrom(this.http.get<{ business: PublicBusiness; state: RocolaState }>(`${API}/public/${slug}/`));
      this.business.set(res.business);
      document.documentElement.style.setProperty('--accent', res.business.accent_color);
      this.live = new RocolaLive(slug, () =>
        firstValueFrom(this.http.get<{ state: RocolaState }>(`${API}/public/${slug}/`)).then((r) => r.state),
      );
      this.live.apply(res.state);
      this.liveReady.set(true);
    } catch {
      this.notFound.set(true);
    }
    this.search();
    this.tickTimer = setInterval(() => this.tick.update((t) => t + 1), 1000);
  }

  ngOnDestroy() {
    this.live?.destroy();
    clearInterval(this.tickTimer);
    clearTimeout(this.searchTimer);
    document.documentElement.style.removeProperty('--accent');
  }

  onQuery(q: string) {
    this.query.set(q);
    this.searching.set(true);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.search(), 260);
  }

  async search() {
    try {
      const songs = await firstValueFrom(
        this.http.get<Song[]>(`${API}/public/${this.slug()}/songs/`, { params: { q: this.query() } }),
      );
      this.results.set(songs);
    } catch {
      this.results.set([]);
    } finally {
      this.searching.set(false);
    }
  }

  inQueue(song: Song) {
    return this.queue().some((q) => q.song.id === song.id) || this.current()?.song.id === song.id;
  }

  openSheet(song: Song) {
    if (!this.business()?.open) {
      this.toast.error(this.business()?.message || 'Los pedidos no están disponibles.');
      return;
    }
    this.sheetSong.set(song);
    this.sheetState.set('form');
    this.sheetError.set('');
    this.dedication = '';
    this.tablePick = this.table();
  }

  closeSheet() {
    this.sheetSong.set(null);
  }

  async confirmRequest() {
    const song = this.sheetSong();
    if (!song) return;
    const table = this.tablePick || this.table();
    if (!table) {
      this.sheetError.set('Elige tu mesa para continuar.');
      this.sheetState.set('error');
      return;
    }
    this.table.set(table);
    save(`rocola.table.${this.slug()}`, table);
    this.sheetState.set('sending');
    try {
      const res = await firstValueFrom(
        this.http.post<{ id: number; place: number }>(`${API}/public/${this.slug()}/request/`, {
          song: song.id,
          table,
          client_id: this.clientId,
          dedication: this.dedication.trim(),
        }),
      );
      this.mine.update((m) => [...m.slice(-30), res.id]);
      save(`rocola.mine.${this.slug()}`, this.mine());
      this.lastPlace.set(res.place);
      this.sheetState.set('done');
      if (navigator.vibrate) navigator.vibrate(30);
      setTimeout(() => {
        if (this.sheetSong() === song) this.closeSheet();
      }, 2600);
    } catch (err) {
      this.sheetError.set(errorMessage(err));
      this.sheetState.set('error');
    }
  }

  toggleLike(song: Song, ev?: Event) {
    ev?.stopPropagation();
    this.liked.update((l) => (l.includes(song.id) ? l.filter((x) => x !== song.id) : [...l, song.id]));
    save('rocola.liked', this.liked());
    this.heartAnim.update((n) => n + 1);
  }

  setTable(t: string) {
    this.table.set(t);
    save(`rocola.table.${this.slug()}`, t);
    if (t) this.toast.show(`Listo, estás en ${t === 'Barra' ? 'la barra' : 'la mesa ' + t}`, 'ok', 2200);
  }

  isMine(q: QueueEntry) {
    return this.mine().includes(q.id);
  }

  /** Expande el "sonando ahora" con View Transitions: la portada vuela a su tamaño grande. */
  setExpanded(value: boolean) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || reduce) {
      this.expanded.set(value);
      return;
    }
    doc.startViewTransition(() => {
      this.expanded.set(value);
      this.cdr.detectChanges();
    });
  }
}
