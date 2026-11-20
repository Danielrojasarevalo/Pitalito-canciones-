import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonIcon, IonSegment, IonSegmentButton } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';
import { errorMessage, ToastService } from '../../core/toast.service';
import { AmbientComponent } from '../../shared/ui';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, IonIcon, IonSegment, IonSegmentButton, AmbientComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-ambient />
    <main class="page login-wrap">
      <a class="btn sm ghost login-back" routerLink="/"><ion-icon name="arrow-back" /> Inicio</a>
      <form class="login-card glass animate-scale-in" (ngSubmit)="submit()">
        <a routerLink="/" class="brand center"><span class="brand-disc animate-float"></span></a>
        <h1>{{ mode() === 'login' ? 'Panel del negocio' : 'Registra tu negocio' }}</h1>
        <p class="muted">{{ mode() === 'login' ? 'Controla la música, la cola y tus códigos QR.' : 'El administrador aprobará tu cuenta para activarla.' }}</p>

        <ion-segment [value]="mode()" (ionChange)="setMode($any($event.detail.value))">
          <ion-segment-button value="login">Ingresar</ion-segment-button>
          <ion-segment-button value="register">Crear cuenta</ion-segment-button>
        </ion-segment>

        @if (mode() === 'register') {
          <div class="field animate-fade-up">
            <label for="bn">Nombre del negocio</label>
            <input id="bn" class="input" name="business_name" [(ngModel)]="reg.business_name" required />
          </div>
          <div class="form-grid animate-fade-up">
            <div class="field"><label for="ci">Ciudad</label><input id="ci" class="input" name="city" [(ngModel)]="reg.city" /></div>
            <div class="field"><label for="ph">Teléfono</label><input id="ph" class="input" name="phone" type="tel" [(ngModel)]="reg.phone" /></div>
          </div>
          <div class="field animate-fade-up">
            <label for="em">Correo</label>
            <input id="em" class="input" name="email" type="email" [(ngModel)]="reg.email" autocomplete="email" />
          </div>
        }

        <div class="field">
          <label for="u">{{ mode() === 'login' ? 'Usuario o correo' : 'Usuario' }}</label>
          <input id="u" class="input" name="username" [(ngModel)]="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="p">Contraseña</label>
          <div class="pass-wrap">
            <input id="p" class="input" name="password" [type]="show() ? 'text' : 'password'" [(ngModel)]="password"
                   [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'" required />
            <button type="button" class="btn icon sm ghost" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Ocultar' : 'Mostrar'">
              <ion-icon [name]="show() ? 'eye-off' : 'eye'" />
            </button>
          </div>
        </div>

        @if (error()) {
          @for (e of [errorKey()]; track e) { <p class="alert-error">{{ error() }}</p> }
        }

        <button class="btn primary lg block" type="submit" [class.loading]="loading()" [disabled]="!username || !password">
          @if (mode() === 'login') { <ion-icon name="lock-closed" /> Ingresar } @else { <ion-icon name="storefront" /> Crear cuenta }
        </button>
      </form>
    </main>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  readonly mode = signal<'login' | 'register'>('login');
  username = '';
  password = '';
  reg = { business_name: '', city: 'Pitalito', phone: '', email: '' };
  readonly loading = signal(false);
  readonly error = signal('');
  readonly errorKey = signal(0);
  readonly show = signal(false);

  setMode(m: 'login' | 'register') {
    this.mode.set(m);
    this.error.set('');
  }

  async submit() {
    this.loading.set(true);
    this.error.set('');
    try {
      if (this.mode() === 'login') {
        const user = await this.auth.login(this.username.trim(), this.password);
        this.router.navigateByUrl(user.is_superuser ? '/plataforma' : '/panel');
      } else {
        await this.auth.register({ ...this.reg, username: this.username.trim(), password: this.password });
        this.toast.ok('¡Cuenta creada! Queda pendiente de aprobación.');
        this.router.navigateByUrl('/panel');
      }
    } catch (err) {
      this.error.set(errorMessage(err, 'No se pudo completar.'));
      this.errorKey.update((k) => k + 1); // reinicia el "shake"
    } finally {
      this.loading.set(false);
    }
  }
}
