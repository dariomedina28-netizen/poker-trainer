# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Idioma:** Responder siempre en español.

## Commands

```bash
npm install    # Instalar dependencias
npm start      # Dev server (localhost:3000)
npm run build  # Build de producción
```

No hay test suite ni lint configurado. Variables de entorno en `.env.local` (no commitear).

## Contexto del usuario

- Jugador cash online NL5-NL10 en GGPoker y WPT Global (6-max / 8-max, deep stack frecuente)
- Academia: Mento Poker
- Leaks conocidos: sobrejuego de draws, errores en river (paga bluff catchers), mental game ligado a resultados, sunk cost fallacy, poca adaptación vs fish en WPT

## Arquitectura

SPA React 18 con Create React App. Toda la lógica vive en un único componente monolítico: [src/App.js](src/App.js). No hay backend — la app es puramente client-side.

Fuente de datos: **Google Sheets** (esquema v2). Todos los spots jugables vienen del Sheet.

> **Nota Fase A:** El bloque **Práctica Libre** (generación/evaluación dinámica con la Anthropic API) fue **retirado de la UI**. Su código (`SKILL_GENERAR`, `SKILL_EVALUAR`, `callClaude`, `PracticaLibreCard`, estados `pl*`) sigue en `App.js` pero **inalcanzable** (no hay botón que ponga `bloque="Práctica Libre"`). Se documenta abajo como legacy. `.env.local` con `REACT_APP_ANTHROPIC_API_KEY` ya no es necesaria mientras el bloque esté retirado.

---

## Google Sheets (fuente de datos — esquema v2)

- **Sheet ID:** `1G8Zgv5qxk1bAV1qrnnFlxRcoSlsSMd02XZUybsGx0-c`
- **Pestaña:** `v2` (la URL gviz termina en `&sheet=v2`).
- Los spots se obtienen en runtime via Google Visualization API (`gviz` endpoint). El Sheet debe ser público ("cualquier persona con el enlace puede ver").
- La fila 1 es el header; los datos empiezan en fila 2.
- `parseSpot()` convierte cada fila en un objeto estructurado.

**Columnas en orden exacto (19):**

| # | Columna | Notas |
|---|---------|-------|
| 1 | `tema` | Categoría del bloque |
| 2 | `tema_apunte` | Sub-categoría dentro del bloque |
| 3 | `conc` | Concepto trabajado |
| 4 | `calle` | Flop / Turn / River / Preflop |
| 5 | `hero` | Posición hero |
| 6 | `vill` | Posición villain |
| 7 | `stacks` | Tamaños de stack |
| 8 | `seq` | Secuencia de acciones (separador `\|` por calle) |
| 9 | `board` | Cartas comunitarias (separador `\|` por calle). Acepta símbolos (`A♥`) o letras (`Ah`) |
| 10 | `hand` | Mano del hero. Puede traer **variantes** separadas por `/` (ej. `7h 6h / 9c 8c`); al servir se elige una al azar |
| 11 | `opts` | Opciones a mostrar, separadas por `;`. **Ya no se auto-generan** (se eliminó `getOpts()`) |
| 12 | `aceptables` | Subconjunto de `opts` que cuenta como correcto, separado por `;` |
| 13 | `baseline` | Opcional. Frecuencias `Accion:pct;Accion:pct` (ej. `Call:35;Fold:65`) |
| 14 | `exploit` | Opcional. Texto libre: ajuste explotativo + read del que depende |
| 15 | `fuente` | Uno de: `matematica`, `consenso`, `poblacion`, `mento`, `solver`, `fundamento`, `sin_validar`. Vacío/desconocido → `sin_validar` |
| 16 | `ec` | Explicación corta |
| 17 | `el` | Explicación larga |
| 18 | `leaks` | Leaks asociados (separados por `;`) |
| 19 | `sens` | `TRUE` = desactiva la aleatorización de palos para ese spot |

### Evaluación, guard y variación de cartas (Fase A)

