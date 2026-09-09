# Eliminación segura de inmuebles e inquilinos

Base de producción: c1900367be5c6c1cbba22f20d08c17898023ebd1.

## Comportamiento

- Detalle y edición incluyen Eliminar inmueble / Eliminar inquilino.
- Confirmación HTML dentro de la aplicación, con Cancelar / Eliminar, foco inicial en Cancelar, progreso, bloqueo de doble envío y error visible. Compatible con el contenedor WKWebView existente, sin depender de window.confirm.
- Administrador y Cobranza conservan su permiso de escritura; Consulta, Mantenimiento, usuarios inactivos y sesiones ausentes no pueden eliminar estos registros.
- DELETE /api/state comprueba permisos, versión del estado, existencia, todas las referencias declaradas en PostgreSQL y depósitos de inquilinos. Bloquea contratos incluso terminados, y por ello conserva pagos y créditos. También bloquea mantenimiento incluso terminado, documentos y cualquier otra referencia declarada. No se introdujo archivado porque el sistema actual no tiene ese patrón.
- La operación utiliza una transacción, bloqueo del registro y auditoría. Un fallo revierte la eliminación. No elimina archivos externos.
- La sincronización usa actualizaciones en sitio en lugar de borrar y reinsertar todo: conserva documentos, fechas de creación y relaciones. Se protegen las fechas de PostgreSQL al serializarlas.
- La versión del estado evita sobrescrituras desde otro dispositivo o desde una copia anterior a la eliminación. Una versión antigua debe recargar la app; se rechazan escrituras sin revisión. Ante conflicto, se conserva una copia local en rentacontrol_v2_conflict_backup y se indica actualizar la app.
- No se pueden omitir inmuebles, inquilinos, contratos, pagos o créditos mediante PUT para eludir estas protecciones.
- Se conectó la función existente renderInsurance a render: faltaba la llamada en la base de producción, dejando vacía la sección a pesar de existir pólizas.

## Verificación

Pruebas en la rama aislada Neon test-property-tenant-delete-20260909 (br-autumn-breeze-a65nnoor), con credenciales solo en memoria del proceso; sin archivos de credenciales ni modificaciones de datos de producción.

- Eliminación libre, permisos, registro inexistente, copias antiguas y clientes sin revisión.
- Contratos históricos, pagos, créditos, mantenimiento terminado, documentos y depósitos bloquean la eliminación.
- Guardado completo conserva datos, fechas y documentos de inmuebles y seguros.
- Creación de inmuebles e inquilinos con identificadores temporales; dos eliminaciones simultáneas producen un éxito y un conflicto.
- Omisión de historial financiero rechazada; auditoría de las eliminaciones comprobada.
- Comparación de los registros originales antes y después; limpieza de los registros de prueba.
- Pruebas existentes de autorización para eliminar usuarios y manejo de error de conexión de recuperación de contraseña.
- Navegador integrado conectado al endpoint real de estado y la rama aislada: cancelar y eliminar ambos registros desde sus formularios, comprobar ausencia en listas y bloqueo visible de inquilino con contrato histórico.
- Navegación de Inicio, Inmuebles, Inquilinos, Pagos, Otros, Seguros y Usuarios. Se comprobó Seguros de nuevo tras conectar su función de actualización.

Límites: no se ejecutó en un iPhone físico ni en un simulador iOS. La prueba de navegador utiliza una sesión de prueba; sus respuestas de autenticación, usuarios y listado de archivos son controladas por el servidor de prueba. Estado, sincronización y eliminación sí utilizan el código real y Neon. La conservación de documentos se comprobó directamente en PostgreSQL. No se reenviaron correos ni se probaron pagos reales o descargas de informes.

## Repetir

Con Node 20+, las dependencias del proyecto y DATABASE_URL / TEST_DATABASE_HOST de una rama aislada en el entorno del proceso:

```
node test/entity-deletion.mjs
node test/user-delete-authorization.mjs
node test/reset-connection.mjs
```

BROWSER_TEST=1 mantiene un servidor local para revisión manual; Ctrl+C realiza la limpieza al terminar. El servidor es exclusivamente de prueba y no se publica como endpoint de la aplicación.

No se requieren migraciones ni cambios de variables de producción. La app iOS carga https://rentacontrol-ruddy.vercel.app; cerrar completamente y volver a abrir tras publicar carga la versión nueva.
