import {
  ChangeDetectionStrategy, Component, ElementRef, inject, NgZone, OnDestroy, OnInit, output, signal, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import jsQR from 'jsqr';

/** Escáner de QR con la cámara del celular (funciona en Android y iPhone). */
@Component({
  selector: 'app-qr-scanner',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scanner">
      <video #video playsinline muted></video>
      <canvas #canvas hidden></canvas>
      <div class="scanner-frame animate-scale-in"><span class="scan-line"></span></div>
      <button class="btn icon scanner-close" (click)="closed.emit()" aria-label="Cerrar"><ion-icon name="close" /></button>
      <p class="scanner-hint glass animate-fade-up">
        @if (error()) { {{ error() }} } @else { Apunta al código QR de tu mesa }
      </p>
    </div>
  `,
})
export class QrScanner implements OnInit, OnDestroy {
  readonly closed = output<void>();
  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private router = inject(Router);
  private zone = inject(NgZone);
  readonly error = signal('');
  private stream?: MediaStream;
  private raf = 0;

  async ngOnInit() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Este navegador no permite usar la cámara aquí. Abre la cámara del celular y escanea el QR directamente.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const v = this.video().nativeElement;
      v.srcObject = this.stream;
      await v.play();
      this.zone.runOutsideAngular(() => (this.raf = requestAnimationFrame(this.tick)));
    } catch {
      this.error.set('No se pudo abrir la cámara. Dale permiso o escanea el QR con la cámara normal del celular.');
    }
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const v = this.video().nativeElement;
    if (v.readyState < 2) return;
    const c = this.canvas().nativeElement;
    const w = 480;
    const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (code?.data) {
      cancelAnimationFrame(this.raf);
      navigator.vibrate?.(40);
      this.zone.run(() => this.open(code.data));
    }
  };

  private open(text: string) {
    try {
      const url = new URL(text, location.origin);
      if (url.origin === location.origin) {
        this.router.navigateByUrl(url.pathname + url.search);
      } else {
        location.href = url.href;
      }
    } catch {
      this.error.set('Ese código no es de una rocola. Intenta con el QR de tu mesa.');
      this.zone.runOutsideAngular(() => (this.raf = requestAnimationFrame(this.tick)));
    }
  }
}
