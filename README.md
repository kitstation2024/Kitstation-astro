# Kitstation

## Formularios

Los formularios envían los datos a `POST /api/enviar-formulario`. El endpoint entrega un correo interno a `MAIL_TO` y una respuesta automática al correo del usuario.

Configura estas variables de entorno en local o en Vercel (Production, y Preview si quieres probar previews):

```env
SMTP_HOST=smtp.tuservidor.com
SMTP_PORT=587
SMTP_USER=usuario_smtp
SMTP_PASS=contrasena_smtp
MAIL_FROM=web@tudominio.com
MAIL_TO=contacto@tudominio.com
PUBLIC_TURNSTILE_SITE_KEY=tu_site_key_publica_de_turnstile
TURNSTILE_SECRET_KEY=tu_secret_key_privada_de_turnstile
UPSTASH_REDIS_REST_URL=https://tu-instancia.upstash.io
UPSTASH_REDIS_REST_TOKEN=tu_token_de_upstash
```

`PUBLIC_TURNSTILE_SITE_KEY` es la única clave expuesta al navegador. `TURNSTILE_SECRET_KEY`, las credenciales SMTP y el token de Upstash son secretos de servidor: no los publiques ni les asignes prefijo `PUBLIC_`.

El endpoint de formularios exige una validación satisfactoria contra Turnstile antes de crear el transporte SMTP. Upstash Redis REST es opcional: si está configurado, aplica el límite de manera persistente entre instancias Serverless. Si no está configurado o no está disponible, se usa un límite en memoria de mejor esfuerzo: 5 intentos por IP cada 10 minutos para formularios y 30 para el chat. Ese respaldo no se comparte entre instancias de Vercel y puede reiniciarse al escalar o reciclar una función. Turnstile no tiene respaldo permisivo: si su token o validación falla, el envío se bloquea.

Después de guardarlas, redeploya el proyecto y prueba un formulario con un correo real. No publiques el archivo `.env` ni las credenciales en Git.
