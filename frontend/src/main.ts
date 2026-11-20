import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

/**
 * YouTube bloquea la música si la página se abre con un número IP (ej. 192.168.1.11).
 * En ese caso se redirige sola a la misma dirección con nip.io (ej. 192-168-1-11.nip.io),
 * que apunta al mismo computador pero YouTube sí la acepta.
 */
const host = location.hostname;
if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== '127.0.0.1') {
  const port = location.port ? ':' + location.port : '';
  location.replace(`${location.protocol}//${host.replaceAll('.', '-')}.nip.io${port}${location.pathname}${location.search}${location.hash}`);
} else {
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
}
