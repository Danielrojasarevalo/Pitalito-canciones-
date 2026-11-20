import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';
import { errorMessage, ToastService } from '../../core/toast.service';
import { AmbientComponent } from '../../shared/ui';
import { OwnerStore } from './owner-store';

@Component({
  selector: 'app-panel-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IonIcon, AmbientComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-ambient [notes]="false" />
    <div class="page panel">
      <aside class="panel-side glass">
        <a class="brand" routerLink="/"><span class="brand-disc"></span> Rocola<b class="grad-text">Pitalito</b></a>
        <nav class="panel-nav">
          @for (n of nav; track n.path) {
            <a [routerLink]="n.path" routerLinkActive="active"><ion-icon [name]="n.icon" /><span>{{ n.label }}</span></a>
          }
        </nav>
        <div class="panel-side-foot">
          @if (auth.user()?.is_superuser) {
            <a class="btn sm block" routerLink="/plataforma"><ion-icon name="shield-checkmark" /> Plataforma</a>
          }
          <button class="btn sm ghost block" (click)="logout()"><ion-icon name="log-out" /> Salir</button>
        </div>
      </aside>

      <section class="panel-main">
        <header class="panel-head animate-fade-in">
          <div class="truncate">
            @if (auth.user()?.businesses?.length! > 1) {
              <select class="input biz-select" [value]="auth.businessId()" (change)="switchBusiness(+$any($event.target).value)">
                @for (b of auth.user()!.businesses; track b.id) { <option [value]="b.id">{{ b.name }}</option> }
              </select>
            } @else {
              <h1 class="truncate">{{ store.business()?.name || '…' }}</h1>
            }
            <p class="faint small row" style="gap:8px">
              @if (store.connected()) { <span class="live-dot"></span> En vivo } @else { Conectando… }
              @if (store.business(); as b) {
                · <span [class]="b.subscription_ok ? 'chip ok' : 'chip bad'">
                    {{ b.subscription_ok ? 'Activa hasta ' + b.subscription_until : 'Suscripción vencida' }}</span>
              }
            </p>
          </div>
          <span class="spacer"></span>
          @if (store.business()?.approval === 'approved') {
            @let b = store.business()!;
            <a class="btn sm" [href]="'/m/' + b.slug" target="_blank"><ion-icon name="phone-portrait" /><span class="hide-sm">Vista cliente</span></a>
            <a class="btn primary sm" [href]="'/player/' + b.slug + '?token=' + b.player_token" target="_blank">
              <ion-icon name="tv" /><span class="hide-sm">Abrir reproductor</span>
            </a>
          }
          <button class="btn sm ghost" (click)="logout()" aria-label="Salir"><ion-icon name="log-out" /><span class="hide-sm">Salir</span></button>
        </header>

        @if (loadError()) {
          <div class="empty-state"><ion-icon class="empty-state-icon" name="storefront" /><h3>{{ loadError() }}</h3>
            @if (auth.user()?.is_superuser) { <a class="btn primary" routerLink="/plataforma">Crear un negocio</a> }</div>
        } @else if (store.business()?.approval === 'pending') {
          <div class="card empty-state animate-scale-in">
            <ion-icon class="empty-state-icon" name="time" />
            <h3>Tu negocio está pendiente de aprobación</h3>
            <p>El administrador revisará tu solicitud. Cuando sea aprobada podrás subir música, imprimir tus QR y abrir el reproductor.</p>
            <button class="btn" style="margin-top:16px" (click)="reload()"><ion-icon name="refresh" /> Revisar de nuevo</button>
          </div>
        } @else if (store.business()?.approval === 'rejected') {
          <div class="card empty-state animate-scale-in">
            <ion-icon class="empty-state-icon" name="ban" style="color:var(--danger)" />
            <h3>Tu solicitud no fue aprobada</h3><p>Comunícate con el administrador de la plataforma.</p>
          </div>
        } @else if (store.business()) {
          <router-outlet />
        }
      </section>

      <nav class="panel-tabs glass">
        @for (n of nav; track n.path) {
          <a [routerLink]="n.path" routerLinkActive="active"><ion-icon [name]="n.icon" /><span>{{ n.short }}</span></a>
        }
      </nav>
    </div>
  `,
})
export class PanelShell implements OnInit {
  readonly auth = inject(AuthService);
  readonly store = inject(OwnerStore);
  private toast = inject(ToastService);
  private router = inject(Router);
  readonly loadError = signal('');

  readonly nav = [
    { path: 'cola', label: 'Cola en vivo', short: 'Cola', icon: 'radio' },
    { path: 'musica', label: 'Música', short: 'Música', icon: 'musical-notes' },
    { path: 'playlists', label: 'Playlist de fondo', short: 'Fondo', icon: 'albums' },
    { path: 'qr', label: 'Códigos QR', short: 'QR', icon: 'qr-code' },
    { path: 'reglas', label: 'Reglas', short: 'Reglas', icon: 'settings' },
    { path: 'estadisticas', label: 'Estadísticas', short: 'Datos', icon: 'stats-chart' },
  ];

  async ngOnInit() {
    try {
      await this.store.load();
    } catch (err) {
      this.loadError.set(errorMessage(err, 'No se pudo cargar tu negocio.'));
    }
  }

  async switchBusiness(id: number) {
    this.auth.selectBusiness(id);
    this.store.reset();
    await this.store.load();
    this.toast.ok(`Administrando: ${this.store.business()?.name}`);
    this.router.navigateByUrl('/panel/cola');
  }

  async reload() {
    await this.store.load();
    if (this.store.business()?.approval === 'approved') this.toast.ok('¡Tu negocio fue aprobado!');
    else this.toast.show('Sigue pendiente de aprobación', 'info');
  }

  logout() {
    this.store.reset();
    this.auth.logout();
  }
}
