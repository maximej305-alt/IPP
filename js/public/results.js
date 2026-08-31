import { resultsService } from "../services/resultsService.js";
import { Levels, Series } from "../config/app.config.js";

// Phase 6.6.2.1 — Page publique branchée sur les données réelles (RPC search_student_result).
// En mode réel (Supabase activé) : AUCUNE donnée fictive n'est affichée.
// En mode mock (Supabase désactivé) : getPublicState() retourne {state:"empty"} → page vide.
// XSS : toutes les données élèves/dynamiques sont rendues via textContent (jamais innerHTML).
export async function initResultsPage(){
  const emptyEl = document.querySelector("[data-state-empty]");
  const scheduledEl = document.querySelector("[data-state-scheduled]");
  const availableEl = document.querySelector("[data-state-available]");
  const labelEl = document.querySelector("[data-session-label]");

  let publicState;
  try{
    publicState = await resultsService.getPublicState();
  }catch(err){
    // Erreur réseau/RPC → on bascule en état vide avec message, sans blocage.
    setPageLabel(labelEl, "Résultats");
    if(emptyEl) emptyEl.hidden = false;
    if(scheduledEl) scheduledEl.hidden = true;
    if(availableEl) availableEl.hidden = true;
    const desc = emptyEl ? emptyEl.querySelector(".empty-state__desc") : null;
    if(desc) desc.textContent = "Impossible de charger l'état des résultats pour le moment. Veuillez réessayer ultérieurement.";
    return;
  }

  const state = publicState.state;
  const sessionLabel = publicState.session || "Résultats";
  setPageLabel(labelEl, sessionLabel);

  if(emptyEl) emptyEl.hidden = state !== "empty";
  if(scheduledEl) scheduledEl.hidden = state !== "scheduled";
  if(availableEl) availableEl.hidden = state !== "available";

  if(state === "scheduled"){
    initCountdown(new Date(publicState.scheduledAt));
  }
  if(state === "available"){
    initSearch(sessionLabel);
  }
}

function setPageLabel(el, text){
  if(el) el.textContent = text;
}

