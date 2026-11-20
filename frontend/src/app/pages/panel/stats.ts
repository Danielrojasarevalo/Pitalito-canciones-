import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { IonIcon, IonSegment, IonSegmentButton } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { API } from '../../core/config';

interface Stats {
  total_requests: number;
  unique_clients: number;
  songs_in_catalog: number;
  played_today: number;
  top_songs: { song__id: number; song__title: string; song__artist: string; song__color: string; total: number }[];
  top_artists: { song__artist: string; total: number }[];
  by_table: { table: string; total: number }[];
  by_day: { day: string; total: number }[];
  by_hour: { hour: number; total: number }[];
}

@Component({
  selector: 'app-stats',
  imports: [IonIcon, IonSegment, IonSegmentButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row wrap" style="margin-bottom:16px">
      <ion-segment [value]="String(days())" (ionChange)="setDays(+$any($event.detail.value))" style="max-width:340px">
        <ion-segment-button value="7">7 días</ion-segment-button>
        <ion-segment-button value="14">14 días</ion-segment-button>
        <ion-segment-button value="30">30 días</ion-segment-button>
      </ion-segment>
    </div>

    @if (data(); as d) {
      <div class="kpis stagger">
        <div class="stat-card"><div class="stat-icon"><ion-icon name="musical-notes" /></div><div class="stat-value">{{ d.total_requests }}</div><div class="stat-label">Pedidos de clientes</div></div>
        <div class="stat-card"><div class="stat-icon"><ion-icon name="people" /></div><div class="stat-value">{{ d.unique_clients }}</div><div class="stat-label">Celulares distintos</div></div>
        <div class="stat-card"><div class="stat-icon"><ion-icon name="play" /></div><div class="stat-value">{{ d.played_today }}</div><div class="stat-label">Canciones sonadas hoy</div></div>
        <div class="stat-card"><div class="stat-icon"><ion-icon name="albums" /></div><div class="stat-value">{{ d.songs_in_catalog }}</div><div class="stat-label">Canciones en catálogo</div></div>
      </div>

      <div class="panel-grid two" style="margin-top:18px">
        <section class="card animate-fade-up">
          <h3 class="card-title"><ion-icon name="bar-chart" /> Pedidos por día</h3>
          <div class="vbars" role="img" [attr.aria-label]="'Pedidos por día, máximo ' + maxDay()">
            @for (x of d.by_day; track x.day; let i = $index) {
              <div class="vbar" [attr.data-tip]="label(x.day) + ': ' + x.total + ' pedidos'">
                <i [style.transform]="'scaleY(' + (x.total / maxDay()) + ')'" [style.transition-delay]="i * 25 + 'ms'"></i>
                @if (i % labelEvery() === 0) { <span>{{ shortDay(x.day) }}</span> }
              </div>
            }
          </div>
        </section>
        <section class="card animate-fade-up" style="animation-delay:.05s">
          <h3 class="card-title"><ion-icon name="time" /> Horas con más pedidos</h3>
          <div class="vbars hours" role="img" aria-label="Pedidos por hora del día">
            @for (x of d.by_hour; track x.hour; let i = $index) {
              <div class="vbar" [attr.data-tip]="x.hour + ':00 — ' + x.total + ' pedidos'">
                <i [style.transform]="'scaleY(' + (x.total / maxHour()) + ')'" [style.transition-delay]="i * 15 + 'ms'"></i>
                @if (x.hour % 6 === 0) { <span>{{ x.hour }}h</span> }
              </div>
            }
          </div>
        </section>
        <section class="card animate-fade-up" style="animation-delay:.1s">
          <h3 class="card-title"><ion-icon name="flame" /> Canciones más pedidas</h3>
          @for (s of d.top_songs; track s.song__id; let i = $index) {
            <div class="hbar" [attr.data-tip]="s.total + ' pedidos'">
              <span class="pos-num">{{ i + 1 }}</span>
              <div class="hbar-body"><div class="row"><b class="truncate">{{ s.song__title }}</b><span class="spacer"></span><span class="muted small">{{ s.total }}</span></div>
                <div class="hbar-track"><i [style.transform]="'scaleX(' + s.total / d.top_songs[0].total + ')'"></i></div>
                <span class="faint small">{{ s.song__artist }}</span></div>
            </div>
          } @empty { <p class="muted small">Todavía no hay pedidos en este periodo.</p> }
        </section>
        <section class="card animate-fade-up" style="animation-delay:.15s">
          <h3 class="card-title"><ion-icon name="people" /> Pedidos por mesa</h3>
          @for (t of d.by_table; track t.table) {
            <div class="hbar"><span class="chip">{{ t.table === 'Barra' ? 'Barra' : 'Mesa ' + t.table }}</span>
              <div class="hbar-body"><div class="hbar-track"><i [style.transform]="'scaleX(' + t.total / d.by_table[0].total + ')'"></i></div></div>
              <span class="muted small">{{ t.total }}</span></div>
          } @empty { <p class="muted small">Sin datos.</p> }
          @if (d.top_artists.length) {
            <h3 class="card-title" style="margin-top:20px"><ion-icon name="sparkles" /> Artistas favoritos</h3>
            <div class="row wrap">@for (a of d.top_artists; track a.song__artist) { <span class="chip accent">{{ a.song__artist }} · {{ a.total }}</span> }</div>
          }
        </section>
      </div>
    } @else {
      <div class="kpis">@for (i of [1,2,3,4]; track i) { <div class="skeleton" style="height:130px;border-radius:22px"></div> }</div>
    }
  `,
})
export class StatsPage implements OnInit {
  private http = inject(HttpClient);
  readonly data = signal<Stats | null>(null);
  readonly days = signal(14);
  readonly String = String;
  readonly maxDay = computed(() => Math.max(1, ...(this.data()?.by_day.map((d) => d.total) ?? [1])));
  readonly maxHour = computed(() => Math.max(1, ...(this.data()?.by_hour.map((d) => d.total) ?? [1])));
  readonly labelEvery = computed(() => (this.days() > 14 ? 5 : this.days() > 7 ? 2 : 1));

  ngOnInit() { this.load(); }
  setDays(d: number) { this.days.set(d); this.load(); }
  async load() {
    this.data.set(null);
    this.data.set(await firstValueFrom(this.http.get<Stats>(`${API}/owner/stats/`, { params: { days: this.days() } })));
  }
  shortDay(iso: string) {
    return new Date(iso + 'T12:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }
  label(iso: string) {
    return new Date(iso + 'T12:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  }
}