- **Evaluación honesta:** correcto si `chosen ∈ aceptables` (ya no igualdad con un único string).
- **Guard de integridad** (`validateSpot`): un spot es inválido si `opts` o `aceptables` están vacíos, o si algún `aceptable ∉ opts`. Los inválidos **no entran al pool jugable** y se listan en un contador rojo del panel izquierdo. Rivales se exime del guard (formato propio).
- **Variación isomórfica de palos** (`serveSpot`): al servir un spot se aplica una permutación aleatoria de los 4 palos a board **y** mano (la misma permutación a ambos), preservando la estructura (flush draws, rainbow, monotone). Los rangos nunca cambian. `sens=TRUE` la desactiva. Internamente las cartas se normalizan a letras y se renderizan con símbolos (`h=♥ d=♦ c=♣ s=♠`).
- **Feedback:** ✓/✗ + `ec` → barras de `baseline` (etiqueta "Baseline") → caja de `exploit` (etiqueta "Ajuste explotativo") → `el` → **badge de fuente** con color (`matematica`/`solver`=verde, `consenso`=azul, `mento`=morado, `poblacion`=ámbar, `fundamento`=azul claro, `sin_validar`=rojo "⚠ sin validar"). Tags de leaks igual que antes.
- **Filtro legacy:** toggle "Ocultar sin validar" (ON por defecto) esconde los spots con `fuente="sin_validar"` sin borrarlos del Sheet.

### Bloques y valores exactos de `tema`

Los botones del selector mapean 1:1 con el valor de la columna `tema`:

| Bloque UI | Valor en columna `tema` |
|-----------|------------------------|
| Todos | (sin filtro de tema) |
| Preflop | `Preflop RFI` |
| Calentamiento | `Calentamiento` |
| Mis leaks | `Mis leaks` |
| Recreacionales | `Recreacionales` |
| Rivales | `Rivales` |

Constantes en `App.js`: `TP="Preflop RFI"`, `TR="Recreacionales"`, `TV="Rivales"`.

### Bloque Rivales — formato especial

- Se renderiza con color **morado**, sin cartas, sin timeline; `serveSpot` no lo transforma.
- `board` = stats GGPoker: `VPIP: XX | PFR: XX | 3BET: XX | ATS: XX`
- `hand` = descripción del comportamiento observable del villain en mesa
- `opts` = siempre explícitas, nunca vacío; `aceptables` marca la respuesta correcta
- `seq` = vacío (no aplica)

### Bloque Mis leaks

Se alimenta cuando el usuario sube manos reales para analizar. Flujo: analizar manos → detectar patrones → convertir en spots con `tema="Mis leaks"`.

---

## Bloque Práctica Libre (LEGACY — retirado de la UI en Fase A)

> **Estado:** sin botón en el selector de bloques; el código permanece en `App.js` pero es inalcanzable. Esta sección se conserva por si se decide reactivarlo. Para reactivar: volver a añadir `"Práctica Libre"` al array de bloques en `LeftPanel`.

No usa Google Sheets. Los spots se generan en runtime llamando a la Anthropic API directamente desde el navegador (`anthropic-dangerous-direct-browser-access: true`). Modelo: `claude-haiku-4-5-20251001`.

### Prompts del sistema

Los prompts activos están hardcodeados como constantes **al inicio de `App.js`**:

| Constante | Propósito |
|-----------|-----------|
| `SKILL_GENERAR` | Prompt de sistema para generar un spot |
| `SKILL_EVALUAR` | Prompt de sistema para evaluar la respuesta del usuario |

> **Importante:** Los archivos `skills/generar-escenario.md` y `skills/evaluar-decision.md` son documentación de referencia pero **no se importan en runtime**. La fuente de verdad son las constantes en `App.js`. Si se modifica un skill, actualizar la constante correspondiente en `App.js` (y viceversa).

### Modos

