import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, catchError, throwError } from 'rxjs';
import { API } from './config';
import { User } from './models';

const TOKEN_KEY = 'rocola.token';
const BIZ_KEY = 'rocola.business';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* modo privado */ }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly token = signal<string | null>(read(TOKEN_KEY));
  readonly user = signal<User | null>(null);
  readonly businessId = signal<number | null>(Number(read(BIZ_KEY)) || null);
  readonly isLogged = computed(() => !!this.token());
  readonly currentBusiness = computed(() => {
    const u = this.user();
    if (!u) return null;
    return u.businesses.find((b) => b.id === this.businessId()) ?? u.businesses[0] ?? null;
  });

  async login(username: string, password: string) {
    const res = await firstValueFrom(this.http.post<{ token: string; user: User }>(`${API}/auth/login/`, { username, password }));
    this.token.set(res.token);
    write(TOKEN_KEY, res.token);
    this.user.set(res.user);
    if (!res.user.businesses.some((b) => b.id === this.businessId())) this.selectBusiness(res.user.businesses[0]?.id ?? null);
    return res.user;
  }

  async register(data: Record<string, string>) {
    const res = await firstValueFrom(this.http.post<{ token: string; user: User }>(`${API}/auth/register/`, data));
    this.token.set(res.token);
    write(TOKEN_KEY, res.token);
    this.user.set(res.user);
    this.selectBusiness(res.user.businesses[0]?.id ?? null);
    return res.user;
  }

  /** Carga el usuario si hay token guardado. */
  async ensureUser(): Promise<User | null> {
    if (this.user()) return this.user();
    if (!this.token()) return null;
    try {
      const u = await firstValueFrom(this.http.get<User>(`${API}/auth/me/`));
      this.user.set(u);
      if (!u.businesses.some((b) => b.id === this.businessId())) this.selectBusiness(u.businesses[0]?.id ?? null);
      return u;
    } catch {
      this.clear();
      return null;
    }
  }

  selectBusiness(id: number | null) {
    this.businessId.set(id);
    write(BIZ_KEY, id ? String(id) : null);
  }

  logout() {
    this.http.post(`${API}/auth/logout/`, {}).subscribe({ error: () => {} });
    this.clear();
    this.router.navigateByUrl('/login');
  }

  clear() {
    this.token.set(null);
    this.user.set(null);
    write(TOKEN_KEY, null);
  }
}

/** Agrega el token y el negocio seleccionado a las peticiones del panel. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const isApi = req.url.startsWith(API);
  const isPublic = req.url.includes('/api/public/') || req.url.includes('/api/player/') || req.url.endsWith('/auth/login/') || req.url.endsWith('/auth/register/');
  if (!token || !isApi || isPublic) return next(req);
  const headers: Record<string, string> = { Authorization: `Token ${token}` };
  if (auth.businessId()) headers['X-Business'] = String(auth.businessId());
  return next(req.clone({ setHeaders: headers })).pipe(
    catchError((err) => {
      if (err?.status === 401) auth.logout();
      return throwError(() => err);
    }),
  );
};

export const ownerGuard = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureUser();
  return user ? true : router.parseUrl('/login');
};

export const superGuard = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureUser();
  return user?.is_superuser ? true : router.parseUrl(user ? '/panel' : '/login');
};

