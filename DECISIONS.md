# Decisiones (y por qué)

Cada decisión con su alternativa descartada. Esto es lo que se explica en el
vídeo y en la entrevista: no "qué hice", sino "por qué encaja mejor".

## 1. Wingtra no es un tenant, es un tipo de sesión
- **Alternativa descartada:** Wingtra como raíz del árbol (padre de los distribuidores).
- **Por qué:** la regla "un padre ve a sus hijos" haría que Wingtra viera todo
  por herencia, sin que nadie lo decidiera. Si mañana la regla pasa a ser
  recursiva, la lógica cambia sin querer. Con `is_platform()` el acceso total es
  explícito y se puede buscar en el código.

## 2. El cliente final y el referral partner fuera del árbol
- **Por qué:** en el Figma están en la misma imagen, pero no son partners del
  canal. El cliente ve por `customer_id`; el referral ve otra tabla (`leads`) y
  nunca `licences`. Así "0 de 5" no depende de que nadie se acuerde de filtrar.

## 3. El aislamiento vive en la base de datos (RLS), no en la app
- **Alternativa descartada:** `WHERE tenant_id = ...` en cada consulta.
- **Por qué:** basta con olvidar un WHERE en un endpoint para filtrar datos de
  un partner a otro. Con RLS la consulta no lleva filtro y la base decide.
  Además, un `tenant_id = X` a mano rompería la vista del distribuidor, que no
  tiene licencias propias.
- **Coste aceptado:** la app debe declarar la sesión en cada transacción
  (`set_config(..., true)`); si no lo hace, recibe cero filas (fail-closed).
- **Límite honesto:** la base no puede saber si la app miente sobre quién es.
  Las variables de sesión las pone el servidor a partir del login, nunca el
  navegador.

## 4. La tabla del Figma es el test
- `db/test_who_sees_what.sql` comprueba fila por fila la tabla "Ve / No ve",
  ejecutándose como `hub_app` (un rol sin privilegios). Como superusuario el
  test pasaría por la razón equivocada: RLS no se aplica.

## 5. IDs legibles (`dealer-valencia`) en vez de UUID
- **Por qué:** es un prototipo para enseñar; en la demo y en el test se lee
  quién es quién. En producción serían UUID.

## 6. El panel de caducidades es una vista con `security_invoker`
- **Encontrado probando, no leyendo:** una vista normal se ejecuta con los
  permisos de su dueño (postgres) y se salta RLS. Dealer Valencia vio 5 de 5.
  Con `security_invoker = true`, la vista aplica las reglas de quien consulta.
- **Segundo fallo encontrado:** el cliente final no puede leer `tenants`, así
  que un `JOIN` normal hacía desaparecer su licencia. Pasa a `LEFT JOIN`.
- **Quién actúa:** el dealer a 90 días (es la primera línea); el distribuidor
  se suma a 30 días. Es una propuesta para validar con Wingtra, no un dato.

## 7. Un test que no puede fallar no prueba nada
- El primer test del panel dio "OK" con un resultado vacío: `NULL <> array` es
  NULL, no TRUE, y el `IF` no saltaba. Todas las comparaciones usan ahora
  `IS DISTINCT FROM`.
- Comprobado al revés: lanzado como superusuario (sin RLS), el test falla en
  Iberia Distribution (ve WR-2210 de Nordic). Así se sabe que tiene dientes.

## 8. TypeScript estricto, sin `any`, y zod en las fronteras
- `pg` devuelve las filas como `any`. Un cast (`rows as ExpiryRow[]`) sería
  mentirle al compilador. `queryRows` valida cada fila con un esquema zod y el
  tipo sale de ese esquema (`z.infer`): un solo sitio donde se define la forma.
- El id del actor llega de una cookie o un formulario, o sea de fuera: zod lo
  valida contra la lista; un valor inventado cae en el actor por defecto.
- Test con dientes: cambiando `SET LOCAL` por `SET` en `withSession`, el test
  "a pooled connection does not inherit the previous actor" falla.

## 9. La renovación pasa por el distribuidor (no se lo salta)
- **Por qué:** en el Figma (sección 1) el dinero sube por la jerarquía: el
  distribuidor es quien compra a Wingtra. Si el dealer pidiera directo a
  Wingtra, el pedido de Odoo saldría con el cliente de facturación equivocado.
  Por eso el pedido en Odoo va a nombre del distribuidor.
