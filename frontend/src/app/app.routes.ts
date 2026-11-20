import { Routes } from '@angular/router';
import { ownerGuard, superGuard } from './core/auth.service';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/landing/landing').then((m) => m.Landing), title: 'Rocola Pitalito' },
  { path: 'm/:slug', loadComponent: () => import('./pages/cliente/cliente').then((m) => m.Cliente), title: 'Pide tu canción' },
  { path: 'player/:slug', loadComponent: () => import('./pages/player/player').then((m) => m.Player), title: 'Reproductor' },
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login), title: 'Ingresar' },
  {
    path: 'panel',
    canActivate: [ownerGuard],
    loadComponent: () => import('./pages/panel/panel-shell').then((m) => m.PanelShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'cola' },
      { path: 'cola', loadComponent: () => import('./pages/panel/cola').then((m) => m.ColaPage), title: 'Cola' },
      { path: 'musica', loadComponent: () => import('./pages/panel/musica').then((m) => m.MusicaPage), title: 'Música' },
      { path: 'playlists', loadComponent: () => import('./pages/panel/playlists').then((m) => m.PlaylistsPage), title: 'Playlists' },
      { path: 'qr', loadComponent: () => import('./pages/panel/qr').then((m) => m.QrPage), title: 'Códigos QR' },
      { path: 'reglas', loadComponent: () => import('./pages/panel/reglas').then((m) => m.ReglasPage), title: 'Reglas' },
      { path: 'estadisticas', loadComponent: () => import('./pages/panel/stats').then((m) => m.StatsPage), title: 'Estadísticas' },
    ],
  },
  {
    path: 'plataforma',
    canActivate: [superGuard],
    loadComponent: () => import('./pages/plataforma/plataforma').then((m) => m.Plataforma),
    title: 'Plataforma',
  },
  { path: '**', redirectTo: '' },
];
