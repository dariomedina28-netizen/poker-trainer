import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";

const SHEET_ID = "1G8Zgv5qxk1bAV1qrnnFlxRcoSlsSMd02XZUybsGx0-c";
const SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=v2`;
const TP = "Preflop RFI";
const TD = "Defensa BB";
const TG = "SRP IP vs REG";
const TR = "Recreacionales";
const TV = "Rivales";

const SKILL_GENERAR = `# Skill: Generar Escenario de Entrenamiento
Solo en el bloque Práctica Libre.

## Modos de generación
### Aleatorio
Generar un spot sorpresa sin input del usuario. Variar posición, calle y tipo de oponente cada vez.
### Dirigido
El usuario describe lo que quiere practicar. Interpretar su descripción y generar el spot correspondiente.

## Reglas
- No repetir posición y calle consecutivamente en modo aleatorio
- 1 spot de preflop por cada 4 postflop mínimo
- Oponente recreacional: sesgo hacia spots de valor
- Oponente regular: spots más cercanos a GTO
- Usar símbolos de palos: ♠ ♥ ♦ ♣ en todas las cartas

## Formato de salida EXACTO — copia este formato sin añadir nada antes ni después

Calle: [Preflop|Flop|Turn|River]
Posición: [pos héroe] vs [pos villain]
Oponente: [Recreacional|Regular|Desconocido]
Stacks: [X bb efectivos]
Pot: [X bb]
Seq: [acción preflop sin prefijo] | Flop: [acción flop] | Turn: [acción turn] | River: [acción river]
Board: [cartas flop] | [carta turn] | [carta river]
Mano: [carta1] [carta2]
Opts: [Opción1] | [Opción2] | [Opción3] | [Opción4]

Reglas de formato:
- Seq: solo incluir calles hasta la calle activa. Preflop no lleva prefijo. Ej flop: "BTN abre 2.5bb BB llama | Flop: BB chequea BTN apuesta 4bb"
- Board: separar calles con |. Solo mostrar hasta la calle activa. Ej turn: "A♠ K♦ 2♣ | 7♥"
- Si es Preflop: Board y Seq solo tienen la parte preflop (sin pipes)
- Opts: opciones relevantes para la situación separadas por |`;

const SKILL_EVALUAR = `# Skill: Evaluar Decisión del Usuario
## Marco de análisis según rival
- Recreacional: explotativo — maximizar valor, simplificar
- Regular: base GTO con ajustes si hay reads
- Desconocido: GTO conservador

## Evaluar en este orden
1. ¿Consistente con el rango que representamos?
2. ¿Equity suficiente para la acción?
3. ¿Pot odds justifican la acción?
4. ¿La posición favorece o penaliza?
5. ¿El tipo de oponente cambia la jugada óptima?

## Formato fijo de feedback
[✅ CORRECTO / ❌ INCORRECTO / ⚠️ ACEPTABLE]

Explicación corta:
[1-2 líneas máximo]

---
¿Quieres análisis completo? (S/N)

## Si se solicita análisis completo
Concepto aplicado: [X]
Equity aproximado: [X%] (cuando aplique)
Pot odds: [X:1] (en river y draws siempre)
Jugada óptima: [X]

