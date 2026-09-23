# RentaControl — correcciones de inmuebles

Estado: correcciones validadas localmente y contra una rama aislada de Neon. Publicación en preparación.

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

## Validación directa en Neon

El conector rechazaba project_id; se accedió al panel oficial con la sesión iniciada por el usuario. Se creó desde main la rama temporal test-property-fixes-20260923 (br-purple-math-a6rslh8c), con caducidad automática de un día.

- test/entity-deletion.mjs pasó contra la base real: UUID estable, fechas sin inquilino persistentes, protección ante clientes antiguos, archivado sin dependencias y sincronización posterior, permisos de los roles, conservación de pagos/anticipos/depósitos/mantenimiento/documentos, terminación de contratos y concurrencia.
- Se compararon los registros originales antes/después y se limpiaron los datos sintéticos. La producción no recibió escrituras de pruebas.
- Se revisaron las foreign keys reales: contratos, pagos, créditos y mantenimiento tienen referencias restrictivas; documentos de inmueble y póliza tienen ON DELETE CASCADE. La acción usa archivado y no activa esos borrados.
- El rol de la aplicación tiene SELECT/INSERT/UPDATE sobre properties y SELECT/INSERT sobre audit_log.
- Recorrido en navegador conectado al backend real y a Neon completado: alta, sincronización, edición, fecha tras recarga, cancelar sin solicitud, confirmación del inmueble exacto, archivado y nueva recarga.
- La versión preliminar en Vercel compiló correctamente: dpl_GdR87zSqNBfpDR2u8XxDPaa6JbZV.

Repositorio: jorgefernandezecn-a11y/rentacontrol.
Base verificada en GitHub: 7646c52c86552bcc52bfda5b4386d2c2249efea1.
No se modificó producción ni se eliminaron datos reales.
