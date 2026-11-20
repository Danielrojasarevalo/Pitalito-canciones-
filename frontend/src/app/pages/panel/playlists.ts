import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonToggle } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { API } from '../../core/config';
import { Playlist, Song } from '../../core/models';
import { errorMessage, ToastService } from '../../core/toast.service';
import { CoverComponent } from '../../shared/ui';
import { OwnerStore } from './owner-store';

@Component({
  selector: 'app-playlists',
  imports: [FormsModule, IonIcon, IonToggle, CoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel-grid side">
      <section class="card animate-fade-up">
        <h3 class="card-title"><ion-icon name="albums" /> Tus playlists</h3>
        <p class="muted small" style="margin-bottom:12px">La playlist de fondo suena sola cuando nadie ha pedido canciones.</p>
        <div class="stack stagger" style="gap:6px">
          @for (p of playlists(); track p.id) {
            <button class="pl-item" [class.active]="selected()?.id === p.id" (click)="select(p)">
              <div class="pl-item-icon"><ion-icon [name]="p.is_background ? 'radio' : 'albums'" /></div>
              <div class="meta"><b>{{ p.name }}</b><span class="faint small">{{ p.songs_count }} canciones</span></div>
              @if (p.is_background) { <span class="chip ok">De fondo</span> }
            </button>
          }
        </div>
        <form class="row" style="margin-top:14px" (ngSubmit)="create()">
          <input class="input" name="n" placeholder="Nueva playlist…" [(ngModel)]="newName" />
          <button class="btn icon primary" [disabled]="!newName" aria-label="Crear"><ion-icon name="add" /></button>
        </form>
      </section>

      @if (selected(); as p) {
        @for (k of [p.id]; track k) {
          <section class="card animate-slide-in">
            <div class="row wrap" style="margin-bottom:14px">
              <input class="input title-input" [(ngModel)]="p.name" (blur)="rename(p)" aria-label="Nombre" />
              <span class="spacer"></span>
              <label class="mini-toggle"><span class="small faint">Aleatorio</span>
                <ion-toggle [checked]="p.shuffle" (ionChange)="setShuffle(p, $event.detail.checked)" /></label>
              @if (!p.is_background) {
                <button class="btn success sm" (click)="activate(p)"><ion-icon name="radio" /> Usar de fondo</button>
              }
              <button class="btn icon sm danger" (click)="remove(p)" aria-label="Eliminar"><ion-icon name="trash" /></button>
            </div>
            <div class="row wrap" style="margin-bottom:10px">
              <span class="chip accent">{{ chosen().size }} de {{ songs().length }} seleccionadas</span>
              <span class="spacer"></span>
              <button class="btn sm ghost" (click)="selectAll(true)">Todas</button>
              <button class="btn sm ghost" (click)="selectAll(false)">Ninguna</button>
              <button class="btn sm primary" [class.loading]="saving()" (click)="saveSongs(p)"><ion-icon name="checkmark" /> Guardar</button>
            </div>
            <div class="search-box" style="margin-bottom:8px"><ion-icon name="search" />
              <input class="input" placeholder="Filtrar canciones…" [(ngModel)]="filter" /></div>
            <div class="check-list">
              @for (s of filtered(); track s.id) {
                <label class="song-row check" [class.on]="chosen().has(s.id)">
                  <input type="checkbox" [checked]="chosen().has(s.id)" (change)="toggle(s.id)" />
                  <span class="checkmark"><ion-icon name="checkmark" /></span>
                  <app-cover [song]="s" [size]="38" [radius]="9" />
                  <div class="meta"><div class="title">{{ s.title }}</div><div class="artist">{{ s.artist }}</div></div>
                </label>
              }
            </div>
          </section>
        }
      } @else {
        <section class="card"><div class="empty-state"><ion-icon class="empty-state-icon" name="albums" /><h3>Elige o crea una playlist</h3></div></section>
      }
    </div>
  `,
})
export class PlaylistsPage implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private store = inject(OwnerStore);
  readonly playlists = signal<Playlist[]>([]);
  readonly songs = signal<Song[]>([]);
  readonly selected = signal<Playlist | null>(null);
  readonly chosen = signal<Set<number>>(new Set());
  readonly saving = signal(false);
  private readonly filterSig = signal('');
  get filter() { return this.filterSig(); }
  set filter(v: string) { this.filterSig.set(v); }
  readonly filtered = computed(() => {
    const f = this.filterSig().toLowerCase();
    return this.songs().filter((s) => !f || `${s.title} ${s.artist}`.toLowerCase().includes(f));
  });
  newName = '';

  async ngOnInit() {
    const [pls, songs] = await Promise.all([
      firstValueFrom(this.http.get<Playlist[]>(`${API}/owner/playlists/`)),
      firstValueFrom(this.http.get<Song[]>(`${API}/owner/songs/`)),
    ]);
    this.playlists.set(pls);
    this.songs.set(songs);
    const bg = pls.find((p) => p.is_background) ?? pls[0];
    if (bg) this.select(bg);
  }

  select(p: Playlist) {
    this.selected.set({ ...p });
    this.chosen.set(new Set(p.song_ids));
  }
  toggle(id: number) {
    this.chosen.update((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  selectAll(on: boolean) {
    this.chosen.set(on ? new Set(this.songs().map((s) => s.id)) : new Set());
  }

  private replace(p: Playlist) {
    this.playlists.update((l) => l.map((x) => (x.id === p.id ? p : p.is_background ? { ...x, is_background: false } : x)));
  }

  async saveSongs(p: Playlist) {
    this.saving.set(true);
    try {
      const ordered = this.songs().filter((s) => this.chosen().has(s.id)).map((s) => s.id);
      const res = await firstValueFrom(this.http.put<Playlist>(`${API}/owner/playlists/${p.id}/songs/`, { song_ids: ordered }));
      this.replace(res);
      this.toast.ok('Playlist guardada');
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
  async rename(p: Playlist) {
    const res = await firstValueFrom(this.http.patch<Playlist>(`${API}/owner/playlists/${p.id}/`, { name: p.name }));
    this.replace(res);
  }
  async setShuffle(p: Playlist, shuffle: boolean) {
    const res = await firstValueFrom(this.http.patch<Playlist>(`${API}/owner/playlists/${p.id}/`, { shuffle }));
    this.replace(res);
    this.selected.set({ ...this.selected()!, shuffle });
  }
  async activate(p: Playlist) {
    const res = await firstValueFrom(this.http.post<Playlist>(`${API}/owner/playlists/${p.id}/activate/`, {}));
    this.replace(res);
    this.selected.set({ ...res });
    this.store.load();
    this.toast.ok(`«${p.name}» es ahora la música de fondo`);
  }
  async create() {
    const p = await firstValueFrom(this.http.post<Playlist>(`${API}/owner/playlists/`, { name: this.newName, shuffle: true }));
    this.playlists.update((l) => [...l, p]);
    this.newName = '';
    this.select(p);
  }
  async remove(p: Playlist) {
    if (!confirm(`¿Eliminar la playlist «${p.name}»?`)) return;
    await firstValueFrom(this.http.delete(`${API}/owner/playlists/${p.id}/`));
    this.playlists.update((l) => l.filter((x) => x.id !== p.id));
    this.selected.set(null);
  }
}