- **La base lo impone:** el dealer solo puede crear solicitudes dirigidas a SU
  distribuidor y para licencias SUYAS. Comprobado rompiendo la política: falla
  el test "cannot forge a request".
- **Pregunta abierta para Wingtra:** ¿algunos distribuidores dejan que sus
  dealers renueven sin aprobación (auto-approve por debajo de X)? Sería una
  opción por distribuidor, no un cambio de modelo.

## 10. Outbox entre "aprobado" y Odoo
- **Alternativa descartada:** llamar a Odoo dentro de la acción de aprobar.
- **Por qué:** son dos sistemas. Si Odoo falla después de aprobar, quedan en
  desacuerdo y nadie se entera. Con el outbox el evento se guarda en la misma
  transacción que la aprobación, y un dispatcher lo entrega con reintentos.
- **Coste aceptado:** entrega "al menos una vez". Odoo recibe `event_id` como
  referencia y no duplica pedidos. Probado: Odoo caído (el evento espera y
  registra el error) y caída a mitad (el pedido ya existía: no se duplica y la
  licencia se extiende una sola vez).
- **Simplificación consciente:** la licencia se extiende al crear el pedido. En
  la realidad seguramente sería al cobrar la factura. Pregunta para Wingtra.

## 11. Un doble clic no crea dos pedidos
- Índice único parcial: una sola solicitud abierta por licencia. Lo garantiza
  la base, no el botón. Test con dos peticiones simultáneas.
- Permisos por columna: el distribuidor puede cambiar el estado, pero no a qué
  licencia apunta la solicitud. 'ordered' solo lo pone el dispatcher.

## 12. Transferencia de dron: decide quien tiene la información, no soporte
- **Hoy (Figma, sección 2):** Drone ID de otro partner -> bloqueado -> email a
  soporte -> una persona decide a mano.
- **Propuesta:** el dealer pide la transferencia con un motivo. Decide el
  partner que tiene el dron o su distribuidor, que son quienes saben si el
  cliente se ha cambiado de verdad. Soporte solo entra si nadie contesta en 5
  días. Todo queda en `drone_events`, el historial que hoy vive en un email.
- **Privacidad:** comprobar un Drone ID responde solo "libre / tuyo / de otro
  partner", nunca de quién ni de qué cliente.
- **Una sola puerta para decidir:** `decide_transfer()` (SECURITY DEFINER),
  porque mueve filas que quien decide no puede tocar. Por eso toda la
  autorización está escrita ahí dentro y cubierta por tests. Los partners no
  tienen permiso de UPDATE sobre la tabla.
- **Regla de negocio:** no se transfiere un dron con una renovación abierta;
  quedaría facturada al dealer anterior.
- **Preguntas abiertas para Wingtra:** ¿las licencias activas viajan siempre
  con el dron? ¿5 días es razonable? ¿el solicitante debería ver quién es el
  dueño actual?

## 13. El fallo más importante del proyecto: un permiso que fallaba abierto
- El test "Wingtra support cannot jump in before the 5 days are up" falló:
  soporte SÍ podía decidir antes de tiempo.
- **Causa:** Wingtra no tiene tenant, así que `from_tenant_id =
  current_tenant()` da NULL; `NOT (NULL)` es NULL; y un `IF NULL` no entra, así
  que no se lanzaba el error. La misma trampa del NULL del punto 7, pero esta
  vez en una comprobación de permisos.
- **Arreglo:** cada comparación envuelta en `coalesce(..., false)`.
- **Lección:** en SQL, "deny if NOT allowed" es peligroso cuando "allowed"
  puede ser NULL. Calcular `allowed` como booleano estricto y probar cada actor
  que NO debe poder, no solo el que sí.

## 14. La capa de análisis encontró un hueco en el modelo de datos
- Para medir con cuánta antelación se pide una renovación hace falta saber qué
  caducidad renovaba cada solicitud. La app no lo guardaba: al renovar,
  `licences.expires_on` cambia y el dato se pierde para siempre.
- **Arreglo:** `renewal_requests.expires_on_at_request`, congelada al pedir. La
  política de INSERT exige que sea la fecha real; si no, un dealer podría
  maquillar su antelación en los informes. Hay un test para ello.
