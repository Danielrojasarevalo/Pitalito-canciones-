import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, NgZone, OnDestroy, OnInit,
  signal, untracked, viewChild, viewChildren,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import QRCode from 'qrcode';
import { firstValueFrom } from 'rxjs';
import { API, clientUrl, mediaUrl, publicOrigin } from '../../core/config';
import { PublicBusiness, QueueEntry, RocolaState } from '../../core/models';
import { RocolaLive } from '../../core/realtime';
import { errorMessage, ToastService } from '../../core/toast.service';
import { AmbientComponent, CoverComponent, EqComponent, fmtTime, MarqueeDirective } from '../../shared/ui';

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void; }
}

const BARS = 48;

@Component({
  selector: 'app-player',
  imports: [RouterLink, IonIcon, AmbientComponent, CoverComponent, EqComponent, MarqueeDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './player.html',
})
export class Player implements OnInit, OnDestroy {
  slug = input.required<string>();
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private zone = inject(NgZone);

  private audioRef = viewChild<ElementRef<HTMLAudioElement>>('audio');
  private progressRef = viewChild<ElementRef<HTMLElement>>('progressBar');
  private stageRef = viewChild<ElementRef<HTMLElement>>('stage');
  private barRefs = viewChildren<ElementRef<HTMLElement>>('eqBar');

  readonly business = signal<PublicBusiness | null>(null);
  readonly error = signal('');
  readonly started = signal(false);
  readonly playing = signal(false);
  readonly elapsed = signal(0);
  readonly volume = signal(Number(localStorage.getItem('rocola.volume') ?? 0.9));
  readonly qr = signal('');
  readonly controlsVisible = signal(true);
  /** En celulares el navegador puede bloquear el sonido: se pide un toque para reproducir. */
  readonly needTap = signal(false);
  /** Último recurso: el video queda al frente para tocar ▶ dentro de YouTube. */
  readonly tapVideo = signal(false);
  private tapTimer?: ReturnType<typeof setTimeout>;
  readonly loadedItem = signal<QueueEntry | null>(null);
  readonly bars = Array.from({ length: BARS }, (_, i) => i);
  readonly fmt = fmtTime;
  readonly mediaUrl = mediaUrl;
  /** YouTube bloquea los videos cuando la página se abre con una IP (ej. 192.168.1.11). */
  readonly ipHost = /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname) && location.hostname !== '127.0.0.1';
  readonly nipUrl = `${location.protocol}//${location.hostname.replaceAll('.', '-')}.nip.io${location.port ? ':' + location.port : ''}${location.pathname}${location.search}`;
  readonly isYoutube = computed(() => this.loadedItem()?.song.source === 'youtube');

  live?: RocolaLive;
  private readonly liveReady = signal(false);
  readonly state = computed<RocolaState | null>(() => (this.liveReady() ? (this.live?.state() ?? null) : null));
  readonly current = computed(() => this.state()?.current ?? null);
  readonly upcoming = computed(() => this.state()?.queue.slice(0, 6) ?? []);
  readonly clientLink = computed(() => clientUrl(this.slug()));

  private token = '';
  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private freq?: Uint8Array<ArrayBuffer>;
  private raf = 0;
  private yt: any;
  private ytReady?: Promise<void>;
  private advancing = false;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private wakeLock: any;

  constructor() {
    // Sincroniza el reproductor con el estado del servidor
    let lastPaused = false;
    let lastEmptyTry = 0;
    effect(() => {
      const st = this.state();
      if (!this.started() || !st) return;
      untracked(() => {
        const cur = st.current;
        if (!cur) {
          if (Date.now() - lastEmptyTry > 8000) {
            lastEmptyTry = Date.now();
            this.requestNext(null);
          }
          return;
        }
        if (cur.id !== this.loadedItem()?.id) this.load(cur);
        else if (st.is_paused !== lastPaused) (st.is_paused ? this.pauseLocal() : this.resumeLocal());
        lastPaused = st.is_paused;
      });
    });
  }

  async ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    try {
      const res = await firstValueFrom(
        this.http.get<{ business: PublicBusiness; state: RocolaState; subscription_ok: boolean }>(
          `${API}/player/${this.slug()}/`, { params: { token: this.token } },
        ),
      );
      this.business.set(res.business);
      if (!res.subscription_ok) this.error.set('La suscripción de este negocio está vencida o suspendida.');
      this.live = new RocolaLive(this.slug(), () =>
        firstValueFrom(this.http.get<{ state: RocolaState }>(`${API}/player/${this.slug()}/`, { params: { token: this.token } })).then((r) => r.state),
      );
      this.live.apply(res.state);
      this.liveReady.set(true);
      this.qr.set(await QRCode.toDataURL(clientUrl(this.slug(), undefined, await publicOrigin()), { margin: 1, width: 360, color: { dark: '#140d26', light: '#ffffff' } }));
    } catch (err) {
      this.error.set(errorMessage(err, 'No se pudo abrir el reproductor.'));
    }
    this.zone.runOutsideAngular(() => (this.raf = requestAnimationFrame(this.frame)));
    this.ensureYoutube();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.live?.destroy();
    this.audioRef()?.nativeElement.pause();
    this.yt?.destroy?.();
    this.ctx?.close();
    this.wakeLock?.release?.();
    clearTimeout(this.hideTimer);
    clearTimeout(this.tapTimer);
  }

  /** El navegador exige un toque/clic antes de reproducir sonido. */
  async start() {
    this.started.set(true);
    const audio = this.audioRef()!.nativeElement;
    audio.volume = this.volume();
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    } catch {
      /* sin Web Audio: el ecualizador se simula */
    }
    try { this.wakeLock = await (navigator as any).wakeLock?.request('screen'); } catch { /* opcional */ }
    const cur = this.current();
    if (cur) this.load(cur, true);
    else this.requestNext(null);
    this.pokeControls();
  }

  private async load(item: QueueEntry, resume = false) {
    this.loadedItem.set(item);
    this.elapsed.set(0);
    const song = item.song;
    const offset = resume ? (this.live?.elapsedMs() ?? 0) / 1000 : 0;
    const startAt = offset > 2 && offset < (song.duration || 1e9) - 4 ? offset : 0;
    this.setMediaSession(item);
    const audio = this.audioRef()!.nativeElement;

    if (song.source === 'youtube' && song.youtube_id) {
      audio.pause();
      await this.ensureYoutube();
      if (this.loadedItem()?.id !== item.id) return;
      this.yt.loadVideoById({ videoId: song.youtube_id, startSeconds: startAt });
      this.watchAutoplay(item.id);
      this.yt.setVolume(Math.round(this.volume() * 100));
      return;
    }
    this.yt?.stopVideo?.();
    audio.src = mediaUrl(song.audio_url);
    audio.currentTime = 0;
    if (startAt) audio.addEventListener('loadedmetadata', () => (audio.currentTime = startAt), { once: true });
    try {
      await this.ctx?.resume();
      if (this.state()?.is_paused) return;
      await audio.play();
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError') this.needTap.set(true);
      else if (name !== 'AbortError') this.onMediaError();
    }
  }

  onPlay() { this.playing.set(true); this.needTap.set(false); }

  /** Si a los pocos segundos YouTube no arrancó (bloqueo del celular), pide un toque. */
  private watchAutoplay(itemId: number) {
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      const st = this.yt?.getPlayerState?.();
      if (this.loadedItem()?.id === itemId && st !== 1 && st !== 3 && !this.state()?.is_paused) this.needTap.set(true);
    }, 3500);
  }

  /** Toque del usuario: desbloquea el sonido en el celular. */
  tapToPlay() {
    this.needTap.set(false);
    this.ctx?.resume();
    if (this.isYoutube()) {
      this.yt?.unMute?.();
      this.yt?.setVolume?.(Math.round(this.volume() * 100));
      this.yt?.playVideo?.();
      this.watchAutoplay(this.loadedItem()?.id ?? 0);
      setTimeout(() => {
        const st = this.yt?.getPlayerState?.();
        if (st !== 1 && st !== 3) this.zone.run(() => this.tapVideo.set(true));
      }, 2500);
    } else {
      this.audioRef()?.nativeElement.play().catch(() => this.needTap.set(true));
    }
  }
  onPause() { this.playing.set(false); }

  onEnded() {
    this.requestNext(this.loadedItem()?.id ?? null);
  }

  private retried = 0;
  private netFails = 0;

  onMediaError(code?: number) {
    const item = this.loadedItem();
    if (!item) return;
    // Un reintento para fallas momentáneas (no aplica a videos bloqueados: 101/150/153)
    if (this.retried !== item.id && ![100, 101, 150, 153].includes(code ?? 0)) {
      this.retried = item.id;
      setTimeout(() => this.loadedItem()?.id === item.id && this.load(item), 1500);
      return;
    }
    const why: Record<number, string> = {
      2: 'enlace de YouTube inválido',
      5: 'el celular no pudo cargar el video',
      100: 'el video ya no existe en YouTube',
      101: 'YouTube no permite sonarla fuera de su página',
      150: 'YouTube no permite sonarla fuera de su página',
      153: 'YouTube no recibió la dirección de la página',
    };
    const detail = code ? ` (código ${code}: ${why[code] ?? 'error de YouTube'})` : ' (error del archivo de audio)';
    this.toast.show(`No se pudo reproducir «${item.song.title}»${detail}. Pasando a la siguiente…`, 'error', 9000);
    setTimeout(() => {
      if (this.loadedItem()?.id === item.id) this.requestNext(item.id, true);
    }, 2500);
  }

  /** Pide al servidor la siguiente canción (cola o playlist de fondo). La música nunca para. */
  async requestNext(endedId: number | null, skipped = false) {
    if (this.advancing) return;
    this.advancing = true;
    try {
      const res = await firstValueFrom(
        this.http.post<{ state: RocolaState }>(`${API}/player/${this.slug()}/next/`, {
          token: this.token,
          ended_item_id: endedId,
          skipped,
        }),
      );
      this.live?.apply(res.state);
      this.netFails = 0;
    } catch (err) {
      // Fallas cortas de red: se reintenta en silencio; solo se avisa si persisten
      if (++this.netFails >= 3) this.toast.error(errorMessage(err, 'Sin conexión: reintentando…'));
      setTimeout(() => this.requestNext(endedId, skipped), Math.min(10000, 2000 * this.netFails));
    } finally {
      this.advancing = false;
    }
  }

  togglePlay() {
    if (this.playing()) this.pauseLocal();
    else this.resumeLocal();
  }
  private pauseLocal() {
    this.isYoutube() ? this.yt?.pauseVideo?.() : this.audioRef()?.nativeElement.pause();
    this.playing.set(false);
  }
  private resumeLocal() {
    if (this.isYoutube()) this.yt?.playVideo?.();
    else {
      this.ctx?.resume();
      this.audioRef()?.nativeElement.play().catch(() => {});
    }
  }
  skip() {
    this.requestNext(this.loadedItem()?.id ?? null, true);
  }
  setVolume(v: number) {
    this.volume.set(v);
    localStorage.setItem('rocola.volume', String(v));
    const audio = this.audioRef()?.nativeElement;
    if (audio) audio.volume = v;
    this.yt?.setVolume?.(Math.round(v * 100));
  }
  fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  pokeControls() {
    this.controlsVisible.set(true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.controlsVisible.set(false), 3500);
  }

  /** Bucle de animación fuera de Angular: ecualizador, pulso y barra de progreso. */
  private frame = (t: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const bars = this.barRefs();
    let bass = 0;
    const playing = this.playing();
    if (this.analyser && this.freq && !this.isYoutube()) {
      this.analyser.getByteFrequencyData(this.freq);
      const n = this.freq.length * 0.72;
      for (let i = 0; i < bars.length; i++) {
        const idx = Math.floor(Math.pow(i / bars.length, 1.6) * n);
        const v = this.freq[idx] / 255;
        bars[i].nativeElement.style.transform = `scaleY(${Math.max(0.04, v)})`;
      }
      bass = (this.freq[1] + this.freq[2] + this.freq[3]) / (3 * 255);
    } else {
      // Ecualizador simulado (YouTube no permite leer el audio)
      for (let i = 0; i < bars.length; i++) {
        const v = playing ? 0.25 + 0.55 * Math.abs(Math.sin(t / (380 + i * 13) + i * 1.7)) * (1 - i / (bars.length * 1.4)) : 0.04;
        bars[i].nativeElement.style.transform = `scaleY(${v})`;
      }
      bass = playing ? 0.5 + 0.5 * Math.sin(t / 240) : 0;
    }
    this.stageRef()?.nativeElement.style.setProperty('--beat', bass.toFixed(3));

    // Progreso
    let pos = 0;
    let dur = this.loadedItem()?.song.duration || 0;
    if (this.isYoutube() && this.yt?.getCurrentTime) {
      pos = this.yt.getCurrentTime() || 0;
      dur = this.yt.getDuration?.() || dur;
    } else {
      const audio = this.audioRef()?.nativeElement;
      if (audio) {
        pos = audio.currentTime || 0;
        if (isFinite(audio.duration) && audio.duration > 0) dur = audio.duration;
      }
    }
    const bar = this.progressRef()?.nativeElement;
    if (bar) bar.style.transform = `scaleX(${dur ? Math.min(1, pos / dur) : 0})`;
    if (Math.floor(pos) !== Math.floor(this.elapsed())) this.zone.run(() => this.elapsed.set(pos));
  };

  private ensureYoutube(): Promise<void> {
    if (this.ytReady) return this.ytReady;
    this.ytReady = new Promise<void>((resolve) => {
      const create = () => {
        this.yt = new window.YT.Player('yt-player', {
          height: '100%',
          width: '100%',
          playerVars: { autoplay: 1, controls: 1, iv_load_policy: 3, rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
          events: {
            onReady: () => resolve(),
            onStateChange: (e: any) =>
              this.zone.run(() => {
                if (e.data === 1) { this.playing.set(true); this.needTap.set(false); this.tapVideo.set(false); }
                if (e.data === 2) this.playing.set(false);
                if (e.data === 0) this.onEnded();
              }),
            onError: (e: any) => this.zone.run(() => this.onMediaError(e?.data)),
          },
        });
      };
      if (window.YT?.Player) create();
      else {
        window.onYouTubeIframeAPIReady = create;
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    });
    return this.ytReady;
  }

  private setMediaSession(item: QueueEntry) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.song.title,
      artist: item.song.artist,
      album: this.business()?.name,
      artwork: item.song.cover_url ? [{ src: mediaUrl(item.song.cover_url), sizes: '400x400' }] : [],
    });
  }
}
