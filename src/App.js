import { useState, useEffect, useMemo } from "react";

const SHEET_ID = "1VxMfS1v0lRlaq6SNITzDjDOebrKYBQV8u2N1HkGyxQU";
const SHEETS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Hoja1`;
const TB = "SRP IP con iniciativa vs REG";
const TR = "Juego vs recreacionales";

const C = {
  bg:"#111827",bg2:"#1f2937",bg3:"#374151",
  border:"#374151",border2:"#4b5563",
  text:"#f9fafb",text2:"#9ca3af",text3:"#6b7280",
  blue:"#3b82f6",blueBg:"#1e3a5f",blueTxt:"#93c5fd",
  green:"#22c55e",greenBg:"#14532d",greenTxt:"#86efac",
  red:"#ef4444",redBg:"#450a0a",redTxt:"#fca5a5",
  amber:"#f59e0b",leak:"#7c2d12",leakTxt:"#ffedd5",
};

function parseSpot(row){
  return{
    tema:row.tema||"",calle:row.calle||"",conc:row.conc||"",
    hero:row.hero||"",vill:row.vill||"",stacks:row.stacks||"",
    seq:row.seq||"",board:row.board||"",hand:row.hand||"",
    correct:row.correct||"",ec:row.ec||"",el:row.el||"",
    sens:row.sens==="TRUE",
    leaks:row.leaks?row.leaks.split(";").map(s=>s.trim()).filter(Boolean):[],
    opts:row.opts?row.opts.split(";").map(s=>s.trim()).filter(Boolean):null,
  };
}

function parseCards(txt){return txt?txt.trim().split(/\s+/).filter(Boolean):[];}

function Card({c,size="md"}){
  if(c==="|")return<span style={{fontSize:10,color:C.text3,padding:"0 6px",alignSelf:"center"}}>|</span>;
  const red=c.includes("♥")||c.includes("♦");
  const rank=c.slice(0,-1),suit=c.slice(-1);
  const w=size==="lg"?64:46, h=size==="lg"?80:58;
  const fs=size==="lg"?26:18, ss=size==="lg"?18:14;
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

function Timeline({seq,calle,size="md"}){
  const streets=["Preflop","Flop","Turn","River"];
  const activeIdx={Flop:1,Turn:2,River:3}[calle]||0;
  const parts=seq.split("|").map(s=>s.trim());
  const actions={};
  parts.forEach(p=>{
    const pl=p.toLowerCase();
    if(!pl.includes("flop:")&&!pl.includes("turn:")&&!pl.includes("river:"))actions["Preflop"]=p.replace(/preflop:/i,"").trim().slice(0,38);
    if(pl.includes("flop:"))actions["Flop"]=p.replace(/flop:/i,"").trim().slice(0,38);
    if(pl.includes("turn:"))actions["Turn"]=p.replace(/turn:/i,"").trim().slice(0,38);
    if(pl.includes("river:"))actions["River"]=p.replace(/river:/i,"").trim().slice(0,38);
  });
  const dotSize=size==="lg"?36:28;
  const fs=size==="lg"?13:11;
  return(
    <div style={{display:"flex",gap:0,overflowX:"auto",paddingBottom:4,marginBottom:20}}>
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
            {actions[s]&&<div style={{fontSize:size==="lg"?11:9,color:C.text3,marginTop:3,textAlign:"center",maxWidth:size==="lg"?120:80,lineHeight:1.4}}>{actions[s]}</div>}
          </div>
        );
      })}
    </div>
  );
}

function getOpts(s){
  if(s.opts&&s.opts.length)return s.opts;
  const seg=s.seq.toLowerCase().split("|").find(p=>p.includes(s.calle.toLowerCase()+":"))||"";
  if(seg.includes("overbet")||(seg.includes("apuesta")&&!seg.includes("checkea")))return["Fold","Call","Raise 75%","Raise 125%"];
  if(seg.includes("donkea"))return["Fold","Call","Raise 75%","Raise 125%"];
  if(seg.includes("resube"))return["Fold","Call"];
  return["Check","Bet 25%","Bet 33%","Bet 50%","Bet 75%","Bet 80%","Bet 125%"];
}

const DIV=<div style={{borderTop:`1px solid ${C.border}`,margin:"16px 0"}}/>;

export default function App(){
  const[spots,setSpots]=useState([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState(null);
  const[lastLoaded,setLastLoaded]=useState(null);
  const[bloque,setBloque]=useState("Todos");
  const[calle,setCalle]=useState("Todas");
  const[conc,setConc]=useState("");
  const[rival,setRival]=useState("Base teórica");
  const[spot,setSpot]=useState(null);
  const[chosen,setChosen]=useState(null);
  const[evaled,setEvaled]=useState(false);
  const[stats,setStats]=useState({total:0,ok:0,ko:0});
  const[trC,setTrC]=useState({});
  const[trL,setTrL]=useState({});
  const[showTracker,setShowTracker]=useState(false);
  const[isDesktop,setIsDesktop]=useState(window.innerWidth>=900);

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
      }).map(parseSpot).filter(s=>s.tema&&s.calle&&s.hand);
      setSpots(parsed);
      setLastLoaded(new Date().toLocaleTimeString("es-MX"));
      if(parsed.length)setSpot(parsed[Math.floor(Math.random()*parsed.length)]);
      setLoading(false);
    }).catch(()=>{setError("No se pudo conectar al Google Sheets.");setLoading(false);});
  }

  useEffect(()=>{loadSpots();},[]);

  const pool=useMemo(()=>spots.filter(s=>{
    if(bloque==="Regulares"&&s.tema!==TB)return false;
    if(bloque==="Recreacionales"&&s.tema!==TR)return false;
    if(calle!=="Todas"&&s.calle!==calle)return false;
    if(conc&&s.conc!==conc)return false;
    return true;
  }),[spots,bloque,calle,conc]);

  const allConcs=useMemo(()=>[...new Set(spots.map(s=>s.conc))].sort(),[spots]);

  function nextSpot(p=pool){if(!p.length)return;setSpot(p[Math.floor(Math.random()*p.length)]);setChosen(null);setEvaled(false);}
  function evaluate(){
    if(!chosen||evaled||!spot)return;setEvaled(true);
    const ok=chosen===spot.correct;
    setStats(s=>({total:s.total+1,ok:s.ok+(ok?1:0),ko:s.ko+(ok?0:1)}));
    setTrC(t=>{const n={...t};if(!n[spot.calle])n[spot.calle]={ok:0,n:0};n[spot.calle].ok+=ok?1:0;n[spot.calle].n++;return n;});
    setTrL(t=>{const n={...t};spot.leaks.forEach(l=>{if(!n[l])n[l]={ok:0,n:0};n[l].ok+=ok?1:0;n[l].n++;});return n;});
  }
  function reset(){setStats({total:0,ok:0,ko:0});setTrC({});setTrL({});nextSpot();}

  const acc=stats.total>0?Math.round(stats.ok/stats.total*100):null;
  const worst=Object.entries(trL).filter(([,v])=>v.n>=1).sort((a,b)=>a[1].ok/a[1].n-b[1].ok/b[1].n).slice(0,5);
  const D=isDesktop;
  const selStyle={fontSize:D?15:14,padding:D?"10px 12px":"8px 10px",borderRadius:8,border:`1px solid ${C.border2}`,background:C.bg2,color:C.text,width:"100%",WebkitAppearance:"none"};
  const btnStyle=(bg,color,border)=>({padding:D?"12px 24px":"10px 20px",borderRadius:8,border:`1px solid ${border||C.border2}`,background:bg,color,fontSize:D?15:14,cursor:"pointer",fontWeight:600,fontFamily:"inherit"});
  const SL=(txt)=><div style={{fontSize:D?11:10,color:C.text2,textTransform:"uppercase",letterSpacing:".07em",fontWeight:700,marginBottom:D?10:8}}>{txt}</div>;

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

  const LeftPanel=(
    <div style={{display:"flex",flexDirection:"column",gap:D?20:16}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:D?26:20,fontWeight:800,letterSpacing:"-.02em"}}>♠ Poker Trainer</span>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:12,padding:"4px 12px",borderRadius:99,background:C.bg2,border:`1px solid ${C.border}`,color:C.text2}}>{pool.length}/{spots.length}</span>
          <button onClick={loadSpots} title="Actualizar" style={{fontSize:20,background:"none",border:"none",color:C.text2,cursor:"pointer",padding:"4px 8px"}}>↺</button>
        </div>
      </div>
      {lastLoaded&&<div style={{fontSize:11,color:C.text3,marginTop:-12}}>Actualizado: {lastLoaded}</div>}

      {/* Metrics */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
        {[["Resp.",stats.total,C.text],["✓",stats.ok,C.green],["✗",stats.ko,C.red],["Acc.",acc!==null?acc+"%":"—",C.blue]].map(([l,v,c])=>(
          <div key={l} style={{background:C.bg2,borderRadius:12,padding:D?"14px 8px":"10px 8px",textAlign:"center",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,color:C.text2,marginBottom:6}}>{l}</div>
            <div style={{fontSize:D?26:20,fontWeight:800,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div><div style={{fontSize:12,color:C.text2,marginBottom:5}}>Bloque</div>
          <select value={bloque} onChange={e=>setBloque(e.target.value)} style={selStyle}>
            {["Todos","Regulares","Recreacionales"].map(o=><option key={o}>{o}</option>)}
          </select>
        </div>
        <div><div style={{fontSize:12,color:C.text2,marginBottom:5}}>Calle</div>
          <select value={calle} onChange={e=>setCalle(e.target.value)} style={selStyle}>
            {["Todas","Flop","Turn","River"].map(o=><option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <div><div style={{fontSize:12,color:C.text2,marginBottom:5}}>Concepto</div>
        <select value={conc} onChange={e=>setConc(e.target.value)} style={selStyle}>
          <option value="">Todos los conceptos</option>
          {allConcs.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Rival */}
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:C.text2}}>Rival:</span>
        {["Base teórica","Regular","Recreacional"].map(r=>(
          <button key={r} onClick={()=>setRival(r)} style={{padding:"6px 14px",borderRadius:99,fontSize:13,cursor:"pointer",fontFamily:"inherit",
            border:`1px solid ${rival===r?C.blue:C.border}`,
            background:rival===r?C.blueBg:C.bg2,
            color:rival===r?C.blueTxt:C.text2}}>{r}</button>
        ))}
      </div>

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
      {spot?(
        <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:16,padding:D?32:16}}>
          {/* Meta */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:D?"12px 32px":"8px 16px",marginBottom:D?20:14}}>
            {[["Tema",spot.tema],["Concepto",spot.conc],["Posición",`${spot.hero} vs ${spot.vill} · ${spot.stacks}`],["Calle",spot.calle]].map(([l,v])=>(
              <div key={l}>
                <div style={{fontSize:D?11:10,color:C.text3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>{l}</div>
                <div style={{fontSize:D?15:12,fontWeight:700,color:C.text}}>{v}</div>
              </div>
            ))}
          </div>
          {DIV}

          {/* Timeline */}
          {SL("Secuencia")}
          <Timeline seq={spot.seq} calle={spot.calle} size={D?"lg":"md"}/>
          {DIV}

          {/* Board + Hand */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:D?32:16,marginBottom:D?20:16}}>
            <div>{SL("Board")}<Cards txt={spot.board} board calle={spot.calle} size={D?"lg":"md"}/></div>
            <div>{SL("Tu mano")}<Cards txt={spot.hand} size={D?"lg":"md"}/></div>
          </div>

          {/* Leaks */}
          {spot.leaks.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:D?20:14}}>
              {spot.leaks.map(l=><span key={l} style={{fontSize:D?12:10,padding:D?"4px 12px":"3px 8px",borderRadius:99,background:C.leak,color:C.leakTxt,fontWeight:700}}>{l}</span>)}
            </div>
          )}
          {DIV}

          {/* Decision */}
          {SL("¿Cuál es tu decisión?")}
          <div style={{display:"flex",flexWrap:"wrap",gap:D?10:8,marginBottom:D?20:16}}>
            {getOpts(spot).map(o=>{
              let bg=C.bg3,border=C.border2,color=C.text,bw="1px";
              if(evaled){
                if(o===spot.correct){bg=C.greenBg;border=C.green;color=C.greenTxt;bw="2px";}
                else if(o===chosen){bg=C.redBg;border=C.red;color=C.redTxt;bw="2px";}
              }else if(o===chosen){bg=C.blueBg;border=C.blue;color=C.blueTxt;bw="2px";}
              return(
                <button key={o} onClick={()=>!evaled&&setChosen(o)} style={{
                  padding:D?"12px 24px":"10px 18px",borderRadius:10,border:`${bw} solid ${border}`,
                  background:bg,color,fontSize:D?15:14,cursor:evaled?"default":"pointer",fontWeight:600,fontFamily:"inherit"}}>{o}</button>
              );
            })}
          </div>

          {/* Feedback */}
          {evaled&&(
            <>
              <div style={{padding:D?"16px 18px":"12px 14px",borderRadius:12,fontSize:D?15:13,lineHeight:1.7,marginBottom:D?14:10,
                background:chosen===spot.correct?C.greenBg:C.redBg,
                color:chosen===spot.correct?C.greenTxt:C.redTxt,
                border:`1px solid ${chosen===spot.correct?C.green:C.red}`}}>
                <strong>{chosen===spot.correct?"✓ Correcto":`✗ La mejor acción era: ${spot.correct}`}</strong>
                <br/>{spot.ec}
              </div>
              <div style={{background:C.bg3,borderRadius:12,padding:D?"16px 18px":"12px 14px",fontSize:D?15:13,lineHeight:1.7,marginBottom:D?16:12,color:C.text2,border:`1px solid ${C.border}`}}>{spot.el}</div>
            </>
          )}

          {/* Buttons */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {!evaled
              ?<button onClick={evaluate} style={btnStyle(C.blue,"#fff",C.blue)}>Evaluar ↗</button>
              :<button onClick={()=>nextSpot()} style={btnStyle(C.blue,"#fff",C.blue)}>Siguiente ↗</button>
            }
            <button onClick={reset} style={btnStyle(C.bg3,C.text2,C.border2)}>Reiniciar</button>
          </div>
        </div>
      ):(
        <div style={{padding:"3rem",textAlign:"center",color:C.text2,fontSize:16}}>No hay spots con esa configuración.</div>
      )}
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
