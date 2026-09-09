# Eliminación y terminación anticipada

Esta versión sustituye los bloqueos por dependencias de la versión anterior.

- Eliminar inmueble, inquilino o contrato permite continuar aunque existan contratos vigentes, pagos, créditos, depósitos, documentos o mantenimiento.
- La confirmación HTML explica el efecto antes de Cancelar / Eliminar.
- El registro sale de las listas activas y queda en Historial. Los contratos vinculados se marcan Terminados; un contrato vigente registra como terminación el día de la operación, conservando su vencimiento original.
- Un inmueble queda Disponible cuando no tiene otro contrato vigente. Eliminar un contrato no retira al inquilino del directorio. Repetir la eliminación de un contrato anterior no modifica una ocupación nueva.
- Historial permite consultar inquilinos e inmuebles retirados, contratos terminados y sus pagos. Las referencias y archivos no se borran.
- Los reportes conservan movimientos y dejan de agregar renta en meses posteriores a la terminación. No se calculan prorrateos, penalizaciones, devoluciones ni condonaciones automáticas.
- Se conservan permisos de Administrador y Cobranza; los demás roles no reciben nuevos permisos. Se mantienen transacciones, control de versión y protección contra sobrescrituras.
- La información de baja se guarda en audit_log, sin migraciones de esquema ni variables nuevas. No se pueden reactivar registros retirados mediante una copia desactualizada.

## Validación

Rama de pruebas aislada de Neon: br-autumn-breeze-a65nnoor. No se realizaron eliminaciones de registros de producción durante las pruebas.

La prueba test/entity-deletion.mjs cubre permisos en los tres tipos de registro; eliminación de un inquilino con contrato vigente, depósito, pagos, créditos, documentos y mantenimiento; conservación de datos; cierre y liberación del inmueble; sincronización posterior; rechazo de reactivación; nueva ocupación; eliminación independiente de contrato; eliminación de inmueble con documentos; concurrencia; comparación con los datos originales y limpieza.

La prueba test/report-generation.mjs verifica reportes PDF/Excel existentes, conservación de recibos y saldos, ausencia de cargos posteriores al mes de terminación y exclusión de inmuebles retirados del cálculo de ocupación.

En navegador integrado conectado a la API de estado real y Neon se comprobó la confirmación de un contrato vigente, Cancelar, la eliminación del inquilino con contrato vigente y depósito, su ausencia de la lista activa y su aparición junto al contrato en Historial. Las respuestas de autenticación, usuarios y listado de archivos del servidor local son de prueba; estado y eliminación usan Neon real. No se utilizó iPhone físico ni simulador iOS.

Para repetir, usar Node 20+ con DATABASE_URL y TEST_DATABASE_HOST de una rama aislada en el entorno del proceso. Nunca guardar credenciales en el repositorio:

```
node test/entity-deletion.mjs
node test/report-generation.mjs
```

BROWSER_TEST=1 mantiene el servidor local para inspección; Ctrl+C limpia los registros temporales. El servidor de pruebas no forma parte de las rutas publicadas.
