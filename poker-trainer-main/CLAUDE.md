# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Idioma:** Responder siempre en español.

## Commands

```bash
npm install    # Instalar dependencias
npm start      # Dev server (localhost:3000)
npm run build  # Build de producción
```

No hay test suite configurado.

## Contexto del usuario

- Jugador cash online NL5-NL10 en GGPoker y WPT Global (6-max / 8-max, deep stack frecuente)
- Academia: Mento Poker
- Leaks conocidos: sobrejuego de draws, errores en river (paga bluff catchers), mental game ligado a resultados, sunk cost fallacy, poca adaptación vs fish en WPT

## Arquitectura

SPA React 18 con Create React App. Toda la lógica vive en un único componente monolítico: [src/App.js](src/App.js). No hay backend — la app es puramente client-side.

### Google Sheets (fuente de datos)

- **Sheet ID:** `1VxMfS1v0lRlaq6SNITzDjDOebrKYBQV8u2N1HkGyxQU`
- Los spots se obtienen en runtime via Google Visualization API (`gviz` endpoint).
- La fila 1 es el header; los datos empiezan en fila 2.
- `parseSpot()` convierte cada fila en un objeto estructurado.

**Columnas en orden exacto:**

| # | Columna | Notas |
|---|---------|-------|
| 1 | `tema` | Categoría del bloque |
| 2 | `calle` | Flop / Turn / River / Preflop |
| 3 | `conc` | Concepto trabajado |
| 4 | `hero` | Posición hero |
| 5 | `vill` | Posición villain |
| 6 | `stacks` | Tamaños de stack |
| 7 | `seq` | Secuencia de acciones (separador `\|`) |
| 8 | `board` | Cartas comunitarias (separador `\|` por calle) |
| 9 | `hand` | Mano del hero |
| 10 | `correct` | Acción correcta |
| 11 | `ec` | Explicación corta |
| 12 | `el` | Explicación larga |
| 13 | `sens` | Sensibilidad del spot |
| 14 | `leaks` | Leaks asociados (separados por `;`) |
| 15 | `opts` | Opciones de respuesta (separadas por `;`); vacío = la app calcula los defaults |
| 16 | `tema_apunte` | Sub-categoría dentro del bloque |

### Bloques y valores exactos de `tema`

| Bloque UI | Valor en columna `tema` |
|-----------|------------------------|
| Regulares | `SRP IP con iniciativa vs REG` |
| Recreacionales | `Juego vs recreacionales` |
| Rivales | `Rivales` |
| Calentamiento | `Calentamiento` |
| Mis leaks | `Mis leaks` |

### Apuntes (`tema_apunte`) por bloque

- `SRP IP con iniciativa vs REG` → `tema_apunte = "SRP IP con iniciativa vs REG"`
- `Juego vs recreacionales` → `tema_apunte` puede ser: `"Donkbets vs recreacionales"`, `"Tipo de flop vs recreacionales"`, `"Multiway vs recreacionales"`, `"ROL pots vs recreacionales"`
- `Calentamiento`, `Mis leaks`, `Rivales` → `tema_apunte` vacío

### Bloque Rivales — formato especial

- Se renderiza con color **morado**, sin cartas, sin timeline.
- `board` = stats GGPoker: `VPIP: XX | PFR: XX | 3BET: XX | ATS: XX`
- `hand` = descripción del comportamiento observable del villain en mesa
- `opts` = siempre explícitas (4 opciones separadas por `;`), nunca vacío
- `seq` = vacío (no aplica)

### Bloque Mis leaks

Actualmente vacío. Se alimenta cuando el usuario sube manos reales para analizar. Flujo: analizar manos → detectar patrones → convertir en spots con `tema="Mis leaks"`.

## Flujo de trabajo para agregar spots nuevos

1. El usuario comparte un apunte (texto de Mento Poker).
2. Generar **30–50 spots mínimo** cubriendo todos los subtemas del apunte.
3. `tema_apunte` = nombre exacto del apunte nuevo.
4. Entregar **CSV completo** (todos los spots existentes + los nuevos) — el usuario lo importa en Sheets reemplazando todo; Vercel redespliega automáticamente.

### Reglas críticas al generar spots

- **NUNCA modificar** spots con `tema="SRP IP con iniciativa vs REG"` salvo que el usuario lo pida explícitamente.
- El CSV entregado siempre incluye **todos** los spots (no solo los nuevos).
- `seq`: separar calles con `|` → ej. `BTN abre | Flop: BB chequea BTN apuesta | Turn: BB chequea`
- `board`: separar calles con `|` → ej. `A♠ K♦ 2♣ | 7♥ | J♠`
- `leaks`: separados por `;` sin espacios extra
- `opts`: separados por `;`; si vacío, la app calcula las opciones default

## Styling

Todos los estilos son inline CSS-in-JS. El objeto `C` al inicio de `App.js` define la paleta de colores. Breakpoint responsivo en 900px (desktop = dos columnas sidebar+card; mobile = columna única). La interfaz está íntegramente en español.
