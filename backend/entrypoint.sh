#!/bin/sh
set -e
python manage.py migrate --noinput
python manage.py collectstatic --noinput >/dev/null
# Crea/actualiza el administrador si se definieron las variables
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  python manage.py crear_admin --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD"
fi
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
