# RentaControl: recuperación y eliminación de usuarios

Base: 645b8b7df16e4215eaebe5cd9697b0f1167447bc (main descargado el 8 de septiembre de 2026).

## Cambios

- Recuperación: el correo oculto permanecía obligatorio y bloqueaba la validación nativa antes de ejecutar el envío. Ahora se deshabilita únicamente en recuperación; el inicio de sesión normal conserva su validación. Se muestra progreso y solo se acepta una respuesta explícita `ok: true`.
- API de recuperación: captura errores al conectar, límite de conexión de 10 segundos, y bloqueo del token dentro de la transacción para impedir dos confirmaciones concurrentes. Conserva hash SHA-256 del token, vencimiento, bcrypt y revocación de sesiones.
- Usuarios: botón Eliminar con confirmación. API restringida a administradores activos, prohíbe borrar la propia cuenta y vuelve a validar permisos dentro de la transacción. Conserva auditoría con identificación del usuario eliminado; las relaciones existentes conservan documentos y eliminan sesiones/tokens. Sin migraciones ni nuevas dependencias de producción.

## Validación realizada

En una rama aislada de Neon `test-reset-delete-20260908` (`br-little-bread-a6b3ngbn`):

- Solicitud de recuperación, generación del enlace de correo, confirmación y nuevo inicio de sesión con los endpoints reales.
- Contraseña anterior, sesión anterior y reutilización del token rechazadas.
- Token vencido/desconocido y contraseña corta rechazados; dos confirmaciones simultáneas producen un éxito y un rechazo.
- Eliminación autorizada para administrador; denegada para anónimo, Cobranza, Mantenimiento, Consulta y eliminación de la propia cuenta.
- Cuenta, sesiones y tokens eliminados; registro de auditoría conservado. Segunda eliminación devuelve 404.
- Usuarios temporales eliminados al terminar. No se cambiaron cuentas de producción. El archivo temporal de conexión fue eliminado.

También pasó la prueba de error de conexión. El navegador integrado verificó por separado el formulario con respuestas simuladas: envío con correo oculto vacío, éxito visible, error visible y botón disponible para reintentar.

Limitaciones: el navegador automatizado local no pudo arrancar. No se ejecutó en esta máquina una sola prueba que conectara el navegador con Neon; ambos componentes se verificaron por separado. El envío a Resend se interceptó para inspeccionar el enlace sin enviar correos. No se comprobó entrega real a una bandeja, ni se desplegó.

## Repetir las pruebas

Usar Node 20+ y las dependencias del proyecto. Para navegador, instalar Playwright como herramienta de pruebas y proporcionar CHROME_PATH si corresponde. Las pruebas de integración requieren DATABASE_URL y TEST_DATABASE_HOST de una rama aislada; nunca usar producción. PLAYWRIGHT_MODULE permite indicar una instalación externa de Playwright.

```
node test/reset-connection.mjs
node test/reset-browser.mjs
API_ONLY=1 node --env-file=.env.test test/reset-users.mjs
node --env-file=.env.test test/reset-users.mjs
```

El último comando ejecuta también el navegador, confirmación/cancelación de eliminación y login. El archivo de entorno debe contener DATABASE_URL y TEST_DATABASE_HOST; está excluido de Git y debe eliminarse al terminar.

## Despliegue

Aplicar el parche sobre la base indicada (o revisar conflictos si main avanzó). Publicar los tres archivos modificados mediante el despliegue habitual del repositorio en Vercel. Conservar DATABASE_URL, RESEND_API_KEY y RENTA_EMAIL_FROM existentes. No se requieren cambios de esquema. Después de desplegar, comprobar un enlace nuevo desde el correo y login con la contraseña nueva. La rama de pruebas de Neon se conserva para revisión; puede eliminarse cuando deje de necesitarse.

## Corrección de confirmación en iPhone

Se reemplazó `window.confirm` para eliminar usuarios por una ventana HTML dentro de la aplicación, porque el contenedor WKWebView inspeccionado no implementa el diálogo nativo de confirmación. Incluye cancelar, progreso, error visible y reintento; no cambia los endpoints ni el esquema.

Verificado en navegador integrado con API simulada: cancelar no envía eliminación; error 503 permanece visible; reintento exitoso elimina la fila ficticia y cierra la ventana. La prueba `node test/user-delete-authorization.mjs` verifica con conexiones simuladas que la API admite solamente administradores activos, rechaza los otros tres roles, anónimos, administradores inactivos y autoeliminación, y vuelve a comprobar permisos dentro de la transacción. Las pruebas de integración existentes se actualizaron para usar los botones HTML en vez de diálogos nativos. No se eliminaron usuarios reales durante estas comprobaciones.
