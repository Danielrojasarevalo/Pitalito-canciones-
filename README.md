# Rocola Pitalito 🎵

Rocola digital por QR: los clientes piden canciones desde el celular y suenan en el negocio.
Backend **Django + Channels (WebSockets)**, frontend **Angular + Ionic**, base de datos **PostgreSQL**.

## Desarrollo (VS Code: abre 2 terminales)

**Terminal 1 — Backend**
```bash
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm start
```

Abre http://localhost:4200. Para los celulares, usa la IP de tu PC: `http://192.168.X.X:4200` (`hostname -I` te la dice).

## Usuarios
- **Administrador de la plataforma:** se crea con `python manage.py crear_admin --email TU_CORREO --password TU_CLAVE`
  (en Docker se crea solo con `ADMIN_EMAIL` y `ADMIN_PASSWORD` del archivo `.env`).
- **Datos de prueba:** `python manage.py seed_demo` crea un negocio demo con canciones de ejemplo.

## Despliegue con Docker
```bash
cp .env.example .env        # cambia la clave secreta
docker compose up -d --build
```
La app queda en el puerto 80. Para cargar los datos demo: `docker compose exec backend python manage.py seed_demo`.
