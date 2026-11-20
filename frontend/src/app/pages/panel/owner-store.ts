import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API } from '../../core/config';
import { OwnerBusiness, RocolaState } from '../../core/models';
import { RocolaLive } from '../../core/realtime';

/** Estado compartido del panel: negocio actual y cola en vivo. */
@Injectable({ providedIn: 'root' })
export class OwnerStore {
  private http = inject(HttpClient);
  readonly business = signal<OwnerBusiness | null>(null);
  private readonly liveSig = signal<RocolaLive | null>(null);
  readonly state = computed<RocolaState | null>(() => this.liveSig()?.state() ?? null);
  readonly connected = computed(() => this.liveSig()?.connected() ?? false);

  async load() {
    const b = await firstValueFrom(this.http.get<OwnerBusiness>(`${API}/owner/business/`));
    this.business.set(b);
    if (this.liveSig()?.slug !== b.slug) {
      this.liveSig()?.destroy();
      const live = new RocolaLive(b.slug, () => firstValueFrom(this.http.get<RocolaState>(`${API}/owner/queue/`)));
      live.refresh();
      this.liveSig.set(live);
    }
    return b;
  }

  async save(patch: Partial<OwnerBusiness>) {
    const b = await firstValueFrom(this.http.patch<OwnerBusiness>(`${API}/owner/business/`, patch));
    this.business.set(b);
    return b;
  }

  applyState(st: RocolaState) {
    this.liveSig()?.apply(st);
  }

  elapsedMs() {
    return this.liveSig()?.elapsedMs() ?? 0;
  }

  reset() {
    this.liveSig()?.destroy();
    this.liveSig.set(null);
    this.business.set(null);
  }
}
