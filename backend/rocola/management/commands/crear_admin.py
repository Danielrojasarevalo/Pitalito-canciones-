"""Crea o actualiza el administrador de la plataforma.

Uso: python manage.py crear_admin --email correo@ejemplo.com --password TU_CLAVE
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Crea o actualiza el administrador de la plataforma"

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--password", required=True)

    def handle(self, *args, email, password, **kw):
        User = get_user_model()
        user = User.objects.filter(email__iexact=email).first() or User(username=email, email=email)
        user.is_staff = user.is_superuser = True
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Administrador listo: {email}"))
