import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { AmbientComponent, EqComponent } from '../../shared/ui';
import { QrScanner } from './scanner';

@Component({
  selector: 'app-landing',
  imports: [RouterLink, IonIcon, AmbientComponent, EqComponent, QrScanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-ambient />
    <main class="page landing">
      <nav class="landing-nav animate-fade-in">
        <a class="brand" routerLink="/"><span class="brand-disc"></span> Rocola<b class="grad-text">Pitalito</b></a>
        <span class="spacer"></span>
        <a class="btn ghost sm" routerLink="/login"><ion-icon name="storefront" /> Soy un negocio</a>
      </nav>

      <section class="hero">
        <div class="hero-copy">
          <span class="chip accent animate-fade-up"><app-eq /> Rocola digital por QR</span>
          <h1 class="animate-fade-up" style="animation-delay:.06s">
            Tus clientes eligen<br /><span class="grad-text">la música</span> desde la mesa
          </h1>
          <p class="lead muted animate-fade-up" style="animation-delay:.12s">
            Escanean el QR, buscan la canción y entra a la cola. Sin instalar apps, sin registrarse
            y sin pagar suscripciones de música. Si nadie pide nada, tu playlist sigue sonando.
          </p>
          <div class="row wrap animate-fade-up" style="animation-delay:.18s">
            <button class="btn primary lg scan-cta" (click)="scanning.set(true)">
              <ion-icon name="qr-code" /> Escanear QR de la mesa
            </button>
            <a class="btn lg" routerLink="/login"><ion-icon name="storefront" /> Soy un negocio</a>
          </div>
          <a class="faint small demo-link animate-fade-up" style="animation-delay:.24s" routerLink="/m/bar-la-rocola" [queryParams]="{ mesa: 4 }">
            o prueba la demo como cliente →
          </a>
        </div>

        <div class="hero-art animate-scale-in" style="animation-delay:.1s" aria-hidden="true">
          <div class="hero-glow"></div>
          <div class="vinyl vinyl-spin">
            <div class="vinyl-label"><span></span></div>
          </div>
          <div class="hero-phone glass">
            <div class="hp-row"><i class="hp-cover a"></i><div><b></b><small></small></div><span class="hp-add">+</span></div>
            <div class="hp-row"><i class="hp-cover b"></i><div><b></b><small></small></div><span class="hp-add">+</span></div>
            <div class="hp-row"><i class="hp-cover c"></i><div><b></b><small></small></div><span class="hp-add">+</span></div>
          </div>
        </div>
      </section>

      <section class="steps stagger">
        @for (s of steps; track s.title) {
          <article class="stat-card">
            <div class="stat-icon"><ion-icon [name]="s.icon" /></div>
            <h3>{{ s.title }}</h3>
            <p class="muted">{{ s.text }}</p>
          </article>
        }
      </section>

      <footer class="landing-foot faint small">Hecho en Pitalito, Huila 🇨🇴</footer>
    </main>
    @if (scanning()) { <app-qr-scanner (closed)="scanning.set(false)" /> }
  `,
})
export class Landing {
  readonly scanning = signal(false);
  readonly steps = [
    { icon: 'qr-code', title: '1. Escanea', text: 'Cada mesa tiene su código QR. Se abre en el navegador del celular.' },
    { icon: 'search', title: '2. Busca y pide', text: 'El cliente busca por canción o artista y la agrega a la cola.' },
    { icon: 'volume-high', title: '3. Suena', text: 'El reproductor del negocio la pone a continuación. La música nunca para.' },
    { icon: 'shield-checkmark', title: 'Tú tienes el control', text: 'Límites por mesa, filtro explícito, artistas vetados, horarios y estadísticas.' },
  ];
}
