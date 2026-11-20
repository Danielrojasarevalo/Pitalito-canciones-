import { HttpClient, HttpEventType } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonToggle } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { API } from '../../core/config';
import { Song } from '../../core/models';
import { errorMessage, ToastService } from '../../core/toast.service';
import { CoverComponent, fmtTime } from '../../shared/ui';

interface Upload { name: string; progress: number; done: boolean; error: string; }

@Component({
  selector: 'app-musica',
  imports: [FormsModule, IonIcon, IonToggle, CoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel-grid two">
      <section class="card animate-fade-up">
        <h3 class="card-title"><ion-icon name="cloud-upload" /> Subir canciones</h3>
        <label class="dropzone" [class.over]="dragOver()" (dragover)="$event.preventDefault(); dragOver.set(true)"
               (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
          <input type="file" accept="audio/*" multiple (change)="onPick($event)" />
          <ion-icon name="musical-notes" class="animate-float" />
          <b>Arrastra tus archivos MP3 aquí</b>
          <span class="muted small">o toca para elegirlos. Leemos título, artista, duración y portada automáticamente.</span>
        </label>
        @if (uploads().length) {
          <div class="stack uploads" style="margin-top:12px;gap:8px">
            @for (u of uploads(); track $index) {
              <div class="upload-row animate-fade-up">
                <span class="truncate small">{{ u.name }}</span>
                @if (u.error) { <span class="chip bad">{{ u.error }}</span> }
                @else if (u.done) { <ion-icon name="checkmark-circle" style="color:var(--success)" class="animate-scale-in" /> }
                <div class="progress"><div class="bar manual" [style.transform]="'scaleX(' + u.progress + ')'"></div></div>
              </div>
            }
          </div>
        }
      </section>

      <section class="card animate-fade-up" style="animation-delay:.05s">
        <h3 class="card-title"><ion-icon name="logo-youtube" /> Agregar desde YouTube</h3>
        <p class="muted small" style="margin-bottom:12px">Pega el enlace del video. Se reproduce en la pantalla del negocio
          (sin necesidad de YouTube Premium para los clientes).</p>
        <form class="row" (ngSubmit)="addYoutube()">
          <input class="input" name="yt" placeholder="https://youtube.com/watch?v=…" [(ngModel)]="ytUrl" />
          <button class="btn primary" [class.loading]="ytLoading()" [disabled]="!ytUrl"><ion-icon name="add" /> Agregar</button>
        </form>
        <p class="faint small" style="margin-top:10px">⚠️ Revisa los términos de uso de YouTube para uso comercial y la licencia de
          comunicación pública (SAYCO-ACINPRO). Lo más seguro es usar archivos propios con licencia.</p>
      </section>
    </div>

    <section class="card animate-fade-up" style="margin-top:18px;animation-delay:.1s">
      <div class="row wrap" style="margin-bottom:12px">
        <h3 class="card-title" style="margin:0"><ion-icon name="albums" /> Catálogo <span class="chip accent">{{ songs().length }}</span></h3>
        <span class="spacer"></span>
        <div class="search-box" style="min-width:240px;flex:1;max-width:380px"><ion-icon name="search" />
          <input class="input" placeholder="Buscar…" [ngModel]="q()" (ngModelChange)="onSearch($event)" /></div>
      </div>
      @if (loading()) {
        @for (s of [1,2,3,4]; track s) { <div class="skeleton" style="height:58px;margin-bottom:6px;border-radius:14px"></div> }
      } @else if (!songs().length) {
        <div class="empty-state"><ion-icon class="empty-state-icon" name="musical-notes" /><h3>Tu catálogo está vacío</h3><p>Sube archivos o agrega enlaces de YouTube.</p></div>
      } @else {
        <div class="song-table stagger">
          @for (s of songs(); track s.id) {
            <div class="song-row catalog" [class.blocked]="s.is_blocked">
              <app-cover [song]="s" [size]="46" [radius]="10" />
              <div class="meta">
                <div class="title">{{ s.title }} @if (s.source === 'youtube') { <ion-icon name="logo-youtube" class="yt-mark" /> }</div>
                <div class="artist">{{ s.artist || 'Artista desconocido' }} · {{ fmt(s.duration) }} @if (s.genre) { · {{ s.genre }} }</div>
              </div>
              <span class="chip hide-sm" title="Veces pedida">{{ s.times_requested || 0 }} pedidos</span>
              <label class="mini-toggle" title="Contenido explícito"><span class="small faint">Explícita</span>
                <ion-toggle [checked]="s.explicit" (ionChange)="patch(s, { explicit: $event.detail.checked })" /></label>
              <label class="mini-toggle" title="Bloquear"><span class="small faint">Bloqueada</span>
                <ion-toggle [checked]="s.is_blocked" (ionChange)="patch(s, { is_blocked: $event.detail.checked })" /></label>
              <button class="btn icon sm ghost" (click)="edit(s)" aria-label="Editar"><ion-icon name="settings" /></button>
              <button class="btn icon sm danger" (click)="remove(s)" aria-label="Eliminar"><ion-icon name="trash" /></button>
            </div>
          }
        </div>
      }
    </section>

    @if (editing(); as e) {
      <div class="backdrop" (click)="editing.set(null)"></div>
      <form class="sheet glass stack" (ngSubmit)="saveEdit()">
        <h2>Editar canción</h2>
        <div class="field"><label>Título</label><input class="input" name="t" [(ngModel)]="e.title" required /></div>
        <div class="field"><label>Artista</label><input class="input" name="a" [(ngModel)]="e.artist" /></div>
        <div class="field"><label>Género</label><input class="input" name="g" [(ngModel)]="e.genre" /></div>
        <div class="field"><label>Duración (segundos)</label><input class="input" name="d" type="number" [(ngModel)]="e.duration" /></div>
        <div class="row"><button type="button" class="btn ghost" (click)="editing.set(null)">Cancelar</button>
          <button class="btn primary" style="flex:1">Guardar</button></div>
      </form>
    }
  `,
})
export class MusicaPage implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  readonly songs = signal<Song[]>([]);
  readonly loading = signal(true);
  readonly q = signal('');
  readonly uploads = signal<Upload[]>([]);
  readonly dragOver = signal(false);
  readonly ytLoading = signal(false);
  readonly editing = signal<Song | null>(null);
  readonly fmt = fmtTime;
  ytUrl = '';
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit() { this.load(); }

  async load() {
    try {
      this.songs.set(await firstValueFrom(this.http.get<Song[]>(`${API}/owner/songs/`, { params: { q: this.q() } })));
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(v: string) {
    this.q.set(v);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }

  onPick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    this.upload(Array.from(input.files ?? []));
    input.value = '';
  }
  onDrop(ev: DragEvent) {
    ev.preventDefault();
    this.dragOver.set(false);
    this.upload(Array.from(ev.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|ogg|wav|flac|aac)$/i.test(f.name)));
  }

  /** Sube de a un archivo para no saturar la conexión del negocio. */
  async upload(files: File[]) {
    if (!files.length) return;
    const start = this.uploads().length;
    this.uploads.update((u) => [...u, ...files.map((f) => ({ name: f.name, progress: 0, done: false, error: '' }))]);
    const set = (i: number, patch: Partial<Upload>) => this.uploads.update((u) => u.map((x, j) => (j === start + i ? { ...x, ...patch } : x)));
    let ok = 0;
    for (const [i, file] of files.entries()) {
      const fd = new FormData();
      fd.append('audio_file', file);
      fd.append('title', '');
      try {
        await new Promise<void>((resolve, reject) => {
          this.http.post(`${API}/owner/songs/`, fd, { reportProgress: true, observe: 'events' }).subscribe({
            next: (e) => {
              if (e.type === HttpEventType.UploadProgress && e.total) set(i, { progress: e.loaded / e.total });
            },
            error: reject,
            complete: resolve,
          });
        });
        set(i, { progress: 1, done: true });
        ok++;
      } catch (err) {
        set(i, { error: errorMessage(err, 'Error') });
      }
    }
    if (ok) this.toast.ok(`${ok} ${ok === 1 ? 'canción subida' : 'canciones subidas'}`);
    this.load();
  }

  async addYoutube() {
    this.ytLoading.set(true);
    try {
      const s = await firstValueFrom(this.http.post<Song>(`${API}/owner/songs/youtube/`, { url: this.ytUrl }));
      this.toast.ok(`Agregada: ${s.title}`);
      this.ytUrl = '';
      this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.ytLoading.set(false);
    }
  }

  async patch(s: Song, data: Partial<Song>) {
    try {
      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => fd.append(k, String(v)));
      const updated = await firstValueFrom(this.http.patch<Song>(`${API}/owner/songs/${s.id}/`, fd));
      this.songs.update((list) => list.map((x) => (x.id === s.id ? { ...x, ...updated } : x)));
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  edit(s: Song) { this.editing.set({ ...s }); }

  async saveEdit() {
    const e = this.editing();
    if (!e) return;
    await this.patch(e, { title: e.title, artist: e.artist, genre: e.genre ?? '', duration: Number(e.duration) || 0 });
    this.editing.set(null);
    this.toast.ok('Cambios guardados');
  }

  async remove(s: Song) {
    if (!confirm(`¿Eliminar «${s.title}» del catálogo?`)) return;
    try {
      await firstValueFrom(this.http.delete(`${API}/owner/songs/${s.id}/`));
      this.songs.update((l) => l.filter((x) => x.id !== s.id));
      this.toast.ok('Canción eliminada');
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }
}