## Reglas
- Nunca solo correcto/incorrecto sin explicación
- Pot odds y equity siempre en river y draws
- Si falla el mismo concepto dos veces seguidas, señalarlo
- Tono: directo y técnico`;

async function callClaude(system, userMsg) {
  const key = process.env.REACT_APP_ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta REACT_APP_ANTHROPIC_API_KEY en .env.local");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.content[0].text;
}

const C = {
  bg:"#111827",bg2:"#1f2937",bg3:"#374151",
  border:"#374151",border2:"#4b5563",
  text:"#f9fafb",text2:"#9ca3af",text3:"#6b7280",
  blue:"#3b82f6",blueBg:"#1e3a5f",blueTxt:"#93c5fd",
  green:"#22c55e",greenBg:"#14532d",greenTxt:"#86efac",
  red:"#ef4444",redBg:"#450a0a",redTxt:"#fca5a5",
  amber:"#f59e0b",leak:"#7c2d12",leakTxt:"#ffedd5",
  purple:"#a855f7",purpleBg:"#3b1a5f",purpleTxt:"#d8b4fe",
};

// ── Normalización de cartas ───────────────────────────
// Acepta símbolos (A♥ K♦) o letras (Ah Kd). Internamente todo se guarda en
// letras (h/d/c/s). Se renderiza con símbolos vía SUIT_SYM.
const SUIT_SYM={h:"♥",d:"♦",c:"♣",s:"♠"};
const SYM_TO_LETTER={"♥":"h","♦":"d","♣":"c","♠":"s"};
const SUITS=["h","d","c","s"];

// Normaliza una sola carta a formato letra (ej. "A♥"→"Ah", "th"→"Th", "10d"→"Td").
function normCard(c){
  if(!c)return c;
  let t=c.trim();
  if(!t)return t;
  // separa palo (último char, sea símbolo o letra) del rango
  let suit=t.slice(-1);
  let rank=t.slice(0,-1);
  if(SYM_TO_LETTER[suit])suit=SYM_TO_LETTER[suit];
  else suit=suit.toLowerCase();
  if(!SUITS.includes(suit))return t; // no es una carta reconocible, se deja igual
  if(rank==="10")rank="T";
  rank=rank.toUpperCase();
  return rank+suit;
}

// Aplica un mapa de permutación de palos {h:'s',...} a una carta en letras.
function mapCardSuit(card,perm){
  if(!card||card==="|")return card;
  const suit=card.slice(-1);
  if(!perm[suit])return card;
  return card.slice(0,-1)+perm[suit];
}

// Convierte una cadena de cartas separadas por '|' (calles) / espacios en
// tokens normalizados a letras, preservando los '|' como separadores.
function normCardString(txt){
  if(!txt)return "";
  return txt.split("|").map(seg=>
    seg.trim().split(/\s+/).filter(Boolean).map(normCard).join(" ")
  ).join(" | ");
}

// Renderiza una carta en letras a símbolos para mostrar (ej. "Ah"→"A♥").
function displayCard(card){
  if(!card||card==="|")return card;
  const suit=card.slice(-1);
  if(!SUIT_SYM[suit])return card;
  return card.slice(0,-1)+SUIT_SYM[suit];
}

const FUENTES_VALIDAS=["matematica","consenso","poblacion","mento","solver","fundamento","sin_validar"];

function parseSpot(row){
  const split=(v)=>v?v.split(";").map(s=>s.trim()).filter(Boolean):[];
  const opts=split(row.opts);
  const aceptables=split(row.aceptables);
  // hand puede traer variantes separadas por '/'; cada variante se normaliza.
  const handVariants=(row.hand||"").split("/").map(v=>normCardString(v.trim())).filter(Boolean);
  let fuente=(row.fuente||"").trim().toLowerCase();
  if(!FUENTES_VALIDAS.includes(fuente))fuente="sin_validar";
  // baseline: "Accion:pct;Accion:pct" → [{accion,pct}]
  const baseline=split(row.baseline).map(p=>{
    const idx=p.lastIndexOf(":");
    if(idx<0)return null;
    const accion=p.slice(0,idx).trim();
    const pct=parseFloat(p.slice(idx+1));
    if(!accion||isNaN(pct))return null;
    return{accion,pct};
  }).filter(Boolean);
  return{
    tema:row.tema||"",tema_apunte:row.tema_apunte||"",conc:row.conc||"",
    calle:row.calle||"",hero:row.hero||"",vill:row.vill||"",stacks:row.stacks||"",
    seq:row.seq||"",
    board:row.board||"",   // crudo: Rivales lo usa como stats; póker lo normaliza al servir
    hand:row.hand||"",     // crudo: Rivales lo usa como descripción de texto
    handVariants,          // solo póker: variantes normalizadas a letras
    opts,aceptables,baseline,
    exploit:(row.exploit||"").trim(),
    fuente,
    ec:row.ec||"",el:row.el||"",
    leaks:split(row.leaks),
    sens:(row.sens||"").trim().toUpperCase()==="TRUE",
    // Columna opcional: si el Sheet no la tiene, queda "" y se usa el título por defecto.
    pregunta:(row.pregunta||"").trim(),
  };
}

// ¿El campo viene sin contenido real? ("", "—", "-", espacios)
function vacio(v){
  const t=(v||"").trim();
  return !t||t==="—"||t==="-";
}

function parseCards(txt){return txt?txt.trim().split(/\s+/).filter(Boolean):[];}

function Card({c,size="md"}){
  if(c==="|")return<span style={{fontSize:10,color:C.text3,padding:"0 6px",alignSelf:"center"}}>|</span>;
  const red=c.includes("♥")||c.includes("♦");
  const rank=c.slice(0,-1),suit=c.slice(-1);
  const w=size==="lg"?64:46,h=size==="lg"?80:58;
  const fs=size==="lg"?26:18,ss=size==="lg"?18:14;
  return(
    <div style={{display:"inline-flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      width:w,height:h,borderRadius:10,background:"#fff",
      border:`2px solid ${red?"#fca5a5":C.border2}`,fontWeight:800,userSelect:"none",flexShrink:0}}>
      <span style={{fontSize:fs,lineHeight:1,color:red?"#dc2626":"#111827"}}>{rank}</span>
      <span style={{fontSize:ss,lineHeight:1,marginTop:2,color:red?"#dc2626":"#111827"}}>{suit}</span>
    </div>
  );
}

function Cards({txt,board,calle,size="md"}){
  let cards=[];
  if(board){
    const parts=txt.split("|").map(s=>s.trim());
    const show=calle==="Flop"?[parts[0]]:calle==="Turn"?parts.slice(0,2):parts;
    show.forEach((seg,i)=>{if(i>0)cards.push("|");parseCards(seg).forEach(c=>cards.push(c));});
  }else{cards=parseCards(txt);}
  return<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>{cards.map((c,i)=><Card key={i} c={c} size={size}/>)}</div>;
}

// Timeline: SOLO indicador visual de en qué calle estamos (P—F—T—R). El texto
// de la historia de la mano vive aparte en <SecuenciaTexto> a ancho completo,
// para no truncarse en móvil (ver bug: acciones se cortaban bajo los nodos).
function Timeline({calle,size="md"}){
  const streets=["Preflop","Flop","Turn","River"];
  const activeIdx={Flop:1,Turn:2,River:3}[calle]||0;
  const dotSize=size==="lg"?36:28;
  const fs=size==="lg"?13:11;
  return(
    <div style={{display:"flex",gap:0,paddingBottom:4,marginBottom:16}}>
      {streets.map((s,i)=>{
        const active=i===activeIdx;
        return(
          <div key={s} style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:size==="lg"?100:72,position:"relative",flex:1}}>
            {i<3&&<div style={{position:"absolute",top:dotSize/2,left:"50%",width:"100%",height:1,background:C.border,zIndex:0}}/>}
            <div style={{width:dotSize,height:dotSize,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:fs,fontWeight:700,zIndex:1,
              background:active?C.blue:C.bg3,color:active?"#fff":C.text2,
              border:`2px solid ${active?C.blue:C.border}`}}>{s[0]}</div>
            <div style={{fontSize:fs,color:active?C.blueTxt:C.text2,marginTop:6,fontWeight:700}}>{s}</div>
          </div>
        );
      })}
    </div>
  );
}

// Separa `seq` ("Preflop: ... | Flop: ... | Turn: ... | River: ...") en una
// línea por calle. Devuelve null si no hay "|" (frase única) para que el
// caller la muestre completa sin desglosar. Los fragmentos con prefijo
// explícito ("Flop:", "Turn:", "River:") usan esa calle; los que no lo
// traen (habitual en el fragmento de preflop) heredan la siguiente calle
// en orden secuencial.
function parseSeqLines(seq){
  const parts=(seq||"").split("|").map(s=>s.trim()).filter(Boolean);
  if(parts.length<=1)return null;
  const streets=["Preflop","Flop","Turn","River"];
  let ptr=0;
  return parts.map(p=>{
    const m=p.match(/^(preflop|flop|turn|river)\s*:\s*(.*)$/i);
    let label,text;
    if(m){
      label=streets.find(s=>s.toLowerCase()===m[1].toLowerCase());
      text=m[2].trim();
      ptr=streets.indexOf(label)+1;
    }else{
      label=streets[Math.min(ptr,3)];
      text=p;
      ptr=Math.min(ptr+1,3);
    }
    return{label,text};
  });
}

// Resalta sizes (bb, %, fracciones tipo 3/4) dentro de un texto para lectura rápida.
function highlightSizes(text){
  const re=/\d+(?:\.\d+)?\s?bb|\d+(?:\.\d+)?%|\d+\/\d+/gi;
  const out=[];
  let last=0,m;
  while((m=re.exec(text))){
    if(m.index>last)out.push(text.slice(last,m.index));
    out.push(<strong key={m.index} style={{color:C.blueTxt,fontWeight:700}}>{m[0]}</strong>);
    last=m.index+m[0].length;
  }
  if(last<text.length)out.push(text.slice(last));
  return out;
}

// Bloque de texto legible a ancho completo con la historia de la mano —
// nunca trunca (sin ellipsis/max-height/line-clamp), hace wrap normal.
function SecuenciaTexto({seq,calle,size="md"}){
  const D=size==="lg";
  const raw=(seq||"").trim();
  const lines=parseSeqLines(raw);
  return(
    <div style={{background:C.bg3,border:`1px solid ${C.border2}`,borderRadius:12,padding:D?"14px 16px":"12px 14px",display:"flex",flexDirection:"column",gap:D?10:8}}>
      {!lines?(
        <div style={{fontSize:D?14:13,color:C.text,lineHeight:1.7}}>{highlightSizes(raw)}</div>
      ):lines.map((l,i)=>{
        const active=l.label===calle;
        return(
          <div key={i} style={{display:"flex",gap:10,alignItems:"baseline",flexWrap:"wrap",
            background:active?C.blueBg:"transparent",borderRadius:8,padding:"6px 8px"}}>
            <div style={{minWidth:D?64:56,flexShrink:0,fontSize:D?12:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".04em",
              color:active?C.blueTxt:C.text3}}>{l.label}</div>
            <div style={{flex:1,minWidth:0,fontSize:D?14:13,color:active?C.text:C.text2,lineHeight:1.7}}>{highlightSizes(l.text)}</div>
          </div>
        );
      })}
    </div>
  );
}

// Convierte un string de cartas normalizadas (letras, separadas por espacios y
// '|') a su representación con símbolos para mostrar.
function displayCards(txt){
  if(!txt)return "";
  return txt.split(/\s+/).filter(Boolean).map(displayCard).join(" ");
}

// ── Guard de integridad (Paso 4) ──────────────────────
// Devuelve {valid, reason}. Un spot inválido no entra al pool jugable.
function validateSpot(s){
  if(s.tema===TV)return{valid:true};   // Rivales tiene su propio formato (opts explícitas ya validadas por parse)
  if(!s.opts||!s.opts.length)return{valid:false,reason:"opts vacío"};
  if(!s.aceptables||!s.aceptables.length)return{valid:false,reason:"aceptables vacío"};
  const fuera=s.aceptables.filter(a=>!s.opts.includes(a));
  if(fuera.length)return{valid:false,reason:`aceptables fuera de opts: ${fuera.join(", ")}`};
  return{valid:true};
}

// ── Servido de spot con variación de cartas (Paso 5) ──
// Elige una variante de mano al azar y aplica una permutación isomórfica de
// palos a board + mano (la MISMA permutación a ambos). sens=TRUE la desactiva.
function shuffledPerm(){
  const s=[...SUITS];
  for(let i=s.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [s[i],s[j]]=[s[j],s[i]];
  }
  return{h:s[0],d:s[1],c:s[2],s:s[3]};
}
function applyPermToString(txt,perm){
  return txt.split(/\s+/).filter(Boolean)
    .map(tok=>tok==="|"?tok:mapCardSuit(tok,perm)).join(" ");
}
function serveSpot(spot){
  if(spot.tema===TV)return spot;   // Rivales: sin cartas, no se transforma
  const variants=spot.handVariants.length?spot.handVariants:[""];
  const handNorm=variants[Math.floor(Math.random()*variants.length)];
  const boardNorm=normCardString(spot.board);
  const perm=spot.sens?{h:"h",d:"d",c:"c",s:"s"}:shuffledPerm();
  return{
    ...spot,
    board:displayCards(applyPermToString(boardNorm,perm)),
    hand:displayCards(applyPermToString(handNorm,perm)),
  };
}

// ── Badge de fuente (Paso 3) ──────────────────────────
const FUENTE_META={
  matematica:{label:"Matemática",bg:C.greenBg,txt:C.greenTxt,bd:C.green},
  solver:{label:"Solver",bg:C.greenBg,txt:C.greenTxt,bd:C.green},
  consenso:{label:"Consenso",bg:C.blueBg,txt:C.blueTxt,bd:C.blue},
  fundamento:{label:"Fundamento",bg:"#0b2f3a",txt:"#7dd3fc",bd:"#38bdf8"},   // azul claro
  mento:{label:"Mento Poker",bg:C.purpleBg,txt:C.purpleTxt,bd:C.purple},
  poblacion:{label:"Población",bg:"#451a03",txt:"#fbbf24",bd:C.amber},        // ámbar
  sin_validar:{label:"⚠ sin validar",bg:C.redBg,txt:C.redTxt,bd:C.red},
};
function SourceBadge({fuente}){
  const m=FUENTE_META[fuente]||FUENTE_META.sin_validar;
  return <span style={{fontSize:11,padding:"3px 10px",borderRadius:99,background:m.bg,color:m.txt,
    border:`1px solid ${m.bd}`,fontWeight:700,whiteSpace:"nowrap"}}>{m.label}</span>;
}

// Barras de frecuencia baseline (Paso 3)
function BaselineBars({items,D}){
  if(!items||!items.length)return null;
  return(
    <div style={{background:C.bg3,borderRadius:12,padding:D?"14px 16px":"11px 13px",marginBottom:D?12:10,border:`1px solid ${C.border}`}}>
      <div style={{fontSize:D?11:10,color:C.text2,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,marginBottom:10}}>Baseline</div>
      {items.map((it,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<items.length-1?7:0}}>
          <span style={{fontSize:D?13:12,color:C.text,minWidth:88,fontWeight:600}}>{it.accion}</span>
          <div style={{flex:1,height:8,background:C.bg,borderRadius:4,overflow:"hidden"}}>
            <div style={{width:Math.max(0,Math.min(100,it.pct))+"%",height:"100%",background:C.blue,borderRadius:4}}/>
          </div>
          <span style={{fontSize:D?13:12,color:C.blueTxt,fontWeight:700,minWidth:40,textAlign:"right"}}>{it.pct}%</span>
        </div>
      ))}
    </div>
  );
}

// Caja de ajuste explotativo (Paso 3)
function ExploitBox({text,D}){
  if(!text)return null;
  return(
    <div style={{background:"#3a2a05",borderRadius:12,padding:D?"14px 16px":"11px 13px",marginBottom:D?12:10,border:`1px solid ${C.amber}`}}>
      <div style={{fontSize:D?11:10,color:"#fbbf24",textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,marginBottom:8}}>Ajuste explotativo</div>
      <div style={{fontSize:D?14:13,color:"#fde68a",lineHeight:1.6}}>{text}</div>
    </div>
  );
}

const DIV=<div style={{borderTop:`1px solid ${C.border}`,margin:"16px 0"}}/>;

// ── Fase C: agregaciones de progreso ──────────────────
const MS_DAY=86400000;
const ORDEN_CALLE=["Preflop","Flop","Turn","River"];
const DOM_MIN_INTENTOS=20;   // mínimo para que un lote califique
const DOM_VENTANA=30;        // se mira sobre los últimos 30 intentos del tema
const DOM_UMBRAL=85;         // ≥85% = lote dominado

const pct=(ok,n)=>n?Math.round(ok/n*100):null;
const accColor=a=>a===null?C.text3:a>=85?C.greenTxt:a>=60?C.amber:C.redTxt;

// Resumen de fin de sesión: id único por sesión de navegador (no persiste en localStorage a propósito).
function makeSessionId(){
  if(typeof crypto!=="undefined"&&crypto.randomUUID)return crypto.randomUUID();
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
}

// rows llegan ordenadas por created_at DESC (más reciente primero)
function aggProgreso(rows){
  const now=Date.now(), corte30=now-30*MS_DAY;
  const es30=r=>new Date(r.created_at).getTime()>=corte30;
  const acumular=(mapa,clave,r)=>{
    if(!mapa[clave])mapa[clave]={clave,ok:0,n:0,ok30:0,n30:0,ultimos:[]};
    const e=mapa[clave];
    e.n++; if(r.correcto)e.ok++;
    if(es30(r)){e.n30++; if(r.correcto)e.ok30++;}
    if(e.ultimos.length<DOM_VENTANA)e.ultimos.push(r);   // DESC ⇒ los primeros son los más recientes
    return e;
  };
  const peorPrimero=(a,b)=>(a.ok/a.n)-(b.ok/b.n);

  const mLeak={},mCalle={},mTema={};
  rows.forEach(r=>{
    (r.leaks||[]).forEach(l=>{if(l)acumular(mLeak,l,r);});
    acumular(mCalle,r.calle||"—",r);
    acumular(mTema,r.tema||"—",r);
  });

  const porLeak=Object.values(mLeak).sort(peorPrimero);
  const porCalle=Object.values(mCalle).sort((a,b)=>{
    const ia=ORDEN_CALLE.indexOf(a.clave), ib=ORDEN_CALLE.indexOf(b.clave);
    return (ia<0?99:ia)-(ib<0?99:ib);
  });
  const porTema=Object.values(mTema).map(e=>{
    const u=e.ultimos, uOk=u.filter(r=>r.correcto).length, uAcc=pct(uOk,u.length);
    const califica=u.length>=DOM_MIN_INTENTOS;
    return{...e,ultN:u.length,ultAcc:uAcc,dominado:califica&&uAcc>=DOM_UMBRAL,faltanDatos:!califica};
  }).sort(peorPrimero);

  // Tendencia: accuracy global de las últimas 8 semanas (la última es la actual)
  const semanas=[];
  for(let i=7;i>=0;i--){
    const fin=now-i*7*MS_DAY, ini=fin-7*MS_DAY;
    const rs=rows.filter(r=>{const t=new Date(r.created_at).getTime();return t>=ini&&t<fin;});
    const ok=rs.filter(r=>r.correcto).length;
    semanas.push({label:i===0?"Ahora":`−${i}s`,n:rs.length,acc:pct(ok,rs.length)});
  }

  const totalOk=rows.filter(r=>r.correcto).length;
  return{porLeak,porCalle,porTema,semanas,totalN:rows.length,totalOk,accGlobal:pct(totalOk,rows.length)};
}

// Fila: nombre + accuracy 30 días vs histórico total
function FilaAcc({nombre,e,D,extra}){
  const a30=pct(e.ok30,e.n30), aTot=pct(e.ok,e.n);
  const Celda=({a,n})=>(
    <div style={{textAlign:"right",minWidth:D?74:64}}>
      <span style={{fontSize:D?14:13,fontWeight:700,color:accColor(a)}}>{a===null?"—":a+"%"}</span>
      <span style={{fontSize:11,color:C.text3,marginLeft:5}}>({n})</span>
    </div>
  );
  return(
    <div style={{padding:D?"10px 0":"9px 0",borderTop:`1px solid ${C.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{flex:1,minWidth:0,fontSize:D?13:12,color:C.text,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{nombre}</span>
          {extra}
        </div>
        <Celda a={a30} n={e.n30}/>
        <Celda a={aTot} n={e.n}/>
      </div>
      <div style={{height:4,borderRadius:99,background:C.bg3,marginTop:7,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${aTot||0}%`,background:accColor(aTot),transition:"width .2s"}}/>
      </div>
    </div>
  );
}

// Encabezado de las dos columnas (30 días / total)
function CabeceraAcc({D}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,paddingBottom:6}}>
      <div style={{flex:1}}/>
      <div style={{textAlign:"right",minWidth:D?74:64,fontSize:10,color:C.text3,textTransform:"uppercase",letterSpacing:".05em"}}>30 días</div>
      <div style={{textAlign:"right",minWidth:D?74:64,fontSize:10,color:C.text3,textTransform:"uppercase",letterSpacing:".05em"}}>Total</div>
    </div>
  );
}

function SeccionProg({titulo,sub,children,D}){
  return(
    <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:16,padding:D?"20px 22px":"15px 16px",marginBottom:D?16:12}}>
      <div style={{fontSize:D?15:14,fontWeight:700,color:C.text,marginBottom:sub?3:10}}>{titulo}</div>
      {sub&&<div style={{fontSize:11,color:C.text3,marginBottom:10}}>{sub}</div>}
      {children}
    </div>
  );
}

export default function App(){
  const[spots,setSpots]=useState([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState(null);
  const[lastLoaded,setLastLoaded]=useState(null);
  const[bloque,setBloque]=useState("Todos");
  const[apunte,setApunte]=useState("");
  const[calle,setCalle]=useState("Todas");
  const[conc,setConc]=useState("");
  const[served,setServed]=useState(null);
  const[chosen,setChosen]=useState(null);
  const[evaled,setEvaled]=useState(false);
  const[hideSinValidar,setHideSinValidar]=useState(true);
  const[showInvalid,setShowInvalid]=useState(false);
  const[stats,setStats]=useState({total:0,ok:0,ko:0});
  const[trC,setTrC]=useState({});
  const[trL,setTrL]=useState({});
  const[showTracker,setShowTracker]=useState(false);
  const[isDesktop,setIsDesktop]=useState(window.innerWidth>=900);
  // Fase C — vista de progreso (lee de Supabase al abrirla, no en tiempo real)
  const[vista,setVista]=useState("entrenar");   // "entrenar" | "progreso"
  const[prog,setProg]=useState(null);
  const[progLoading,setProgLoading]=useState(false);
  const[progError,setProgError]=useState(null);
  // Resumen de fin de sesión: session_id vive solo en estado de React (no localStorage).
  const[sessionId,setSessionId]=useState(makeSessionId);
  const[sessionAttempts,setSessionAttempts]=useState([]);
  const[resumen,setResumen]=useState(null);
  const[resumenLoading,setResumenLoading]=useState(false);
  const[plMode,setPlMode]=useState(null);
  const[plInput,setPlInput]=useState("");
  const[plSpot,setPlSpot]=useState(null);
  const[plOpts,setPlOpts]=useState([]);
  const[plChosen,setPlChosen]=useState(null);
  const[plEvaled,setPlEvaled]=useState(false);
  const[plFeedback,setPlFeedback]=useState(null);
  const[plLoading,setPlLoading]=useState(false);
  const[plWantFull,setPlWantFull]=useState(false);
  const[plFullFeedback,setPlFullFeedback]=useState(null);
  const[plLastMeta,setPlLastMeta]=useState("");
  const[plParsed,setPlParsed]=useState(null);

  useEffect(()=>{
    const h=()=>setIsDesktop(window.innerWidth>=900);
    window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);
  },[]);

  function loadSpots(){
    setLoading(true);setError(null);
    fetch(SHEETS_URL).then(r=>r.text()).then(text=>{
      const json=JSON.parse(text.replace(/^[^(]*\(/,"").replace(/\);?$/,""));
      const allRows=json.table.rows.map(row=>row.c.map(cell=>cell&&cell.v!=null?String(cell.v):""));
      const headers=allRows[0];
      const parsed=allRows.slice(1).map(row=>{
        const obj={};headers.forEach((h,i)=>{obj[h]=row[i]||"";});return obj;
      }).map(parseSpot).filter(s=>s.tema)   // sin exigir hand: los spots de concepto no la tienen
        .map(s=>{const v=validateSpot(s);return{...s,_valid:v.valid,_invalidReason:v.reason||""};});
      setSpots(parsed);
      setLastLoaded(new Date().toLocaleTimeString("es-MX"));
      const jugables=parsed.filter(s=>s._valid&&!(hideSinValidar&&s.fuente==="sin_validar"));
      if(jugables.length)serveNew(jugables[Math.floor(Math.random()*jugables.length)]);
      setLoading(false);
    }).catch(()=>{setError("No se pudo conectar al Google Sheets.");setLoading(false);});
  }

  useEffect(()=>{loadSpots();},[]);

  const pool=useMemo(()=>spots.filter(s=>{
    if(!s._valid)return false;                                  // guard: inválidos fuera del pool jugable
    if(hideSinValidar&&s.fuente==="sin_validar")return false;   // filtro legacy (Paso 6)
    if(bloque==="Preflop"&&s.tema!==TP)return false;
    if(bloque==="Defensa BB"&&s.tema!==TD)return false;
    if(bloque==="vs REG"&&s.tema!==TG)return false;
    if(bloque==="Recreacionales"&&s.tema!==TR)return false;
    if(bloque==="Mis leaks"&&s.tema!=="Mis leaks")return false;
    if(bloque==="Calentamiento"&&s.tema!=="Calentamiento")return false;
    if(bloque==="Rivales"&&s.tema!==TV)return false;
    if(apunte&&s.tema_apunte!==apunte)return false;
    if(calle!=="Todas"&&s.calle!==calle)return false;
    if(conc&&s.conc!==conc)return false;
    return true;
  }),[spots,bloque,apunte,calle,conc,hideSinValidar]);

  const invalidSpots=useMemo(()=>spots.filter(s=>!s._valid),[spots]);

  const allApuntes=useMemo(()=>{
    let filtered=spots.filter(s=>s.tema_apunte&&s.tema!=="Calentamiento"&&s.tema!=="Mis leaks"&&s.tema!==TV);
    if(bloque==="Preflop")filtered=filtered.filter(s=>s.tema===TP);
    if(bloque==="Defensa BB")filtered=filtered.filter(s=>s.tema===TD);
    if(bloque==="vs REG")filtered=filtered.filter(s=>s.tema===TG);
    if(bloque==="Recreacionales")filtered=filtered.filter(s=>s.tema===TR);
    return[...new Set(filtered.map(s=>s.tema_apunte))].sort();
  },[spots,bloque]);

  const allConcs=useMemo(()=>[...new Set(spots.map(s=>s.conc))].sort(),[spots]);

  // Sirve un spot: guarda el crudo (para la lógica del pool) y su versión
  // servida (variante de mano + palos permutados). Re-servir el mismo spot
  // produce palos distintos cada vez.
  function serveNew(raw){setServed(serveSpot(raw));setChosen(null);setEvaled(false);}
  function nextSpot(p=pool){if(!p.length)return;serveNew(p[Math.floor(Math.random()*p.length)]);}
  function evaluate(){
    if(!chosen||evaled||!served)return;setEvaled(true);
    const ok=served.aceptables.includes(chosen);
    setStats(s=>({total:s.total+1,ok:s.ok+(ok?1:0),ko:s.ko+(ok?0:1)}));
    if(served.tema!==TV){
      setTrC(t=>{const n={...t};if(!n[served.calle])n[served.calle]={ok:0,n:0};n[served.calle].ok+=ok?1:0;n[served.calle].n++;return n;});
      setTrL(t=>{const n={...t};served.leaks.forEach(l=>{if(!n[l])n[l]={ok:0,n:0};n[l].ok+=ok?1:0;n[l].n++;});return n;});
      // Resumen de fin de sesión: copia local del intento (independiente del tracker de arriba,
      // se resetea al "Cerrar sesión" en vez de al hacer click en el botón Reiniciar).
      setSessionAttempts(a=>[...a,{
        tema:served.tema,
        tema_apunte:served.tema_apunte||null,
        conc:served.conc||null,
        calle:served.calle||null,
        fuente:served.fuente||null,
        leaks:served.leaks||[],
        chosen,
        aceptables:served.aceptables||[],
        ec:served.ec||"",
        correcto:ok,
      }]);
      // Fase C — persistencia fire-and-forget en Supabase. Capa adicional: no
      // afecta al tracker de sesión de arriba. Si falla (red/RLS/etc.) solo se
      // loguea a consola y la app sigue normal.
      if(supabase){
        supabase.from("poker_intentos").insert({
          tema:served.tema,
          tema_apunte:served.tema_apunte||null,
          conc:served.conc||null,
          calle:served.calle||null,
          fuente:served.fuente||null,
          leaks:served.leaks||[],
          chosen,
          correcto:ok,
          session_id:sessionId,
        }).then(({error})=>{if(error)console.error("[supabase] insert poker_intentos falló:",error.message);})
          .catch(e=>console.error("[supabase] insert poker_intentos error:",e?.message||e));
      }
    }
  }
  function reset(){setStats({total:0,ok:0,ko:0});setTrC({});setTrL({});nextSpot();}

  // Fase C — carga los intentos persistidos y calcula las agregaciones.
  async function loadProgreso(){
    if(!supabase){setProgError("Supabase no está configurado (faltan las variables en .env.local).");return;}
    setProgLoading(true);setProgError(null);
    const{data,error:err}=await supabase
      .from("poker_intentos")
      .select("tema,calle,leaks,correcto,created_at")
      .order("created_at",{ascending:false})
      .limit(5000);
    if(err){setProgError(err.message);setProgLoading(false);return;}
    setProg(aggProgreso(data||[]));
    setProgLoading(false);
  }
  // Se dispara al abrir la vista (no en tiempo real); el botón ↻ refresca.
  useEffect(()=>{if(vista==="progreso")loadProgreso();},[vista]);

  // Resumen de fin de sesión: arma el resumen con los intentos de sesionAttempts
  // (no se toca el histórico), compara contra el accuracy histórico y arranca
  // una sesión nueva (session_id nuevo, sessionAttempts vacío).
  async function cerrarSesion(){
    setResumenLoading(true);
    let histAcc=null;
    if(supabase){
      try{
        const{data,error:err}=await supabase.from("poker_intentos").select("correcto").limit(5000);
        if(!err&&data)histAcc=pct(data.filter(r=>r.correcto).length,data.length);
      }catch(e){console.error("[supabase] histórico error:",e?.message||e);}
    }
    const attempts=sessionAttempts;
    const n=attempts.length;
    const ok=attempts.filter(a=>a.correcto).length;
    const accSesion=pct(ok,n);
    const fallos=attempts.filter(a=>!a.correcto);
    const prioridad=a=>a.tema==="Mis leaks"?0:(a.leaks&&a.leaks.length>0?1:2);
    const peorFallo=fallos.length?[...fallos].sort((a,b)=>prioridad(a)-prioridad(b))[0]:null;
    const mLeak={};
    attempts.forEach(a=>{(a.leaks||[]).forEach(l=>{
      if(!l)return;
      if(!mLeak[l])mLeak[l]={leak:l,ok:0,n:0};
      mLeak[l].n++; if(a.correcto)mLeak[l].ok++;
    });});
    const leaksSesion=Object.values(mLeak).sort((a,b)=>(a.ok/a.n)-(b.ok/b.n));
    setResumen({n,ok,accSesion,peorFallo,leaksSesion,histAcc});
    setResumenLoading(false);
    setSessionId(makeSessionId());
    setSessionAttempts([]);
  }

  function parsePlFeedback(text){
    const verdictMatch=text.match(/(✅\s*CORRECTO|❌\s*INCORRECTO|⚠️\s*ACEPTABLE)/i);
    const verdict=verdictMatch?verdictMatch[1].trim():"";
    const ecMatch=text.match(/Explicación corta[:\s]*\n?([\s\S]*?)(?:\n-{3,}|\n¿Quieres|$)/i);
    const ec=ecMatch?ecMatch[1].trim():"";
    const isCorrect=verdict.toLowerCase().includes("correcto");
    const isAcceptable=verdict.toLowerCase().includes("aceptable");
    return{verdict,ec,isCorrect,isAcceptable};
  }

  function parsePlSpot(text){
    const get=(re,i=1)=>{const m=text.match(re);return m?m[i].trim():"";};
    const calle=get(/^Calle:\s*(\S+)/m);
    const posM=text.match(/^Posición:\s*(.+?)\s+vs\s+(.+)/m);
    const hero=posM?posM[1].trim():"";
    const vill=posM?posM[2].trim():"";
    const oponente=get(/^Oponente:\s*(.+)/m);
    const stacks=get(/^Stacks:\s*(.+)/m);
    const pot=get(/^Pot:\s*(.+)/m);
    const seq=get(/^Seq:\s*(.+)/m);
    const board=get(/^Board:\s*(.+)/m);
    const hand=get(/^Mano:\s*(.+)/m);
    const optsRaw=get(/^Opts:\s*(.+)/m);
    const opts=optsRaw?optsRaw.split("|").map(s=>s.trim()).filter(Boolean):["Bet","Check","Call","Fold","Raise"];
    return{calle,hero,vill,oponente,stacks,pot,seq,board,hand,opts};
  }

  function resetPL(){setPlMode(null);setPlInput("");setPlSpot(null);setPlParsed(null);setPlOpts([]);setPlChosen(null);setPlEvaled(false);setPlFeedback(null);setPlLoading(false);setPlWantFull(false);setPlFullFeedback(null);}

  async function generarSpot(){
    setPlLoading(true);setPlSpot(null);setPlParsed(null);setPlChosen(null);setPlEvaled(false);setPlFeedback(null);setPlWantFull(false);setPlFullFeedback(null);
    try{
      const userMsg=plMode==="aleatorio"
        ?`Genera un spot aleatorio.${plLastMeta?` Evita repetir: ${plLastMeta}`:""}`
        :`Genera un spot sobre: ${plInput}`;
      const text=await callClaude(SKILL_GENERAR,userMsg);
      setPlSpot(text);
      const parsed=parsePlSpot(text);
      setPlParsed(parsed);
      setPlOpts(parsed.opts);
      if(parsed.calle&&parsed.hero)setPlLastMeta(`${parsed.calle} / ${parsed.hero}`);
    }catch(e){setPlSpot(`Error: ${e.message}`);}
    setPlLoading(false);
  }

  async function evaluarPL(opcion){
    if(plEvaled||!plSpot)return;
    setPlChosen(opcion);setPlLoading(true);
    try{
      const text=await callClaude(SKILL_EVALUAR,`Spot:\n${plSpot}\n\nEl usuario eligió: ${opcion}`);
      setPlFeedback(text);setPlEvaled(true);
    }catch(e){setPlFeedback(`Error: ${e.message}`);}
    setPlLoading(false);
  }

  async function pedirAnalisis(){
    if(!plFeedback)return;
    setPlLoading(true);
    try{
      const text=await callClaude(SKILL_EVALUAR,`Spot:\n${plSpot}\n\nEl usuario eligió: ${plChosen}\n\nEl usuario solicita análisis completo.`);
      setPlFullFeedback(text);setPlWantFull(true);
    }catch(e){setPlFullFeedback(`Error: ${e.message}`);}
    setPlLoading(false);
  }

  const acc=stats.total>0?Math.round(stats.ok/stats.total*100):null;
  const worst=Object.entries(trL).filter(([,v])=>v.n>=1).sort((a,b)=>a[1].ok/a[1].n-b[1].ok/b[1].n).slice(0,5);
  const D=isDesktop;
  const selStyle={fontSize:D?15:14,padding:D?"10px 12px":"8px 10px",borderRadius:8,border:`1px solid ${C.border2}`,background:C.bg2,color:C.text,width:"100%",WebkitAppearance:"none"};
  const btnStyle=(bg,color,border)=>({padding:D?"12px 24px":"10px 20px",borderRadius:8,border:`1px solid ${border||C.border2}`,background:bg,color,fontSize:D?15:14,cursor:"pointer",fontWeight:600,fontFamily:"inherit"});
  const SL=(txt,col)=><div style={{fontSize:D?11:10,color:col||C.text2,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,marginBottom:D?10:8}}>{txt}</div>;

  if(loading)return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.bg,color:C.text2,gap:16}}>
      <div style={{fontSize:48}}>♠</div><div style={{fontSize:16}}>Cargando spots…</div>
    </div>
  );
  if(error)return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.bg,padding:24,gap:16}}>
      <div style={{background:C.redBg,color:C.redTxt,padding:"14px 18px",borderRadius:10,fontSize:14,textAlign:"center"}}>{error}</div>
      <button onClick={loadSpots} style={btnStyle(C.bg2,C.text,C.border2)}>Reintentar</button>
    </div>
  );

  // ── SPOT DE RIVALES ──────────────────────────────
  const rivalOk=served&&served.aceptables.includes(chosen);
  const RivalCard=served&&served.tema===TV?(
    <div style={{background:C.bg2,border:`1px solid ${C.purple}`,borderRadius:16,padding:D?32:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:D?20:14}}>
        <div>
          <div style={{fontSize:D?11:10,color:C.text3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>Ejercicio</div>
          <div style={{fontSize:D?16:13,fontWeight:700,color:C.purpleTxt}}>{served.conc}</div>
        </div>
        <SourceBadge fuente={served.fuente}/>
      </div>
      {DIV}

      {/* Stats box */}
      <div style={{background:C.bg3,borderRadius:12,padding:D?"20px 24px":"14px 16px",marginBottom:D?20:16,border:`1px solid ${C.border2}`}}>
        {SL("Estadísticas del rival","#a855f7")}
        <div style={{fontSize:D?18:15,fontWeight:700,color:C.text,lineHeight:1.8,fontFamily:"monospace"}}>
          {served.board.split("|").map((s,i)=><div key={i}>{s.trim()}</div>)}
        </div>
      </div>

      {/* Description */}
      <div style={{background:C.bg3,borderRadius:12,padding:D?"16px 20px":"12px 14px",marginBottom:D?20:16,border:`1px solid ${C.border2}`}}>
        {SL("Observación en mesa")}
        <div style={{fontSize:D?15:13,color:C.text,lineHeight:1.7}}>{served.hand}</div>
      </div>

      {DIV}
      {SL("¿Qué es este rival / cuál es el exploit?")}

      {/* Options */}
      <div style={{display:"flex",flexDirection:"column",gap:D?10:8,marginBottom:D?20:16}}>
        {(served.opts||[]).map(o=>{
          let bg=C.bg3,border=C.border2,color=C.text,bw="1px";
          if(evaled){
            if(served.aceptables.includes(o)){bg=C.greenBg;border=C.green;color=C.greenTxt;bw="2px";}
            else if(o===chosen){bg=C.redBg;border=C.red;color=C.redTxt;bw="2px";}
          }else if(o===chosen){bg=C.purpleBg;border=C.purple;color=C.purpleTxt;bw="2px";}
          return(
            <button key={o} onClick={()=>!evaled&&setChosen(o)} style={{
              padding:D?"12px 20px":"10px 14px",borderRadius:10,border:`${bw} solid ${border}`,
              background:bg,color,fontSize:D?14:13,cursor:evaled?"default":"pointer",
              fontWeight:500,fontFamily:"inherit",textAlign:"left",lineHeight:1.4}}>{o}</button>
          );
        })}
      </div>

      {/* Feedback rival */}
      {evaled&&(
        <>
          <div style={{padding:D?"16px 18px":"12px 14px",borderRadius:12,fontSize:D?15:13,lineHeight:1.7,marginBottom:D?14:10,
            background:rivalOk?C.greenBg:C.redBg,color:rivalOk?C.greenTxt:C.redTxt,
            border:`1px solid ${rivalOk?C.green:C.red}`}}>
            <strong>{rivalOk?"✓ Correcto":`✗ La respuesta era: ${served.aceptables.join(" · ")}`}</strong>
            <br/>{served.ec}
          </div>
          <BaselineBars items={served.baseline} D={D}/>
          <ExploitBox text={served.exploit} D={D}/>
          <div style={{background:C.bg3,borderRadius:12,padding:D?"16px 18px":"12px 14px",fontSize:D?14:13,lineHeight:1.7,marginBottom:12,color:C.text2,border:`1px solid ${C.border}`}}>
            {SL("Explicación completa","#a855f7")}
            {served.el}
          </div>
        </>
      )}

      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {!evaled
          ?<button onClick={evaluate} style={btnStyle(C.purple,"#fff",C.purple)}>Evaluar ↗</button>
          :<button onClick={()=>nextSpot()} style={btnStyle(C.purple,"#fff",C.purple)}>Siguiente ↗</button>
        }
        <button onClick={reset} style={btnStyle(C.bg3,C.text2,C.border2)}>Reiniciar</button>
      </div>
    </div>
  ):null;

  // ── SPOT DE POKER NORMAL ──────────────────────────
  const pokerOk=served&&served.aceptables.includes(chosen);
  const hayBoard=served&&!vacio(served.board);
  const hayMano=served&&!vacio(served.hand);
  // Concepto puro: sin board, sin mano y con seq de concepto → tampoco hay historia que contar.
  const conceptoPuro=served&&!hayBoard&&!hayMano&&/^Pregunta de concepto/i.test((served.seq||"").trim());
  const PokerCard=served&&served.tema!==TV?(
    <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:16,padding:D?32:16}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:D?"12px 32px":"8px 16px",marginBottom:D?20:14}}>
        {[["Tema",served.tema],["Apunte",served.tema_apunte||"—"],["Posición",`${served.hero} vs ${served.vill} · ${served.stacks}`],["Calle",served.calle]].map(([l,v])=>(
          <div key={l}>
            <div style={{fontSize:D?11:10,color:C.text3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>{l}</div>
            <div style={{fontSize:D?15:12,fontWeight:700,color:C.text}}>{v}</div>
          </div>
        ))}
      </div>
      {DIV}
      {/* Secuencia: se oculta solo en spots de concepto puro (sin board, sin mano y seq de concepto) */}
      {!conceptoPuro&&(
        <>
          {SL("Secuencia")}
          <Timeline calle={served.calle} size={D?"lg":"md"}/>
          {!vacio(served.seq)&&<div style={{marginTop:D?14:10,marginBottom:D?4:2}}><SecuenciaTexto seq={served.seq} calle={served.calle} size={D?"lg":"md"}/></div>}
          {DIV}
        </>
      )}
      <div style={{display:"grid",gridTemplateColumns:hayBoard&&hayMano?"1fr 1fr":"1fr",gap:D?32:16,marginBottom:D?20:16}}>
        {hayBoard&&<div>{SL("Board")}<Cards txt={served.board} board calle={served.calle} size={D?"lg":"md"}/></div>}
        <div>
          {SL("Tu mano")}
          {hayMano
            ?<Cards txt={served.hand} size={D?"lg":"md"}/>
            :<div style={{fontSize:D?13:12,color:C.text3,fontStyle:"italic",paddingTop:2}}>Pregunta de concepto — sin mano específica</div>}
        </div>
      </div>
      {DIV}
      {/* Título de las opciones: pregunta custom del Sheet, o el label de siempre */}
      {served.pregunta
        ?<div style={{fontSize:D?16:14,fontWeight:700,color:C.text,lineHeight:1.5,marginBottom:D?12:10}}>{served.pregunta}</div>
        :SL("¿Cuál es tu decisión?")}
      <div style={{display:"flex",flexWrap:"wrap",gap:D?10:8,marginBottom:D?20:16}}>
        {served.opts.map(o=>{
          let bg=C.bg3,border=C.border2,color=C.text,bw="1px";
          if(evaled){
            if(served.aceptables.includes(o)){bg=C.greenBg;border=C.green;color=C.greenTxt;bw="2px";}
            else if(o===chosen){bg=C.redBg;border=C.red;color=C.redTxt;bw="2px";}
          }else if(o===chosen){bg=C.blueBg;border=C.blue;color=C.blueTxt;bw="2px";}
          return(
            <button key={o} onClick={()=>!evaled&&setChosen(o)} style={{
              padding:D?"12px 24px":"10px 18px",borderRadius:10,border:`${bw} solid ${border}`,
              background:bg,color,fontSize:D?15:14,cursor:evaled?"default":"pointer",fontWeight:600,fontFamily:"inherit"}}>{o}</button>
          );
        })}
      </div>
      {evaled&&(
        <>
          <div style={{padding:D?"16px 18px":"12px 14px",borderRadius:12,fontSize:D?15:13,lineHeight:1.7,marginBottom:D?14:10,
            background:pokerOk?C.greenBg:C.redBg,color:pokerOk?C.greenTxt:C.redTxt,
            border:`1px solid ${pokerOk?C.green:C.red}`}}>
            <strong>{pokerOk?"✓ Correcto":`✗ Acciones aceptables: ${served.aceptables.join(" · ")}`}</strong>
            <br/>{served.ec}
          </div>
          <BaselineBars items={served.baseline} D={D}/>
          <ExploitBox text={served.exploit} D={D}/>
          <div style={{background:C.bg3,borderRadius:12,padding:D?"16px 18px":"12px 14px",fontSize:D?15:13,lineHeight:1.7,marginBottom:D?16:12,color:C.text2,border:`1px solid ${C.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:10}}>
              <span style={{fontSize:D?11:10,color:C.text2,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700}}>Concepto</span>
              <SourceBadge fuente={served.fuente}/>
            </div>
            <div style={{fontSize:D?15:13,fontWeight:700,color:C.blueTxt,marginBottom:10}}>{served.conc}</div>
            {served.el}
          </div>
          {served.leaks.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
              {served.leaks.map(l=><span key={l} style={{fontSize:D?12:10,padding:D?"4px 12px":"3px 8px",borderRadius:99,background:C.leak,color:C.leakTxt,fontWeight:700}}>{l}</span>)}
            </div>
          )}
        </>
      )}
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {!evaled
          ?<button onClick={evaluate} style={btnStyle(C.blue,"#fff",C.blue)}>Evaluar ↗</button>
          :<button onClick={()=>nextSpot()} style={btnStyle(C.blue,"#fff",C.blue)}>Siguiente ↗</button>
        }
        <button onClick={reset} style={btnStyle(C.bg3,C.text2,C.border2)}>Reiniciar</button>
      </div>
    </div>
  ):null;

  const PracticaLibreCard=(
    <div style={{background:C.bg2,border:`1px solid ${C.green}`,borderRadius:16,padding:D?32:16}}>
      <div style={{marginBottom:D?20:14}}>
        <div style={{fontSize:D?11:10,color:C.text3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>Bloque</div>
        <div style={{fontSize:D?18:15,fontWeight:700,color:C.greenTxt}}>🃏 Práctica Libre</div>
      </div>
      {DIV}

      {/* Selector de modo */}
      {!plMode&&(
        <div>
          {SL("¿Cómo quieres practicar?",C.green)}
          <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:8}}>
            <button onClick={()=>setPlMode("aleatorio")} style={{...btnStyle(C.greenBg,C.greenTxt,C.green),flex:1}}>
              🎲 Aleatorio
            </button>
            <button onClick={()=>setPlMode("dirigido")} style={{...btnStyle(C.bg3,C.text,C.border2),flex:1}}>
              🎯 Dirigido
            </button>
          </div>
        </div>
      )}

      {/* Modo seleccionado */}
      {plMode&&(
        <>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:D?16:12}}>
            {SL(plMode==="aleatorio"?"Modo: Aleatorio 🎲":"Modo: Dirigido 🎯",C.green)}
            <button onClick={resetPL} style={{fontSize:12,background:"none",border:"none",color:C.text3,cursor:"pointer",textDecoration:"underline"}}>cambiar modo</button>
          </div>

          {/* Input dirigido */}
          {plMode==="dirigido"&&!plSpot&&(
            <div style={{marginBottom:D?16:12}}>
              {SL("¿Qué quieres practicar?")}
              <textarea
                value={plInput}
                onChange={e=>setPlInput(e.target.value)}
                placeholder="Ej: spots de river con draws que no llegaron vs recreacional, c-bet en tableros paired, etc."
                rows={3}
                style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border2}`,background:C.bg3,color:C.text,fontSize:D?14:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}
              />
            </div>
          )}

          {/* Botón generar */}
          {!plSpot&&(
            <button
              onClick={generarSpot}
              disabled={plLoading||(plMode==="dirigido"&&!plInput.trim())}
              style={{...btnStyle(C.green,"#fff",C.green),opacity:(plLoading||(plMode==="dirigido"&&!plInput.trim()))?0.5:1,marginBottom:D?16:12}}>
              {plLoading?"Generando spot…":"Generar spot ↗"}
            </button>
          )}

          {/* Spot generado */}
          {plSpot&&plParsed&&(
            <>
              {/* Grid info igual que PokerCard */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:D?"12px 32px":"8px 16px",marginBottom:D?20:14}}>
                {[["Oponente",plParsed.oponente||"—"],["Calle",plParsed.calle||"—"],["Posición",`${plParsed.hero} vs ${plParsed.vill}`],["Stacks / Pot",`${plParsed.stacks} · ${plParsed.pot}`]].map(([l,v])=>(
                  <div key={l}>
                    <div style={{fontSize:D?11:10,color:C.text3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>{l}</div>
                    <div style={{fontSize:D?15:12,fontWeight:700,color:C.text}}>{v}</div>
                  </div>
                ))}
              </div>
              {DIV}

              {/* Timeline */}
              {plParsed.seq&&<>{SL("Secuencia")}<Timeline calle={plParsed.calle} size={D?"lg":"md"}/><div style={{marginTop:D?14:10,marginBottom:D?4:2}}><SecuenciaTexto seq={plParsed.seq} calle={plParsed.calle} size={D?"lg":"md"}/></div>{DIV}</>}

              {/* Board y mano */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:D?32:16,marginBottom:D?20:16}}>
                <div>{SL("Board")}{plParsed.board?<Cards txt={plParsed.board} board calle={plParsed.calle} size={D?"lg":"md"}/>:<span style={{color:C.text3,fontSize:13}}>—</span>}</div>
                <div>{SL("Tu mano")}<Cards txt={plParsed.hand} size={D?"lg":"md"}/></div>
              </div>
              {DIV}

              {/* Opciones */}
              {!plEvaled&&(
                <div style={{marginBottom:D?16:12}}>
                  {SL("¿Cuál es tu decisión?")}
                  <div style={{display:"flex",flexWrap:"wrap",gap:D?10:8}}>
                    {plOpts.map(o=>{
                      const sel=plChosen===o;
                      return(
                        <button key={o} onClick={()=>!plEvaled&&!plLoading&&setPlChosen(o)} style={{
                          padding:D?"12px 24px":"10px 18px",borderRadius:10,
                          border:`${sel?"2px":"1px"} solid ${sel?C.green:C.border2}`,
                          background:sel?C.greenBg:C.bg3,color:sel?C.greenTxt:C.text,
                          fontSize:D?15:14,cursor:"pointer",fontWeight:sel?700:600,fontFamily:"inherit"
                        }}>{o}</button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Botón evaluar */}
              {!plEvaled&&(
                <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:D?16:12}}>
                  <button onClick={()=>evaluarPL(plChosen)} disabled={!plChosen||plLoading}
                    style={{...btnStyle(C.green,"#fff",C.green),opacity:(!plChosen||plLoading)?0.5:1}}>
                    {plLoading?"Evaluando…":"Evaluar ↗"}
                  </button>
                  <button onClick={()=>{setPlSpot(null);setPlParsed(null);setPlOpts([]);generarSpot();}} style={btnStyle(C.bg3,C.text2,C.border2)}>Otro spot</button>
                </div>
              )}

              {/* Feedback */}
              {plFeedback&&(()=>{
                const{verdict,ec,isCorrect,isAcceptable}=parsePlFeedback(plFeedback);
                const bgCol=isCorrect?C.greenBg:isAcceptable?"#451a03":C.redBg;
                const borderCol=isCorrect?C.green:isAcceptable?C.amber:C.red;
                const txtCol=isCorrect?C.greenTxt:isAcceptable?"#fbbf24":C.redTxt;
                return(
                  <div style={{marginBottom:D?14:12}}>
                    <div style={{padding:D?"16px 18px":"12px 14px",borderRadius:12,fontSize:D?15:13,lineHeight:1.7,marginBottom:D?10:8,
                      background:bgCol,color:txtCol,border:`1px solid ${borderCol}`}}>
                      <strong>{verdict||"Evaluación"}</strong>
                      {ec&&<><br/>{ec}</>}
                    </div>
                    {!plWantFull&&(
                      <button onClick={pedirAnalisis} disabled={plLoading}
                        style={{...btnStyle(C.bg3,C.greenTxt,C.green),marginTop:8,fontSize:D?13:12,opacity:plLoading?0.5:1}}>
                        {plLoading?"Cargando…":"Ver análisis completo →"}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Análisis completo */}
              {plFullFeedback&&(
                <div style={{background:C.bg3,borderRadius:12,padding:D?"16px 18px":"12px 14px",fontSize:D?14:13,lineHeight:1.7,color:C.text2,border:`1px solid ${C.border}`,marginBottom:D?14:12}}>
                  {SL("Análisis completo",C.green)}
                  <div style={{whiteSpace:"pre-wrap",color:C.text,lineHeight:1.8}}>{plFullFeedback}</div>
                </div>
              )}

              {/* Botones post-eval */}
              {plEvaled&&(
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <button onClick={()=>{setPlSpot(null);setPlParsed(null);setPlOpts([]);setPlChosen(null);setPlEvaled(false);setPlFeedback(null);setPlWantFull(false);setPlFullFeedback(null);generarSpot();}}
                    style={btnStyle(C.green,"#fff",C.green)}>
                    Siguiente ↗
                  </button>
                  <button onClick={resetPL} style={btnStyle(C.bg3,C.text2,C.border2)}>Reiniciar</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );

  // ── VISTA DE PROGRESO (Fase C) ────────────────────
  const maxSem=prog?Math.max(...prog.semanas.map(s=>s.acc||0),1):1;
  const ProgresoCard=(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:D?18:14}}>
        <div>
          <div style={{fontSize:D?11:10,color:C.text3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>Vista</div>
          <div style={{fontSize:D?18:15,fontWeight:700,color:C.blueTxt}}>📈 Progreso</div>
        </div>
        <button onClick={loadProgreso} disabled={progLoading} title="Refrescar" style={{
          display:"flex",alignItems:"center",gap:7,padding:"7px 14px",borderRadius:99,fontSize:12,fontFamily:"inherit",
          border:`1px solid ${C.border2}`,background:C.bg2,color:C.text2,cursor:progLoading?"default":"pointer",opacity:progLoading?.6:1}}>
          <span style={{fontSize:14}}>↻</span>{progLoading?"Cargando…":"Refrescar"}
        </button>
      </div>

      {progError&&(
        <div style={{background:C.redBg,border:`1px solid ${C.red}`,borderRadius:12,padding:"14px 16px",color:C.redTxt,fontSize:13}}>
          No se pudo cargar el progreso: {progError}
        </div>
      )}

      {!progError&&progLoading&&!prog&&(
        <div style={{padding:"3rem",textAlign:"center",color:C.text2,fontSize:15}}>Cargando progreso…</div>
      )}

      {!progError&&prog&&prog.totalN===0&&(
        <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:16,padding:D?"48px 32px":"36px 20px",textAlign:"center"}}>
          <div style={{fontSize:34,marginBottom:12}}>🗒️</div>
          <div style={{fontSize:D?16:15,fontWeight:700,color:C.text,marginBottom:6}}>Aún no hay intentos registrados</div>
          <div style={{fontSize:13,color:C.text2,lineHeight:1.6}}>Responde spots en la vista <strong style={{color:C.text}}>Entrenar</strong> y vuelve — cada respuesta queda guardada acá.</div>
        </div>
      )}

      {!progError&&prog&&prog.totalN>0&&(
        <div>
          {/* Resumen */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:D?12:8,marginBottom:D?16:12}}>
            {[["Intentos",prog.totalN,C.text],["Aciertos",prog.totalOk,C.green],["Accuracy",prog.accGlobal+"%",accColor(prog.accGlobal)]].map(([l,v,c])=>(
              <div key={l} style={{background:C.bg2,borderRadius:12,padding:D?"14px 8px":"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,color:C.text2,marginBottom:6}}>{l}</div>
                <div style={{fontSize:D?24:19,fontWeight:800,color:c}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Accuracy por leak — peor primero */}
          <SeccionProg titulo="Accuracy por leak" sub="Ordenado del peor al mejor. Trabajá de arriba hacia abajo." D={D}>
            {prog.porLeak.length===0
              ? <div style={{fontSize:12,color:C.text3,paddingTop:6}}>Todavía no hay intentos con leaks asociados.</div>
              : <><CabeceraAcc D={D}/>{prog.porLeak.map(e=><FilaAcc key={e.clave} nombre={e.clave} e={e} D={D}/>)}</>}
          </SeccionProg>

          {/* Accuracy por calle */}
          <SeccionProg titulo="Accuracy por calle" D={D}>
            <CabeceraAcc D={D}/>
            {prog.porCalle.map(e=><FilaAcc key={e.clave} nombre={e.clave} e={e} D={D}/>)}
          </SeccionProg>

          {/* Accuracy por bloque + lote dominado */}
          <SeccionProg titulo="Accuracy por bloque" sub={`Lote dominado ✓ = ≥${DOM_UMBRAL}% en los últimos ${DOM_VENTANA} intentos del bloque (mínimo ${DOM_MIN_INTENTOS}).`} D={D}>
            <CabeceraAcc D={D}/>
            {prog.porTema.map(e=>{
              const badge=e.faltanDatos?(
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:C.bg3,color:C.text3,border:`1px solid ${C.border2}`,whiteSpace:"nowrap"}}>
                  faltan datos ({e.ultN}/{DOM_MIN_INTENTOS})
                </span>
              ):e.dominado?(
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:C.greenBg,color:C.greenTxt,border:`1px solid ${C.green}`,fontWeight:700,whiteSpace:"nowrap"}}>
                  Lote dominado ✓
                </span>
              ):(
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,background:C.bg3,color:C.text2,border:`1px solid ${C.border2}`,whiteSpace:"nowrap"}}>
                  últimos {e.ultN}: {e.ultAcc}%
                </span>
              );
              return <FilaAcc key={e.clave} nombre={e.clave} e={e} D={D} extra={badge}/>;
            })}
          </SeccionProg>

          {/* Tendencia 8 semanas */}
          <SeccionProg titulo="Tendencia" sub="Accuracy global por semana — últimas 8." D={D}>
            <div style={{display:"flex",alignItems:"flex-end",gap:D?10:6,height:120,paddingTop:8}}>
              {prog.semanas.map((s,i)=>(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:s.acc===null?C.text3:accColor(s.acc)}}>{s.acc===null?"—":s.acc+"%"}</div>
                  <div style={{width:"100%",height:70,display:"flex",alignItems:"flex-end",background:C.bg3,borderRadius:6,overflow:"hidden"}}>
                    <div style={{width:"100%",height:`${s.acc===null?0:Math.max(s.acc/maxSem*100,3)}%`,background:s.acc===null?C.bg3:accColor(s.acc),borderRadius:"6px 6px 0 0",transition:"height .2s"}}/>
                  </div>
                  <div style={{fontSize:10,color:C.text3}}>{s.label}</div>
                  <div style={{fontSize:9,color:C.text3}}>n={s.n}</div>
                </div>
              ))}
            </div>
          </SeccionProg>
        </div>
      )}
    </div>
  );

  // ── RESUMEN DE FIN DE SESIÓN ────────────────────
  const ResumenCard=resumen&&(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:D?18:14}}>
        <div>
          <div style={{fontSize:D?11:10,color:C.text3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>Resumen</div>
          <div style={{fontSize:D?18:15,fontWeight:700,color:C.blueTxt}}>🧾 Fin de sesión</div>
        </div>
        <button onClick={()=>setResumen(null)} style={btnStyle(C.bg2,C.text2,C.border)}>Cerrar</button>
      </div>

      {resumen.n===0?(
        <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:16,padding:D?"48px 32px":"36px 20px",textAlign:"center"}}>
          <div style={{fontSize:34,marginBottom:12}}>🃏</div>
          <div style={{fontSize:D?16:15,fontWeight:700,color:C.text,marginBottom:6}}>No respondiste ningún spot en esta sesión</div>
          <div style={{fontSize:13,color:C.text2,lineHeight:1.6}}>Ya empezó una sesión nueva. Volvé a <strong style={{color:C.text}}>Entrenar</strong> cuando quieras.</div>
        </div>
      ):(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:D?12:8,marginBottom:D?16:12}}>
            {[["Intentos",resumen.n,C.text],["Aciertos",resumen.ok,C.green],["Accuracy",resumen.accSesion+"%",accColor(resumen.accSesion)]].map(([l,v,c])=>(
              <div key={l} style={{background:C.bg2,borderRadius:12,padding:D?"14px 8px":"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,color:C.text2,marginBottom:6}}>{l}</div>
                <div style={{fontSize:D?24:19,fontWeight:800,color:c}}>{v}</div>
              </div>
            ))}
          </div>

          {resumen.peorFallo&&(
            <SeccionProg titulo="Tu peor fallo" sub={resumen.peorFallo.tema==="Mis leaks"?"De tus manos analizadas (Mis leaks).":undefined} D={D}>
              <div style={{fontSize:13,color:C.text,fontWeight:700,marginBottom:8}}>{resumen.peorFallo.conc||resumen.peorFallo.tema_apunte||resumen.peorFallo.tema}</div>
              <div style={{fontSize:12,color:C.text2,marginBottom:4}}>Tu respuesta: <span style={{color:C.redTxt,fontWeight:700}}>{resumen.peorFallo.chosen}</span></div>
              <div style={{fontSize:12,color:C.text2,marginBottom:10}}>Correcta: <span style={{color:C.greenTxt,fontWeight:700}}>{resumen.peorFallo.aceptables.join(" · ")}</span></div>
              {resumen.peorFallo.ec&&<div style={{fontSize:12,color:C.text2,lineHeight:1.6,borderTop:`1px solid ${C.border}`,paddingTop:10}}>{resumen.peorFallo.ec}</div>}
            </SeccionProg>
          )}

          <SeccionProg titulo="Leaks tocados en esta sesión" D={D}>
            {resumen.leaksSesion.length===0
              ? <div style={{fontSize:12,color:C.text3,paddingTop:6}}>No tocaste spots con leaks asociados.</div>
              : resumen.leaksSesion.map(e=>{
                  const a=Math.round(e.ok/e.n*100);
                  return(
                    <div key={e.leak} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderTop:`1px solid ${C.border}`}}>
                      <span style={{fontSize:12,color:C.text}}>{e.leak}</span>
                      <span style={{fontSize:13,fontWeight:700,color:accColor(a)}}>{e.ok}/{e.n} · {a}%</span>
                    </div>
                  );
                })}
          </SeccionProg>

          <SeccionProg titulo="Comparación" D={D}>
            <div style={{fontSize:13,color:C.text2}}>
              Esta sesión: <strong style={{color:accColor(resumen.accSesion)}}>{resumen.accSesion}%</strong>
              {" · "}Tu histórico: {resumen.histAcc!==null?<strong style={{color:accColor(resumen.histAcc)}}>{resumen.histAcc}%</strong>:"—"}
            </div>
          </SeccionProg>
        </div>
      )}
    </div>
  );

  const LeftPanel=(
    <div style={{display:"flex",flexDirection:"column",gap:D?20:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:D?26:20,fontWeight:800,letterSpacing:"-.02em"}}>♠ Poker Trainer</span>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:12,padding:"4px 12px",borderRadius:99,background:C.bg2,border:`1px solid ${C.border}`,color:C.text2}}>{pool.length}/{spots.length}</span>
          <button onClick={loadSpots} title="Actualizar" style={{fontSize:20,background:"none",border:"none",color:C.text2,cursor:"pointer",padding:"4px 8px"}}>↺</button>
        </div>
      </div>
      {lastLoaded&&<div style={{fontSize:11,color:C.text3,marginTop:-12}}>Actualizado: {lastLoaded}</div>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
        {[["Resp.",stats.total,C.text],["✓",stats.ok,C.green],["✗",stats.ko,C.red],["Acc.",acc!==null?acc+"%":"—",C.blue]].map(([l,v,c])=>(
          <div key={l} style={{background:C.bg2,borderRadius:12,padding:D?"14px 8px":"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,color:C.text2,marginBottom:6}}>{l}</div>
            <div style={{fontSize:D?26:20,fontWeight:800,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Vista: Entrenar / Progreso (Fase C) + Cerrar sesión (resumen) */}
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <div style={{display:"flex",gap:6,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,padding:4,flex:1}}>
          {[["entrenar","🃏 Entrenar"],["progreso","📈 Progreso"]].map(([v,l])=>{
            const active=vista===v;
            return(
              <button key={v} onClick={()=>setVista(v)} style={{
                flex:1,padding:"8px 10px",borderRadius:9,fontSize:12,cursor:"pointer",fontFamily:"inherit",border:"none",
                background:active?C.blueBg:"transparent",
                color:active?C.blueTxt:C.text2,
                fontWeight:active?700:400}}>{l}</button>
            );
          })}
        </div>
        <button onClick={cerrarSesion} disabled={resumenLoading} title="Ver resumen de esta sesión y empezar una nueva" style={{
          fontSize:11,padding:"8px 10px",borderRadius:10,border:`1px solid ${C.border2}`,background:C.bg2,color:C.text2,
          cursor:resumenLoading?"default":"pointer",fontFamily:"inherit",whiteSpace:"nowrap",opacity:resumenLoading?.6:1}}>
          {resumenLoading?"…":"Cerrar sesión"}
        </button>
      </div>

      {/* Bloques */}
      <div>
        <div style={{fontSize:12,color:C.text2,marginBottom:8}}>Bloque</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {["Todos","Preflop","Defensa BB","vs REG","Recreacionales","Mis leaks","Calentamiento","Rivales"].map(b=>{
            const isRival=b==="Rivales";
            const active=bloque===b;
            const accentCol=isRival?C.purple:C.blue;
            const accentBg=isRival?C.purpleBg:C.blueBg;
            const accentTxt=isRival?C.purpleTxt:C.blueTxt;
            return(
              <button key={b} onClick={()=>{setBloque(b);setApunte("");setConc("");}} style={{
                padding:"6px 14px",borderRadius:99,fontSize:12,cursor:"pointer",fontFamily:"inherit",
                border:`1px solid ${active?accentCol:C.border}`,
                background:active?accentBg:C.bg2,
                color:active?accentTxt:C.text2,
                fontWeight:active?700:400}}>{b}</button>
            );
          })}
        </div>
      </div>

      {/* Toggle: ocultar contenido sin validar (Paso 6) */}
      {bloque!=="Práctica Libre"&&(
        <button onClick={()=>setHideSinValidar(v=>!v)} style={{
          display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:10,
          border:`1px solid ${C.border2}`,background:C.bg2,color:C.text2,cursor:"pointer",
          fontFamily:"inherit",fontSize:12,textAlign:"left"}}>
          <span style={{width:36,height:20,borderRadius:99,background:hideSinValidar?C.green:C.bg3,
            border:`1px solid ${hideSinValidar?C.green:C.border2}`,position:"relative",flexShrink:0,transition:"background .15s"}}>
            <span style={{position:"absolute",top:1,left:hideSinValidar?17:1,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
          </span>
          <span>Ocultar sin validar</span>
        </button>
      )}

      {/* Contador de spots inválidos (Paso 4) */}
      {invalidSpots.length>0&&(
        <div>
          <button onClick={()=>setShowInvalid(v=>!v)} title="Spots excluidos del pool por fallar el guard de integridad" style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"8px 12px",
            borderRadius:10,border:`1px solid ${C.red}`,background:C.redBg,color:C.redTxt,cursor:"pointer",
            fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            <span>⚠ {invalidSpots.length} spot{invalidSpots.length>1?"s":""} inválido{invalidSpots.length>1?"s":""}</span>
            <span>{showInvalid?"▲":"▼"}</span>
          </button>
          {showInvalid&&(
            <div style={{marginTop:6,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",maxHeight:220,overflowY:"auto"}}>
              {invalidSpots.map((s,i)=>(
                <div key={i} style={{fontSize:11,color:C.text2,padding:"6px 0",borderBottom:i<invalidSpots.length-1?`1px solid ${C.border}`:"none",lineHeight:1.5}}>
                  <span style={{color:C.text,fontWeight:600}}>{s.tema_apunte||s.tema||"(sin tema)"}</span>
                  {s.conc?<span style={{color:C.text3}}> · {s.conc}</span>:null}
                  <br/><span style={{color:C.redTxt}}>{s._invalidReason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filtros — solo para no-rivales y no Práctica Libre */}
      {bloque!=="Rivales"&&bloque!=="Práctica Libre"&&(
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:12,color:C.text2,marginBottom:5}}>Apunte</div>
              <select value={apunte} onChange={e=>setApunte(e.target.value)} style={selStyle}>
                <option value="">Todos</option>
                {allApuntes.map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:12,color:C.text2,marginBottom:5}}>Calle</div>
              <select value={calle} onChange={e=>setCalle(e.target.value)} style={selStyle}>
                {["Todas","Flop","Turn","River"].map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={{fontSize:12,color:C.text2,marginBottom:5}}>Concepto</div>
            <select value={conc} onChange={e=>setConc(e.target.value)} style={selStyle}>
              <option value="">Todos los conceptos</option>
              {allConcs.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        </>
      )}

      {/* Tracker */}
      {stats.total>0&&(
        <div>
          {!D&&<button onClick={()=>setShowTracker(!showTracker)} style={{...btnStyle(C.bg2,C.text2,C.border),width:"100%",marginBottom:10,textAlign:"center"}}>
            {showTracker?"▲ Ocultar stats":"▼ Ver estadísticas"}
          </button>}
          {(D||showTracker)&&(
            <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:14,padding:D?20:16}}>
              <div style={{fontSize:D?15:13,fontWeight:700,marginBottom:12}}>Por calle</div>
              {Object.entries(trC).map(([k,v])=>{
                const a=Math.round(v.ok/v.n*100);
                const col=a>=70?C.green:a>=40?C.amber:C.red;
                return(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                    <span style={{fontSize:D?14:13}}>{k}</span>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:13,color:C.text2}}>{v.ok}/{v.n}</span>
                      <div style={{width:70,height:6,background:C.bg3,borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:a+"%",height:"100%",background:col,borderRadius:3}}/>
                      </div>
                      <span style={{fontSize:13,color:col,fontWeight:700,minWidth:36}}>{a}%</span>
                    </div>
                  </div>
                );
              })}
              {worst.length>0&&(
                <>
                  <div style={{fontSize:D?15:13,fontWeight:700,marginTop:18,marginBottom:12}}>Leaks con más errores</div>
                  {worst.map(([k,v])=>(
                    <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                      <span style={{fontSize:D?13:12,color:C.text2,flex:1,paddingRight:8}}>{k}</span>
                      <span style={{fontSize:13,color:C.red,fontWeight:700}}>{Math.round(v.ok/v.n*100)}%</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const RightPanel=(
    <div>
      {resumen
        ? ResumenCard
        : vista==="progreso"
        ? ProgresoCard
        : bloque==="Práctica Libre"
        ? PracticaLibreCard
        : served?(RivalCard||PokerCard):(
          <div style={{padding:"3rem",textAlign:"center",color:C.text2,fontSize:16}}>No hay spots con esa configuración.</div>
        )
      }
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      {D?(
        <div style={{maxWidth:1400,margin:"0 auto",padding:"28px 40px 40px",display:"grid",gridTemplateColumns:"360px 1fr",gap:40,alignItems:"start"}}>
          <div style={{position:"sticky",top:28}}>{LeftPanel}</div>
          {RightPanel}
        </div>
      ):(
        <div style={{maxWidth:480,margin:"0 auto",padding:"16px 16px 40px"}}>
          {LeftPanel}
          <div style={{marginTop:16}}>{RightPanel}</div>
        </div>
      )}
    </div>
  );
}
