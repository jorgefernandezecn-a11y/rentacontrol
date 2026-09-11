# Datos específicos por tipo de seguro

- Coche: marca, modelo y año modelo.
- Inmueble: dirección del inmueble asegurado.
- Gastos médicos: asegurados, uno por línea.
- Vida: beneficiarios, uno por línea, reutilizando el campo existente sin perder sus valores.

Los campos se muestran al crear y editar según el tipo seleccionado, y en la lista y detalle de pólizas. Cambiar de tipo conserva los valores capturados. Los nuevos campos son opcionales para mantener compatibilidad con las pólizas existentes. Se conserva costo, vigencias, recordatorios, notas, beneficiario anterior y documentos.

Neon guarda los nuevos datos en la columna JSONB opcional `insurance_policies.details`. El servidor valida los valores, conserva los campos nuevos cuando un cliente anterior los omite y mantiene los permisos existentes. También se corrigió el nombre con codificación incorrecta de Gastos médicos en la normalización del servidor, que podía convertirlo a Inmueble.

## Validación

Rama aislada: br-lucky-base-a6p21g5w, creada desde producción.

Pruebas de creación, edición y lectura para los cuatro tipos; asegurados y beneficiarios con varios nombres; año inválido rechazado; sincronización con un cliente anterior sin pérdida de datos; permisos de Administrador/Cobranza, Consulta y Mantenimiento; revisión de estado anterior rechazada. Comparación de las pólizas originales antes y después de la migración. Los registros de prueba se eliminan al finalizar.

Revisión de navegador a 390 × 844: datos en las tarjetas y detalle; campos correctos al cambiar entre los cuatro tipos; edición y guardado de asegurados. La sesión y el listado de documentos del servidor local son de prueba; la API de estado y Neon son reales. No se usó un iPhone físico.

Pruebas fiscales existentes siguen pasando.

Migración aditiva: `migrations/20260910_insurance_details.sql`; ejecutar antes de desplegar.
