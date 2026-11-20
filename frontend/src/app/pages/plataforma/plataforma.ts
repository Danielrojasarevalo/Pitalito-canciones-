import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonIcon, IonToggle } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { API } from '../../core/config';
import { Payment, PlatformBusiness } from '../../core/models';
import { errorMessage, ToastService } from '../../core/toast.service';
import { AmbientComponent, money } from '../../shared/ui';

interface Summary { pending: number; businesses: number; active: number; suspended: number; expiring_7d: number; mrr: number; income_month: number; requests_today: number; }

@Component({
  selector: 'app-plataforma',
  imports: [FormsModule, RouterLink, IonIcon, IonToggle, AmbientComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-ambient [notes]="false" />
    <main class="page plat">
      <header class="panel-head animate-fade-in">
        <a class="brand" routerLink="/"><span class="brand-disc"></span> Rocola<b class="grad-text">Pitalito</b></a>
        <span class="chip accent">Plataforma</span>
        <span class="spacer"></span>
        <a class="btn sm" routerLink="/panel"><ion-icon name="radio" /><span class="hide-sm">Panel de negocio</span></a>
        <button class="btn sm ghost" (click)="auth.logout()"><ion-icon name="log-out" /> Salir</button>
      </header>

      @if (summary(); as s) {
        <div class="kpis stagger">
          <div class="stat-card"><div class="stat-icon"><ion-icon name="storefront" /></div><div class="stat-value">{{ s.active }}<small class="faint">/{{ s.businesses }}</small></div><div class="stat-label">Negocios activos</div></div>
          <div class="stat-card"><div class="stat-icon"><ion-icon name="wallet" /></div><div class="stat-value">{{ money(s.mrr) }}</div><div class="stat-label">Ingreso mensual recurrente</div></div>
          <div class="stat-card"><div class="stat-icon"><ion-icon name="cash" /></div><div class="stat-value">{{ money(s.income_month) }}</div><div class="stat-label">Cobrado este mes</div></div>
          <div class="stat-card"><div class="stat-icon"><ion-icon name="calendar" /></div><div class="stat-value">{{ s.pending }}</div><div class="stat-label">Por aprobar · {{ s.expiring_7d }} vencen en 7 días</div></div>
        </div>
      }

      @if (pending().length) {
        <section class="card animate-fade-up" style="margin-top:18px">
          <h3 class="card-title"><ion-icon name="time" /> Solicitudes por aprobar <span class="chip warn">{{ pending().length }}</span></h3>
          <div class="biz-table stagger">
            @for (b of pending(); track b.id) {
              <div class="biz-row">
                <div class="meta"><b>{{ b.name }}</b><span class="faint small">{{ b.city }} · {{ b.phone || 'sin teléfono' }} · usuario: {{ b.owner_username }} {{ b.owner_email ? '· ' + b.owner_email : '' }}</span></div>
                <button class="btn sm danger" (click)="approve(b, false)"><ion-icon name="close" /> Rechazar</button>
                <button class="btn sm success" (click)="approve(b, true)"><ion-icon name="checkmark" /> Aprobar</button>
              </div>
            }
          </div>
        </section>
      }

      <section class="card animate-fade-up" style="margin-top:18px">
        <div class="row wrap" style="margin-bottom:12px">
          <h3 class="card-title" style="margin:0"><ion-icon name="storefront" /> Negocios</h3>
          <span class="spacer"></span>
          <button class="btn primary sm" (click)="openCreate()"><ion-icon name="add" /> Registrar negocio</button>
        </div>
        <div class="biz-table stagger">
          @for (b of approved(); track b.id) {
            <div class="biz-row" [class.off]="!b.subscription_ok">
              <div class="meta"><b>{{ b.name }}</b><span class="faint small">{{ b.city }} · usuario: {{ b.owner_username }} · /m/{{ b.slug }}</span></div>
              <span class="chip" [class.accent]="b.plan === 'premium'">{{ b.plan === 'premium' ? 'Premium' : 'Básico' }} · {{ money(b.monthly_price) }}</span>
              @if (b.approval === 'rejected') { <span class="chip bad">Rechazado</span>
                <button class="btn sm" (click)="approve(b, true)">Aprobar</button> }
              <span [class]="b.subscription_ok ? 'chip ok' : 'chip bad'">{{ b.subscription_ok ? 'Hasta ' + b.subscription_until : (b.is_active ? 'Vencida ' + b.subscription_until : 'Suspendida') }}</span>
              <span class="chip hide-sm">{{ b.songs_count }} canciones · {{ b.requests_30d }} pedidos/30d</span>
              <label class="mini-toggle"><span class="small faint">Activo</span>
                <ion-toggle [checked]="b.is_active" (ionChange)="setActive(b, $event.detail.checked)" /></label>
              <button class="btn sm success" (click)="openPay(b)"><ion-icon name="card" /> Pago</button>
            </div>
          } @empty { <div class="empty-state"><ion-icon class="empty-state-icon" name="storefront" /><h3>Sin negocios</h3></div> }
        </div>
      </section>
    </main>

    @if (creating()) {
      <div class="backdrop" (click)="creating.set(false)"></div>
      <form class="sheet glass stack" (ngSubmit)="create()">
        <h2>Registrar negocio</h2>
        <div class="field"><label>Nombre del negocio</label><input class="input" name="n" [(ngModel)]="nb.name" required /></div>
        <div class="form-grid">
          <div class="field"><label>Ciudad</label><input class="input" name="c" [(ngModel)]="nb.city" /></div>
          <div class="field"><label>Teléfono</label><input class="input" name="p" [(ngModel)]="nb.phone" /></div>
          <div class="field"><label>Plan</label><select class="input" name="pl" [(ngModel)]="nb.plan" (ngModelChange)="nb.monthly_price = $event === 'premium' ? 100000 : 60000">
            <option value="basico">Básico</option><option value="premium">Premium</option></select></div>
          <div class="field"><label>Precio mensual (COP)</label><input class="input" type="number" name="mp" [(ngModel)]="nb.monthly_price" /></div>
          <div class="field"><label>Usuario del dueño</label><input class="input" name="u" [(ngModel)]="nb.username" required autocomplete="off" /></div>
          <div class="field"><label>Contraseña</label><input class="input" name="pw" [(ngModel)]="nb.password" required minlength="6" autocomplete="new-password" /></div>
        </div>
        @if (formError()) { <p class="alert-error">{{ formError() }}</p> }
        <div class="row"><button type="button" class="btn ghost" (click)="creating.set(false)">Cancelar</button>
          <button class="btn primary" style="flex:1" [class.loading]="busy()">Crear negocio</button></div>
      </form>
    }

    @if (paying(); as b) {
      <div class="backdrop" (click)="paying.set(null)"></div>
      <form class="sheet glass stack" (ngSubmit)="pay(b)">
        <h2>Pago de {{ b.name }}</h2>
        <div class="form-grid">
          <div class="field"><label>Meses</label><input class="input" type="number" min="1" name="m" [(ngModel)]="np.months" (ngModelChange)="np.amount = $event * b.monthly_price" /></div>
          <div class="field"><label>Valor (COP)</label><input class="input" type="number" name="a" [(ngModel)]="np.amount" /></div>
          <div class="field"><label>Medio</label><select class="input" name="me" [(ngModel)]="np.method">
            <option>efectivo</option><option>nequi</option><option>daviplata</option><option>transferencia</option><option>wompi</option></select></div>
          <div class="field"><label>Referencia</label><input class="input" name="r" [(ngModel)]="np.reference" /></div>
        </div>
        <p class="faint small">La suscripción se extiende {{ np.months * 30 }} días.</p>
        @if (payments().length) {
          <div class="stack" style="gap:4px">
            <b class="small">Pagos anteriores</b>
            @for (p of payments(); track p.id) {
              <div class="row small muted"><span>{{ p.paid_at.slice(0, 10) }}</span><span>{{ p.method }}</span><span class="spacer"></span><b>{{ money(p.amount) }}</b></div>
            }
          </div>
        }
        <div class="row"><button type="button" class="btn ghost" (click)="paying.set(null)">Cancelar</button>
          <button class="btn primary" style="flex:1" [class.loading]="busy()">Registrar pago</button></div>
      </form>
    }
  `,
})
export class Plataforma implements OnInit {
  readonly auth = inject(AuthService);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  readonly list = signal<PlatformBusiness[]>([]);
  readonly pending = computed(() => this.list().filter((b) => b.approval === 'pending'));
  readonly approved = computed(() => this.list().filter((b) => b.approval !== 'pending'));
  readonly summary = signal<Summary | null>(null);
  readonly creating = signal(false);
  readonly paying = signal<PlatformBusiness | null>(null);
  readonly payments = signal<Payment[]>([]);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly money = money;
  nb = this.emptyBiz();
  np = { months: 1, amount: 0, method: 'efectivo', reference: '' };

  ngOnInit() { this.load(); }

  emptyBiz() {
    return { name: '', city: 'Pitalito', phone: '', plan: 'basico', monthly_price: 60000, username: '', password: '' };
  }

  async load() {
    const [list, summary] = await Promise.all([
      firstValueFrom(this.http.get<PlatformBusiness[]>(`${API}/platform/businesses/`)),
      firstValueFrom(this.http.get<Summary>(`${API}/platform/summary/`)),
    ]);
    this.list.set(list);
    this.summary.set(summary);
  }

  openCreate() {
    this.nb = this.emptyBiz();
    this.formError.set('');
    this.creating.set(true);
  }

  async create() {
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(this.http.post(`${API}/platform/businesses/`, this.nb));
      this.toast.ok(`Negocio «${this.nb.name}» creado`);
      this.creating.set(false);
      await this.auth.ensureUser().then(() => this.auth.user.set(null)).then(() => this.auth.ensureUser());
      this.load();
    } catch (err) {
      this.formError.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async approve(b: PlatformBusiness, ok: boolean) {
    try {
      await firstValueFrom(this.http.post(`${API}/platform/businesses/${b.id}/approve/`, { approved: ok }));
      this.toast.ok(ok ? `«${b.name}» aprobado` : `«${b.name}» rechazado`);
      this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  async setActive(b: PlatformBusiness, active: boolean) {
    try {
      await firstValueFrom(this.http.patch(`${API}/platform/businesses/${b.id}/`, { is_active: active }));
      this.toast.ok(active ? `${b.name} activado` : `${b.name} suspendido`);
      this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  async openPay(b: PlatformBusiness) {
    this.np = { months: 1, amount: b.monthly_price, method: 'efectivo', reference: '' };
    this.payments.set([]);
    this.paying.set(b);
    this.payments.set(await firstValueFrom(this.http.get<Payment[]>(`${API}/platform/businesses/${b.id}/payments/`)));
  }

  async pay(b: PlatformBusiness) {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post(`${API}/platform/businesses/${b.id}/payments/`, this.np));
      this.toast.ok('Pago registrado y suscripción extendida');
      this.paying.set(null);
      this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
