# Validación de acceso de RentaControl

Cambio preparado el 11 de septiembre de 2026.

- La apertura y recarga exigen iniciar sesión. No se restaura automáticamente la sesión anterior.
- Al pasar a segundo plano se ocultan contenido y formularios; al regresar se vuelve a pedir identificación.
- La sesión anterior se revoca antes de enviar nuevas credenciales. Un fallo de conexión mantiene el acceso bloqueado.
- El inicio de sesión solo muestra datos si la nube respondió correctamente. Las respuestas de una sesión anterior no desbloquean la pantalla.
- Los cambios pendientes conservan una copia local descargable por el mismo usuario; nunca se aplican automáticamente sobre Neon.
- No se modificaron API, tablas, saldos ni permisos de Neon.

## Verificación realizada

Pruebas en navegador integrado con servidor local y datos sintéticos: apertura, recarga con sesión anterior, salida y regreso, nube no disponible, revocación fallida y reintento, cierre explícito, permisos Consulta/Mantenimiento, autocompletado sin interrupción, respuesta tardía y recuperación de contraseña. Todas pasaron. Servidor reproducible: test/session-harness.mjs.

Prueba fiscal existente: cálculos, historial, netos y exportación PDF/Excel aprobados.

## iPhone y Face ID

Proyecto iOS 1.1 (compilación 3) preparado con dominio asociado para Contraseñas de Apple y pantalla de privacidad cuando la aplicación deja de estar activa. Se conserva el inicio de sesión normal. La app no almacena contraseñas ni datos biométricos.

Comprobación de tipos Swift con SDK de iPhone: aprobada. La compilación completa del simulador falló porque CoreSimulator no tiene runtimes disponibles en este entorno. No se generó ni publicó una versión de App Store. Falta habilitar/verificar el dominio asociado al firmar, probar autocompletado y Face ID en un iPhone y enviar la actualización a Apple. Esta preparación no equivale a Face ID publicado o validado en dispositivo.

Referencia Apple: https://developer.apple.com/documentation/security/password-autofill
