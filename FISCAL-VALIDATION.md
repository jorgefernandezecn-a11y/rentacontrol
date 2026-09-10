# Rentas con desglose fiscal

Base: 7433b26 (versión actual de RentaControl, con terminación e historial).

## Uso

En el detalle de Inmuebles, Inquilinos o contrato/Pagos, abrir **Renta e impuestos del contrato**. También está disponible al editar un inmueble o inquilino con contrato guardado.

Capturar renta bruta, clasificación PF/PM de ambas partes, régimen del arrendador y uso del inmueble. Cada impuesto admite porcentaje o importe fijo. La retención IVA porcentual se calcula sobre el IVA trasladado y ofrece la opción exacta de dos terceras partes; IVA e ISR porcentuales se calculan sobre la renta base. El formulario muestra importes y neto en tiempo real y guarda el desglose en Neon.

Las sugerencias requieren confirmación de residencia en México y reglas ordinarias sin tratamientos especiales, además de régimen y uso conocidos. Usos mixtos, regímenes desconocidos/especiales y demás casos no cubiertos se capturan manualmente. Ningún cambio de clasificación aplica automáticamente tasas: se utiliza el botón de sugerencias o captura manual.

## Compatibilidad e historial

- Migración aditiva: nueva columna nullable `contracts.rent_fiscal`. No se actualizan rentas, pagos, créditos ni depósitos existentes.
- `contracts.rent` conserva el importe esperado anterior. Antes del primer periodo fiscal se usa como neto sin inferir cuánto era base o impuesto; la interfaz indica que falta clasificar.
- Los cambios fiscales solo pueden aplicarse al mes actual o futuro, a partir del inicio del contrato. Se aplican a meses completos, sin prorrateo nuevo. Los periodos anteriores mantienen sus configuraciones y cargos.
- La renta anterior queda protegida una vez configurado el desglose; los cambios posteriores se hacen por periodos desde el formulario fiscal.
- Se conserva cada periodo configurado, se registran cambios en auditoría, y se rechaza quitar el historial, alterar meses anteriores, modificar importes fuera de rango o producir netos negativos.
- El servidor recalcula importes y neto; no confía en totales enviados por el cliente. La revisión del estado protege contra escrituras desde copias anteriores.
- Administrador y Cobranza conservan la facultad de escritura. Consulta y Mantenimiento no pueden cambiar impuestos; Mantenimiento puede sincronizar sus cambios sin alterar el desglose.
- Inicio, Inmuebles, Inquilinos, Pagos, saldos y reportes toman el neto correspondiente al mes consultado. Los depósitos mantienen su lógica anterior. El reporte de cartera identifica la renta del inmueble como referencia y añade el desglose contractual en una sección separada.
- Reportes PDF y Excel incluyen base, IVA, ambas retenciones y neto. Se conserva la lógica previa de pagos/anticipos y de terminación de contratos.

## Pruebas

Rama aislada Neon: `br-misty-glade-a6z9m18p`, creada desde producción; las pruebas no modificaron datos productivos.

- 10,000 + IVA 16% sin retenciones: 11,600. Pago 11,600: saldo cero, sin crédito ficticio.
- PF a PM, régimen general y uso gravado, bajo supuestos confirmados: 10,000 + 1,600 - 1,066.67 - 1,000 = 9,533.33.
- PF RESICO a PM, uso gravado, bajo supuestos confirmados: 10,000 + 1,600 - 1,066.67 - 125 = 10,408.33.
- Importes manuales: 10,000 + 1,600 - 800 - 1,000 = 9,800.
- Vivienda exclusiva sin muebles; clasificación incompleta y uso mixto sin sugerencia; porcentajes inválidos y retenciones excesivas rechazados.
- Migración conserva importes originales; guardado y lectura desde Neon; sincronización idéntica; controles de rol; rechazo de cliente anterior; recálculo de neto manipulado; archivo y sincronización de contrato fiscal.
- Navegador integrado: Inicio, Inmuebles, Inquilinos, Pagos, formulario fiscal, sugerencias general/RESICO, guardado para octubre, septiembre inalterado, recarga y recuperación de configuración guardada. Vista móvil de 390 × 844; sin errores de consola.
- Reportes descargados desde la API real contra Neon de prueba; Excel contiene 10,408.33 y PDF inspeccionado visualmente.
- Pruebas existentes de eliminación e historial, autorización para eliminar usuarios, error de conexión de recuperación y generación de reportes continúan pasando.

Límites: revisión en navegador con tamaño de iPhone, no en iPhone físico ni simulador iOS. La sesión del servidor local es de prueba; estado, cálculos, sincronización y reportes usan las implementaciones reales y Neon. No se realizaron pagos reales ni envíos de correo.

## Fuentes fiscales revisadas el 10/09/2026

- [LIVA artículo 1: tasa general](https://wwwmat.sat.gob.mx/articulo/19848/articulo-1).
- [LIVA artículo 20: exención de casa habitación](https://wwwmat.sat.gob.mx/articulo/39877/articulo-20).
- [RLIVA artículo 45: inmuebles amueblados](https://wwwmat.sat.gob.mx/articulo/01925/articulo-45).
- [RLIVA artículo 3: dos terceras partes del IVA](https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo88442.html).
- [LISR artículo 116: retención del régimen de arrendamiento](https://wwwmat.sat.gob.mx/articulo/53508/articulo-116).
- [LISR artículo 113-J: retención a PF RESICO](https://wwwmat.sat.gob.mx/articulo/59511/articulo-113-j).

## Publicación

Aplicar `migrations/20260910_contract_fiscal.sql` antes de publicar. La columna es compatible con la versión anterior. No eliminarla en una eventual reversión: conservar el historial fiscal. Tras configurar impuestos, una reversión del código anterior haría que esa versión desconociera los nuevos netos; se debe corregir hacia adelante o restaurar una versión que interprete el desglose.

## Estado de entrega

La migración aditiva se aplicó a producción el 10/09/2026. Se compararon huellas de los contratos (excluyendo la nueva columna), pagos y créditos antes y después: sin cambios.

El usuario autorizó explícitamente subir los cambios a GitHub y publicarlos en Vercel el 10/09/2026. La publicación se verifica por separado al finalizar el despliegue.