- **Lección:** pensar en cómo se medirá una función cambia cómo se guarda. Es
  más barato decidirlo antes de tener datos que reconstruirlo después.

## 15. Análisis separado de la app, con datos simulados y dicho en voz alta
- Otra base (`licence_hub_sim`) y otro usuario (`hub_analytics`): lee todas las
  filas porque agrega la red entera, pero no puede escribir en las tablas de la
  app. Es el papel de un data warehouse.
- **Por qué simulados:** 5 licencias no se pueden medir. La simulación tiene
  supuestos explícitos (Nordic renueva menos y aprueba más lento) y la página
  lo dice: "Simulated data, not Wingtra's". Los precios son ilustrativos.
- **Panel dentro de la app, no Metabase:** se publica con el prototipo y solo
  lo ve Wingtra. Metabase sería lo natural con un equipo de datos detrás.
- **Honestidad en los gráficos:** el primer eje empezaba en 40 % y pegaba al
  suelo los meses malos de Nordic (bajaron al 33 %). Ahora va de 0 a 100 %. Y
  el rango "licencias por punto" se calcula a partir de los datos: el texto
  fijo que escribí primero (3 a 15) era falso (es de 1 a 16).

## 16. El catálogo es una tabla: cuatro mecánicas de licencia, no una
- **Antes:** un solo tipo de licencia (suscripción, se renueva a mano, viaja
  con el dron) y nombres antiguos ("CLOUD Pro") escritos en el código.
- **Lo que encontré investigando** (`entrevistas/wingtra-gtm-junior/negocio-a-fondo.md`):
  Wingtra renombró sus planes (ESSENTIAL / PRO / UNLIMITED); LIDAR es perpetua
  con 3 años de actualizaciones; WingtraCARE se renueva sola con avisos a
  90/60/30 días y **no se transfiere** si se revende el dron.
- **Ahora:** tabla `products` con `renewal_mode` (manual / auto / perpetual),
  `term_years`, `anchor` y `transferable`. De ahí sale todo:
  - el panel: "Request renewal" solo en productos manuales; CARE dice "se
    renueva sola, baja posible hasta el X"; LIDAR, "sigue funcionando, terminan
    las actualizaciones";
  - la base: la política de INSERT rechaza renovar CARE o LIDAR (sería un
    pedido duplicado en Odoo). La app además da un mensaje claro antes;
  - el dispatcher: la duración de la renovación sale de `term_years`;
  - la transferencia: lo transferible pasa al nuevo dealer; CARE termina
    (`ended_at`) y queda en el historial. Quien decide lo ve ANTES de aprobar
    ("Moves" / "Ends"); el solicitante no ve las licencias ajenas;
  - el análisis: la tasa de renovación cuenta solo productos manuales. Que CARE
    se renueve sola no es mérito del portal.
- **Supuestos marcados:** el anclaje y la transferibilidad de PRO y UNLIMITED
  no son públicos. Son preguntas para Wingtra, no hechos.
- **Las cifras simuladas cambiaron** al regenerar con el catálogo nuevo (otra
  secuencia aleatoria): Nordic pasó de 59 % a 76 % de renovación. Con 5 a 15
  licencias por mes y distribuidor, esa diferencia era sobre todo ruido; la de
  tiempo de aprobación (46 h frente a 14 h de Iberia) se mantiene. **Lección:**
  no contar como hallazgo una diferencia que una nueva muestra borra.

## 17. Revisión de código completa (09.10): tres agujeros de permisos
Revisé archivo por archivo buscando fallos, y comprobé cada sospecha con un
ataque real como `hub_app` antes de darla por buena.

