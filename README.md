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

El endpoint de formularios exige una validación satisfactoria contra Turnstile antes de crear el transporte SMTP. En Vercel Production también exige Upstash Redis REST para aplicar el máximo de 5 intentos por IP cada 10 minutos; si Upstash no está configurado o falla, el endpoint rechaza la solicitud con `503` para no depender de memoria efímera de una función serverless. El chat tiene un límite independiente de 30 mensajes por IP cada 10 minutos.

Después de guardarlas, redeploya el proyecto y prueba un formulario con un correo real. No publiques el archivo `.env` ni las credenciales en Git.