- **Aleatorio:** Claude genera un spot sin input. Evita repetir calle/posición consecutiva (rastrea `plLastMeta`).
- **Dirigido:** El usuario escribe qué quiere practicar; Claude genera en base a eso.

### Formato de salida del spot (parseado por `parsePlSpot()`)

Claude devuelve el spot en este formato exacto para que la app pueda parsearlo y renderizarlo con los componentes visuales (`Timeline`, `Cards`):

```
Calle: [Preflop|Flop|Turn|River]
Posición: [pos héroe] vs [pos villain]
Oponente: [Recreacional|Regular|Desconocido]
Stacks: [X bb efectivos]
Pot: [X bb]
Seq: [acción preflop] | Flop: [acción flop] | Turn: [acción turn]
Board: [cartas flop] | [carta turn] | [carta river]
Mano: [carta1] [carta2]
Opts: [Opción1] | [Opción2] | [Opción3] | [Opción4]
```

- `Seq` y `Board` usan `|` como separador de calles — idéntico al formato de Google Sheets — para ser compatibles con los componentes `Timeline` y `Cards` existentes.
- Solo se incluyen calles hasta la activa.

### Feedback (parseado por `parsePlFeedback()`)

Claude devuelve el feedback en este formato (definido en `SKILL_EVALUAR`):

```
[✅ CORRECTO / ❌ INCORRECTO / ⚠️ ACEPTABLE]

Explicación corta:
[1-2 líneas]

---
¿Quieres análisis completo? (S/N)
```

`parsePlFeedback()` extrae `{verdict, ec, isCorrect, isAcceptable}` y los renderiza con el mismo diseño visual que los otros bloques (banner verde/rojo/ámbar + caja de análisis completo). El análisis completo se obtiene con una segunda llamada a la API.

---

## Flujo de trabajo para agregar spots nuevos (Google Sheets)

1. El usuario comparte un apunte (texto de Mento Poker).
2. Generar **30–50 spots mínimo** cubriendo todos los subtemas del apunte.
3. `tema_apunte` = nombre exacto del apunte nuevo.
4. Entregar **CSV completo** (todos los spots existentes + los nuevos) — el usuario lo importa en Sheets reemplazando todo; Vercel redespliega automáticamente.

### Reglas críticas al generar spots (esquema v2)

- El CSV entregado siempre incluye **todos** los spots (no solo los nuevos) y respeta el **orden exacto de las 19 columnas v2**.
- `seq`: separar calles con `|` → ej. `BTN abre | Flop: BB chequea BTN apuesta | Turn: BB chequea`
- `board`: separar calles con `|` → ej. `A♠ K♦ 2♣ | 7♥ | J♠` (símbolos o letras)
- `hand`: una mano o varias variantes separadas por `/` → ej. `7h 6h / 9c 8c`
- `opts`: separados por `;` — **obligatorio y no vacío** (ya no hay defaults automáticos)
- `aceptables`: subconjunto de `opts` separado por `;` — **obligatorio y no vacío**; todo `aceptable` debe estar en `opts` o el guard invalida el spot
- `baseline`: opcional, `Accion:pct;Accion:pct`
- `exploit`: opcional, texto libre
- `fuente`: obligatorio para contenido validado; el legacy sin validar va como `sin_validar` (queda oculto por defecto)
- `leaks`: separados por `;` sin espacios extra

---

## Styling

Todos los estilos son inline CSS-in-JS. El objeto `C` al inicio de `App.js` define la paleta de colores:
- Azul: bloques estándar / botón evaluar
- Morado: bloque Rivales
- Ámbar: caja de `exploit` ("Ajuste explotativo") y badge de fuente `poblacion`
- Badges de fuente (`SourceBadge`): verde (matematica/solver), azul (consenso), morado (mento), ámbar (poblacion), azul claro (fundamento), rojo (sin_validar)

Breakpoint responsivo en 900px (desktop = dos columnas sidebar+card; mobile = columna única). La interfaz está íntegramente en español.