| # | Hallazgo | Gravedad | Arreglo | Test |
|---|---|---|---|---|
| 1 | **Un dealer podía escribir un evento "renovación aprobada" en el outbox.** El dispatcher creaba el pedido en Odoo a nombre del distribuidor y extendía la licencia un año, sin aprobación. Comprobado: pedido S00001, licencia hasta 2027-11-03 | Alta | La app ya no puede escribir en el outbox. El evento lo crea un trigger cuando una solicitud pasa de `pending` a `approved`, con datos de la base | `a dealer cannot write an "approved" event` |
| 2 | **El dispatcher se fiaba del payload del evento** (licencia, distribuidor) | Alta (con el 1) | Lee la solicitud por su id y solo factura si está `approved`; si no, descarta el evento (`discarded_at`) sin reintentar | `the dispatcher discards an event whose request was never approved` |
| 3 | **Un distribuidor podía pedir el dron de su propio dealer y aprobárselo él mismo** | Media | `decide_transfer()`: nadie decide su propia solicitud | `a distributor cannot approve its own request` |
| 4 | **Un referral partner podía pedir un dron**; si se aprobaba, vería sus licencias | Media | La política exige ser dealer o distribuidor | `a referral partner cannot request a drone` |
| 5 | `decideTransfer` convertía cualquier error (incluida una caída de la base) en "not found" y lo escondía | Baja | Solo traduce los rechazos conocidos; el resto se relanza | — |
| 6 | Sin `DATABASE_URL`, el pool se conectaba en silencio a otra base | Baja | `lib/env.ts` valida las URLs con zod | — |
| 7 | Insights daba un 500 si no existe la base de análisis; con datos vacíos diría "Infinity" | Baja | Mensaje claro y guarda contra la lista vacía | — |
| 8 | Los contadores de urgencia contaban WingtraCARE (se renueva sola) y licencias ya caducadas | Baja (UX) | Solo cuentan productos manuales | — |
| 9 | Textos desactualizados: "todas las licencias se mueven"; "Retrying · Odoo unavailable" ante cualquier error | Baja | Corregidos | — |

Los tests nuevos se comprobaron al revés: reabriendo los agujeros 1 y 4,
fallan exactamente esos dos tests.

**Lección:** los tests anteriores probaban lo que la app hace, no lo que un
usuario con acceso directo a su propio rol podría hacer. Ahora hay tests de
"intentos de saltarse la app" para cada escritura.

**Simplificaciones conocidas que siguen ahí** (no son fallos de la demo, pero
en producción se harían distinto): LIDAR dice anclarse a la carga útil pero no
hay tabla de cargas útiles; el cliente se guarda en el dron y en la licencia
sin nada que obligue a que coincidan; "unidad de demo" se deduce de
`customer_id IS NULL` en vez de ser una columna; un distribuidor no puede tener
licencias propias renovables aunque en la realidad también vende directo.

## 18. Ingreso recurrente: ARR, retención y un motor de renovaciones (11.10)
- **Qué:** términos reconstruidos, ARR mensual por cliente, puente de ARR,
  NRR/GRR, telemetría de uso simulada, banda de riesgo, precio de renovación
  recomendado, backtests y cartera por dealer (`analytics/`, ver su README).
- **ARR solo de PRO y UNLIMITED.** WingtraCARE se renueva sola y el portal no
  guarda sus términos (en producción, de las facturas de Odoo); LIDAR es venta
  perpetua.
- **Gracia de 30 días en el ARR** (`arr_grace_days`).
  - **Alternativa descartada:** sin gracia, cada renovación tardía sería una
    baja seguida de un alta y el puente mentiría.
  - **Coste:** quien no renueva cuenta 30 días de más. Por eso es una variable
    visible.
- **Reglas, no un modelo estadístico.**
  - Con ~250 términos resueltos, un modelo se sobreajusta; una regla se le
    explica a un dealer.
  - La regla vive en una macro y la usan el panel y el backtest. Así, al
    cambiarla se sabe si avisa mejor.
- **Uso contra el año pasado**, como el ritmo de reservas de Malco: comparar
  con los meses previos confunde el invierno nórdico con una baja.
- **La política de precio es una tabla (seed), no código:** es una decisión
  comercial de GTM. Una subida no necesita aprobación; un descuento sí.
- **Encontrado mirando los resultados:** Nordic tenía la peor renovación y el
  mejor NRR.
  - **Causa:** la simulación repartía las licencias de un cliente al azar en 3
    años, así que todo parecía ampliación.
  - **Arreglo:** ahora la compra es por dron y UNLIMITED llega después. Por eso
    cambian los números simulados anteriores.

## Cómo usé IA
Diseño (canal, bloqueo, preguntas, quién ve qué) hecho a mano en Figma. Con
Claude como pareja de programación: revisar la política del Figma (encontró que
solo cubría un nivel y que el cliente final no estaba en el árbol), escribir el
esquema y el test. Cada decisión de este archivo la discutí y la puedo defender.
