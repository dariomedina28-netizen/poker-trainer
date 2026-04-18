# Skill: Generar Escenario de Entrenamiento

## Cuándo usar
Solo en el bloque Práctica Libre.

## Modos de generación

### Aleatorio
Generar un spot sorpresa sin input del usuario.
Variar posición, calle y tipo de oponente cada vez.

### Dirigido
El usuario describe lo que quiere practicar.
Interpretar su descripción y generar el spot correspondiente.

## Variables obligatorias de cada spot
- Posición del héroe y rival
- Tipo de oponente: Recreacional / Regular / Desconocido
- Calle: Preflop / Flop / Turn / River
- Acción previa
- Board (si aplica)
- Mano del héroe
- Pot actual en BBs
- Stack efectivo en BBs
- Decisión a tomar

## Reglas
- No repetir posición y calle consecutivamente en modo aleatorio
- 1 spot de preflop por cada 4 postflop mínimo
- Oponente recreacional: sesgo hacia spots de valor
- Oponente regular: spots más cercanos a GTO

## Formato de salida
🃏 SPOT — PRÁCTICA LIBRE

Calle: [X] | Posición: [X] vs [X] | Oponente: [X]
Stack efectivo: [X bb] | Pot: [X bb]

Acción previa:
[descripción]

Board: [X X X]
Tu mano: [X X]

¿Qué haces?
[ ] Bet [ ] Check [ ] Call [ ] Fold [ ] Raise