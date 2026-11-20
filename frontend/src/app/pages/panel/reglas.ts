import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonToggle } from '@ionic/angular';
import { OwnerBusiness } from '../../core/models';
import { errorMessage, ToastService } from '../../core/toast.service';
import { OwnerStore } from './owner-store';

@Component({
  selector: 'app-reglas',
  imports: [FormsModule, IonIcon, IonToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (form(); as f) {
      <form class="panel-grid two" (ngSubmit)="save()">
        <section class="card animate-fade-up">
          <h3 class="card-title"><ion-icon name="shield-checkmark" /> Control de pedidos</h3>
          <div class="toggle-row"><div><b>Recibir pedidos</b><p class="faint small">Apágalo para que solo suene tu playlist.</p></div>
            <ion-toggle [(ngModel)]="f.requests_enabled" name="re" /></div>
          <div class="toggle-row"><div><b>Bloquear contenido explícito</b><p class="faint small">Oculta las canciones marcadas como explícitas.</p></div>
            <ion-toggle [(ngModel)]="f.block_explicit" name="be" /></div>
          <div class="toggle-row"><div><b>Permitir dedicatorias</b><p class="faint small">Mensaje corto que aparece en la pantalla.</p></div>
            <ion-toggle [(ngModel)]="f.allow_dedications" name="ad" /></div>
          <div class="form-grid" style="margin-top:14px">
            <div class="field"><label>Canciones por mesa</label><input class="input" type="number" min="1" name="m" [(ngModel)]="f.max_requests_per_table" /></div>
            <div class="field"><label>Cada (minutos)</label><input class="input" type="number" min="1" name="w" [(ngModel)]="f.requests_window_minutes" /></div>
            <div class="field"><label>No repetir una canción en (min)</label><input class="input" type="number" min="0" name="r" [(ngModel)]="f.repeat_block_minutes" /></div>
            <div class="field"><label>Número de mesas</label><input class="input" type="number" min="1" max="200" name="t" [(ngModel)]="f.tables_count" /></div>
          </div>
        </section>

        <section class="card animate-fade-up" style="animation-delay:.05s">
          <h3 class="card-title"><ion-icon name="time" /> Horario y vetos</h3>
          <div class="form-grid">
            <div class="field"><label>Pedidos desde</label><input class="input" type="time" name="hs" [(ngModel)]="f.hours_start" /></div>
            <div class="field"><label>Hasta</label><input class="input" type="time" name="he" [(ngModel)]="f.hours_end" /></div>
          </div>
          <p class="faint small" style="margin:6px 0 14px">Déjalo vacío para permitir pedidos todo el día. Puede cruzar la medianoche (ej. 18:00 a 02:00).</p>
          <div class="field"><label>Artistas vetados</label>
            <textarea class="input" name="ba" rows="5" placeholder="Un artista por línea" [(ngModel)]="f.blocked_artists"></textarea>
            <span class="hint">Sus canciones no aparecerán para los clientes ni en la música de fondo.</span></div>
        </section>

        <section class="card animate-fade-up" style="animation-delay:.1s">
          <h3 class="card-title"><ion-icon name="storefront" /> Tu negocio</h3>
          <div class="form-grid">
            <div class="field"><label>Nombre</label><input class="input" name="n" [(ngModel)]="f.name" required /></div>
            <div class="field"><label>Ciudad</label><input class="input" name="c" [(ngModel)]="f.city" /></div>
            <div class="field"><label>Teléfono</label><input class="input" name="p" [(ngModel)]="f.phone" /></div>
            <div class="field"><label>Color de marca</label><input class="input color" type="color" name="ac" [(ngModel)]="f.accent_color" /></div>
          </div>
        </section>

        <div class="save-bar glass animate-fade-up">
          <span class="muted small">Plan {{ f.plan === 'premium' ? 'Premium' : 'Básico' }} · activo hasta {{ f.subscription_until }}</span>
          <span class="spacer"></span>
          <button class="btn primary" [class.loading]="saving()"><ion-icon name="checkmark" /> Guardar cambios</button>
        </div>
      </form>
    }
  `,
})
export class ReglasPage implements OnInit {
  private store = inject(OwnerStore);
  private toast = inject(ToastService);
  readonly form = signal<OwnerBusiness | null>(null);
  readonly saving = signal(false);

  ngOnInit() {
    const b = this.store.business();
    if (b) this.form.set({ ...b, hours_start: b.hours_start?.slice(0, 5) ?? null, hours_end: b.hours_end?.slice(0, 5) ?? null });
  }

  async save() {
    const f = this.form()!;
    this.saving.set(true);
    try {
      await this.store.save({
        ...f,
        hours_start: f.hours_start || null,
        hours_end: f.hours_end || null,
        background_playlist: undefined,
      });
      this.toast.ok('Reglas guardadas');
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