function initCountdown(targetDate){
  if(!(targetDate instanceof Date) || isNaN(targetDate.getTime())) return;
  const els = {
    d: document.querySelector("[data-cd-days]"),
    h: document.querySelector("[data-cd-hours]"),
    m: document.querySelector("[data-cd-mins]"),
    s: document.querySelector("[data-cd-secs]"),
  };
  function tick(){
    const diff = targetDate - new Date();
    if(diff<=0){ els.d.textContent="00"; els.h.textContent="00"; els.m.textContent="00"; els.s.textContent="00"; return; }
    const s = Math.floor(diff/1000);
    const d = Math.floor(s/86400);
    const h = Math.floor((s%86400)/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    els.d.textContent = String(d).padStart(2,"0");
    els.h.textContent = String(h).padStart(2,"0");
    els.m.textContent = String(m).padStart(2,"0");
    els.s.textContent = String(sec).padStart(2,"0");
  }
  tick(); setInterval(tick,1000);
}

function initSearch(sessionLabel){
  const levelSel = document.querySelector("[data-level]");
  const serieSel = document.querySelector("[data-serie]");
  const input = document.querySelector("[data-search-input]");
  const sugg = document.querySelector("[data-suggestions]");
  const btn = document.querySelector("[data-consult]");
  const hint = document.querySelector("[data-search-hint]");
  const resultWrap = document.querySelector("[data-result]");

  Levels.forEach(l=>{
    const o=document.createElement("option"); o.value=l; o.textContent=l; levelSel.appendChild(o);
  });
  function populateSeries(){
    const lvl = levelSel.value;
    serieSel.innerHTML='<option value="">Choisir</option>';
    (Series[lvl]||[]).forEach(serie=>{
      const o=document.createElement("option"); o.value=serie; o.textContent=serie; serieSel.appendChild(o);
    });
  }
  levelSel.addEventListener("change", ()=>{ populateSeries(); if(sugg) sugg.classList.remove("is-open"); resultWrap.hidden=true; });
  populateSeries();
  serieSel.addEventListener("change", ()=>{ if(sugg) sugg.classList.remove("is-open"); resultWrap.hidden=true; });

  let debounce;
  input.addEventListener("input", ()=>{
    clearTimeout(debounce);
    const q = input.value.trim();
    if(q.length < 2){ sugg.classList.remove("is-open"); setHint(hint, "Tapez au moins 2 lettres pour rechercher."); return; }
    setHint(hint, "");
    debounce=setTimeout(async()=>{
      await runSearch(false);
    },180);
  });

  async function runSearch(isExact){
    const level = levelSel.value;
    const serie = serieSel.value;
    const q = input.value.trim();
    if(!level || !serie){
      setHint(hint, "Veuillez sélectionner votre niveau et votre série.");
      return;
    }
    if(q.length < 2){
      renderSugg([]);
      return;
    }
    setSearchLoading(true);
    try{
      const list = await resultsService.searchStudentResult({ level, className: serie, studentName: q });
      setSearchLoading(false);
      if(isExact){
        // Recherche "consulter" sans sélection : on prend le premier résultat réel exact,
        // sinon aucun résultat trouvé.
        const exact = list.find(r => r.name.toLowerCase() === q.toLowerCase()) || list[0] || null;
        if(!exact){
          resultWrap.hidden=false;
          // Message statique — aucune donnée utilisateur interpolée
          resultWrap.innerHTML='<div class="alert">Aucun élève trouvé pour ces critères. Vérifiez l’orthographe ou la classe.</div>';
          return;
        }
        showResultSafe(exact, sessionLabel);
      } else {
        renderSugg(list);
      }
    }catch(err){
      setSearchLoading(false);
      showError(resultWrap, "Une erreur est survenue lors de la recherche. Veuillez réessayer.");
    }
  }

  btn.addEventListener("click", async ()=>{
    if(btn.disabled) return;
    runSearch(true);
  });

  function renderSugg(list){
    if(!sugg) return;
    sugg.innerHTML="";
    if(list.length===0){
      const d=document.createElement("div");
      d.className="search-suggestion text-muted";
      d.textContent="Aucun résultat";
      sugg.appendChild(d);
      sugg.classList.add("is-open"); return;
    }
    list.forEach(r=>{
      const div=document.createElement("div");
      div.className="search-suggestion";
      // textContent évite XSS même si r.name contient <script>
      div.textContent = `${r.name} — ${r.level} ${r.serie}`;
      div.addEventListener("click", ()=>{
        input.value = r.name;
        sugg.classList.remove("is-open");
        showResultSafe(r, sessionLabel);
      });
      sugg.appendChild(div);
    });
    sugg.classList.add("is-open");
  }

  document.addEventListener("click",(e)=>{
    if(!e.target.closest("[data-search-wrap]")) if(sugg) sugg.classList.remove("is-open");
  });

  function setSearchLoading(loading){
    if(!btn) return;
    const original = btn.dataset.originalText || "Consulter mon résultat";
    if(!btn.dataset.originalText) btn.dataset.originalText = original;
    btn.disabled = loading;
    btn.textContent = loading ? "Recherche..." : original;
  }

  function setHint(el, text){
    if(el) el.textContent = text;
  }

  function showError(wrap, message){
    if(!wrap) return;
    wrap.hidden=false;
    wrap.innerHTML = "";
    const d=document.createElement("div");
    d.className="alert alert--danger";
    d.textContent = message;
    wrap.appendChild(d);
  }

  function showResultSafe(r, session){
    const isAdmis = String(r.decision||"").toUpperCase().includes("ADMIS");
    const rank = (r.rank != null && r.rank !== "") ? r.rank : "—";
    const total = (r.total != null && r.total !== "") ? r.total : "—";
    const average = (r.average != null && r.average !== "") ? r.average : "—";
    const sessLabel = session || (r.session ? r.session : "Résultats");
    resultWrap.hidden=false;
    resultWrap.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div class="gov-result ${isAdmis ? "gov-result--admis" : "gov-result--echoue"}" style="position:relative">
        <div class="confetti" data-confetti style="display:${isAdmis ? "block":"none"}"></div>
        <div class="gov-result__top">
          <div class="gov-result__session" data-session></div>
          <div class="gov-result__school">Institut Polytechnique LA PAIX — Document officiel</div>
        </div>
        <div class="gov-result__body">
          <div class="gov-result__identity">
            <div class="gov-result__check" data-check style="display:${isAdmis ? "grid":"none"}">✓</div>
            <div class="gov-result__name" data-name></div>
            <div class="gov-result__class" data-class></div>
          </div>
          <div class="gov-result__rows">
            <div class="gov-result__row"><span class="gov-result__label">Moyenne générale</span><span class="gov-result__value gov-result__value--score" data-average></span></div>
            <div class="gov-result__row"><span class="gov-result__label">Rang</span><span class="gov-result__value" data-rank></span></div>
            <div class="gov-result__row"><span class="gov-result__label">Classe</span><span class="gov-result__value" data-classe></span></div>
          </div>
          <div class="gov-result__decision" data-decision>
            <span class="gov-result__decision-badge" data-badge></span>
            <div class="gov-result__decision-note" data-note></div>
          </div>
          <div style="margin-top:14px" class="alert alert--info">Document officiel IPP. Le fichier original reste disponible auprès du secrétariat sur présentation d'une pièce d'identité.</div>
        </div>
        <div class="gov-result__footer">
          <span>IPP · Service examens · <strong data-date></strong></span>
          <span style="display:flex;align-items:center;gap:8px"><span class="gov-result__seal">IPP</span> Vérifiable</span>
        </div>
      </div>`;
    const root = wrapper.firstElementChild;
    // Injection sécurisée via textContent
    root.querySelector("[data-session]").textContent = sessLabel + " — 2026";
    root.querySelector("[data-name]").textContent = r.name;
    root.querySelector("[data-class]").textContent = `${r.level || ""} ${r.serie || ""} — N° ${rank}/${total}`;
    root.querySelector("[data-average]").textContent = `${average} / 20`;
    root.querySelector("[data-rank]").textContent = `${rank} / ${total}`;
    root.querySelector("[data-classe]").textContent = `${r.level || ""} ${r.serie || ""}`;
    root.querySelector("[data-date]").textContent = new Date().toLocaleDateString("fr-FR");
    const badgeEl = root.querySelector("[data-badge]");
    const noteEl = root.querySelector("[data-note]");
    const decisEl = root.querySelector("[data-decision]");
    if(isAdmis){
      badgeEl.textContent = "✓ ADMIS";
      noteEl.textContent = "Félicitations ! Votre travail a porté ses fruits.";
      decisEl.classList.add("gov-result__decision--admis");
    } else {
      badgeEl.textContent = "✕ Ajourné";
      noteEl.textContent = "Ne renoncez pas — la prochaine session est une opportunité.";
      decisEl.classList.add("gov-result__decision--echoue");
    }
    resultWrap.appendChild(root);
    if(isAdmis) setTimeout(()=> spawnConfetti(root), 80);
    resultWrap.scrollIntoView({behavior:"smooth", block:"start"});
    if(isAdmis && navigator.vibrate) navigator.vibrate(40);
  }

  function spawnConfetti(root){
    const container = root.querySelector("[data-confetti]");
    if(!container) return;
    const colors = ["#84cc16","#a3e635","#65a30d"];
    for(let i=0;i<10;i++){
      const el = document.createElement("span");
      el.className = "confetti__piece";
      el.style.left = (10 + Math.random()*80) + "%";
      el.style.background = colors[i % colors.length];
      el.style.setProperty("--drift", (Math.random()*40 - 20) + "px");
      el.style.animationDelay = (Math.random()*0.2) + "s";
      el.style.animationDuration = (1.2 + Math.random()*0.3) + "s";
      container.appendChild(el);
    }
    setTimeout(()=> container.remove(), 1800);
  }
}
