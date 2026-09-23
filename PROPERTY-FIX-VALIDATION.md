# RentaControl — correcciones de inmuebles

Estado: preparado y probado localmente. No publicado. Validación directa en Neon pendiente.

## Causas y correcciones

- Los identificadores temporales del navegador eran reemplazados por UUID en el servidor. La pantalla abierta conservaba el identificador anterior: Editar y Eliminar dejaban de encontrar el inmueble. Ahora los registros nuevos reciben UUID desde el inicio.
- Sin inquilino, el formulario descartaba inicio y vencimiento. Ahora guarda fechas previstas y día de pago, visibles en listado, detalle y edición; al vincular un contrato se usan sus fechas. Los datos previstos se registran en audit_log, siguiendo el patrón de metadatos existente, sin fabricar contratos ni modificar el esquema.
- Se conserva la eliminación segura ya definida: archivar el inmueble y terminar contratos relacionados, con confirmación que nombra el registro y explica la conservación del historial. No se borran físicamente inmuebles ni relaciones.
- Los errores de eliminación permanecen visibles y permiten reintentar. Cancelar no envía la solicitud. Se mantienen los permisos actuales de Administrador y Cobranza; Consulta y Mantenimiento no pueden eliminar.
- Las fechas de registros existentes que ya se descartaron nunca llegaron al servidor. No se inventan ni recuperan automáticamente; deberán capturarse de nuevo.

## Validaciones completadas

1. Navegador integrado, pantalla de 390 px: reproducción contra el código anterior; alta, sincronización, edición, fechas tras recarga, confirmación/cancelación, error y reintento, eliminación del inmueble correcto y restricciones de Consulta. API simulada con conversión de identificadores y persistencia.
2. Pruebas de funciones reales del backend con consultas simuladas: UUID estable, escritura/lectura de fechas, calendario y orden de fechas válidos, orden canónico de JSONB, permisos, ausencia de escrituras repetidas y conservación de registros relacionados al archivar.
3. Regresión fiscal: cálculos, saldos netos, periodos históricos y generación PDF/Excel.
4. Regresión de acceso en navegador: inicio/cierre, segundo plano, permisos, errores de nube, recuperación de contraseña y recordar usuario.
5. Sintaxis JavaScript y revisión del diff sin errores.

## Pendiente antes de publicar

El conector Neon está instalado y habilitado pero rechaza llamadas indicando que falta project_id. Su interfaz actual no expone ese parámetro y tampoco lo transmite al suministrarlo. No se verificaron permisos SQL ni foreign keys contra la base viva. Las migraciones del repositorio contienen ON DELETE CASCADE para documentos; el archivado evita ejecutar esas eliminaciones.

Se amplió test/entity-deletion.mjs para comprobar fechas, clientes antiguos, UUID, archivado sin dependencias, relaciones e historial en una rama aislada de Neon. Esa prueba no se ejecutó en esta sesión por el bloqueo del conector.

Repositorio: jorgefernandezecn-a11y/rentacontrol.
Base verificada en GitHub: 7646c52c86552bcc52bfda5b4386d2c2249efea1.
No se modificó producción ni se eliminaron datos reales.
