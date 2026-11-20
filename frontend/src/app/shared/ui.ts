import {
  AfterViewInit, ChangeDetectionStrategy, Component, Directive, ElementRef, inject, input, OnDestroy,
} from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { mediaUrl } from '../core/config';
import { Song } from '../core/models';
import { ToastService } from '../core/toast.service';

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function money(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
}

/** Portada con sombra teñida del color de la canción. */
@Component({
  selector: 'app-cover',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cover" [style.width.px]="size()" [style.height.px]="size()" [style.border-radius.px]="radius()"
         [style.--cover-color]="song()?.color" [style.view-transition-name]="vtName() || null">
      @if (src()) {
        <img [src]="src()" [alt]="song()?.title" loading="lazy" />
      } @else {
        <div class="cover-fallback" [style.background]="'linear-gradient(135deg,' + (song()?.color || '#7c3aed') + ', #ec4899)'">
          <ion-icon name="musical-notes" />
        </div>
      }
      <ng-content />
    </div>
  `,
  styles: [':host{display:contents}'],
})
export class CoverComponent {
  song = input<Song | null | undefined>(null);
  size = input(52);
  radius = input(12);
  vtName = input<string>('');
  src() { return mediaUrl(this.song()?.cover_url); }
}

/** Ecualizador decorativo en CSS (4 barras). */
@Component({
  selector: 'app-eq',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="eq" [class.paused]="paused()" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`,
  styles: [':host{display:inline-flex}'],
})
export class EqComponent {
  paused = input(false);
}

/** Marquee: solo desplaza el texto cuando no cabe. */
@Directive({ selector: '[appMarquee]', host: { class: 'marquee' } })
export class MarqueeDirective implements AfterViewInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;
  private mo?: MutationObserver;

  ngAfterViewInit() {
    const check = () => {
      const host = this.el.nativeElement as HTMLElement;
      const inner = host.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const shift = inner.scrollWidth - host.clientWidth;
      host.classList.toggle('is-overflowing', shift > 4);
      host.style.setProperty('--marquee-shift', `${shift + 16}px`);
      host.style.setProperty('--marquee-dur', `${Math.max(5, shift / 18)}s`);
    };
    this.ro = new ResizeObserver(check);
    this.ro.observe(this.el.nativeElement);
    this.mo = new MutationObserver(check);
    this.mo.observe(this.el.nativeElement, { subtree: true, characterData: true, childList: true });
    check();
  }
  ngOnDestroy() {
    this.ro?.disconnect();
    this.mo?.disconnect();
  }
}

/** Fondo ambiental: manchas de color y notas que suben con tiempos aleatorios. */
@Component({
  selector: 'app-ambient',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ambient" aria-hidden="true"><span></span><span></span><span></span></div>
    @if (notes()) {
      <div class="ambient-notes" aria-hidden="true">
        @for (n of noteList; track $index) {
          <i [style.left.%]="n.left" [style.font-size.px]="n.size" [style.animation-duration.s]="n.dur" [style.animation-delay.s]="n.delay">{{ n.char }}</i>
        }
      </div>
    }
  `,
  styles: [':host{display:contents}'],
})
export class AmbientComponent {
  notes = input(true);
  readonly noteList = Array.from({ length: 12 }, () => ({
    left: Math.random() * 100,
    size: 14 + Math.random() * 18,
    dur: 14 + Math.random() * 14,
    delay: -Math.random() * 28,
    char: ['♪', '♫', '♬', '♩'][Math.floor(Math.random() * 4)],
  }));
}

/** Pila de notificaciones. */
@Component({
  selector: 'app-toasts',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-stack" role="status" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast glass" [class]="t.kind" [class.leaving]="t.leaving" (click)="toasts.dismiss(t.id)">
          <ion-icon [name]="t.kind === 'ok' ? 'checkmark-circle' : t.kind === 'error' ? 'alert-circle' : 'information-circle'" />
          <span>{{ t.text }}</span>
          <span class="toast-bar" [style.--toast-dur]="t.duration + 'ms'"></span>
        </div>
      }
    </div>
  `,
})
export class ToastsComponent {
  toasts = inject(ToastService);
}
