/* ═══════════════════════════════════════════════════════════════════
   NEURONA v6.1 — script.js
   Motor d'Anàlisi de Matriu de Pesos
   Depèn de: data.json  (carregat via fetch en init)
═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─── Estat global ─────────────────────────────────────────────── */
let DB          = null;   // Dades carregades des de data.json
let lastResult  = null;   // Últim resultat per a l'informe
let scanCounter = 1000;

/* ─── Utils ────────────────────────────────────────────────────── */
const norm = s =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Cerca un lexema en el text normalitzat.
 * Suporta frases (amb espai) i paraules simples.
 */
function trobarLexema(textNorm, lexema) {
  const l = norm(lexema);
  if (l.includes(' ')) return textNorm.includes(l);
  // Paraula sola: comprova que no formi part d'una paraula més llarga
  const re = new RegExp(
    '(^|[\\s,.:;!?¡¿()"\'\\-])' +
    l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '([\\s,.:;!?¡¿()"\'\\-]|$)'
  );
  return re.test(' ' + textNorm + ' ');
}

/* ═══════════════════════════════════════════════════════════════════
   RESET UI — alias públic de clearAll(false)
   Cridada des de analyze() i des del botó "NETEJAR"
════════════════════════════════════════════════════════════════════ */
function resetUI() { clearAll(false); }

/* ═══════════════════════════════════════════════════════════════════
   RELACIÓ DE CONCEPTES — multiplicador x1.5
   Si un mateix paràgraf conté paraules de dues categories
   "emocionals" (por, urgència, emoció, pseudociència) combinades
   amb qualsevol altra categoria de contingut, la penalització
   total de toxicitat es multiplica x1.5.
   Retorna: { active: bool, cats: string[], penalty: number }
════════════════════════════════════════════════════════════════════ */
const EMOTIONAL_CATS = new Set([
  'TOPIC_EMOCIO', 'TOPIC_URGENCIA', 'TOPIC_PSEUDOCIENCIA', 'TOPIC_INSTITUCIONS',
  'TOPIC_CONSPIRAC',
]);

function detectarRelacioConceptes(temaHits, toxicityTotal) {
  const ids = Object.keys(temaHits);
  if (ids.length < 2) return { active: false, cats: [], penalty: 0 };

  // Comprova si hi ha almenys una cat emocional + una cat de contingut
  const hasEmotional = ids.some(id => EMOTIONAL_CATS.has(id));
  const hasContent   = ids.some(id => !EMOTIONAL_CATS.has(id));

  if (!hasEmotional || !hasContent) return { active: false, cats: [], penalty: 0 };

  // Penalty = 50% del toxicityTotal arrodonit (multiplicador x1.5 sobre base)
  const extraPenalty = Math.min(40, Math.round(toxicityTotal * 0.5));
  const cats = ids.map(id => temaHits[id].topic.nom);
  return { active: true, cats, penalty: extraPenalty };
}

/* ═══════════════════════════════════════════════════════════════════
   1. MOTOR PRINCIPAL — calcularFiabilitat(text)
   BASE: 50 punts.  RISK → resta.  TRUST → suma.
   Retorna: { score, det, detectedKW, bigramesDetectats,
               verbsDetectats, temaData, riskTotal, trustTotal, neutral }
════════════════════════════════════════════════════════════════════ */
function calcularFiabilitat(text) {
  const textNorm = norm(text);
  let   score    = 50;          // ← BASE: 50 (neutre)
  const det           = [];
  const detectedKW    = [];
  const bigramesDetectats = [];
  const verbsDetectats    = [];

  /* ── Fase 1: Escaneig de categories RISK i TRUST ────────────── */
  let riskTotal  = 0;
  let trustTotal = 0;
  const temaHits = {};

  for (const topic of DB.categories) {
    let hits = 0, topicTox = 0;
    const isTrust = topic.type === 'trust';

    for (const lex of topic.lexemes) {
      if (trobarLexema(textNorm, lex.w)) {
        hits++;
        topicTox += lex.s;
        // TRUST: s < 0 → suma fiabilitat. RISK: s > 0 → resta.
        if (isTrust) {
          trustTotal += Math.abs(lex.s);
          score      += Math.abs(lex.s);   // suma
        } else {
          riskTotal  += lex.s;
          score      -= lex.s;             // resta
        }
        detectedKW.push({
          word:      lex.w,
          score:     lex.s,
          topicId:   topic.id,
          topicIcon: topic.icon,
          topicNom:  topic.nom,
          type:      topic.type || 'risk',
        });
      }
    }
    if (hits > 0) temaHits[topic.id] = { count: hits, tox: Math.abs(topicTox), topic };
  }

  // Resum de risc acumulat
  if (riskTotal > 0) {
    let ico, label;
    if      (riskTotal >= 20) { ico = '☠️'; label = `Risc crític acumulat (Σ=${riskTotal})`; }
    else if (riskTotal >= 10) { ico = '⚠️'; label = `Risc moderat (Σ=${riskTotal})`;          }
    else                      { ico = '🔍'; label = `Indicadors de risc (Σ=${riskTotal})`;    }
    det.push({ t: 'neg', ico, l: label,
               d: `${detectedKW.filter(k=>k.type==='risk').length} lexemes de risc detectats`, p: -riskTotal });
  }
  if (trustTotal > 0) {
    det.push({ t: 'pos', ico: '✅',
               l: `Indicadors de fiabilitat (Σ=+${trustTotal})`,
               d: `${detectedKW.filter(k=>k.type==='trust').length} lexemes de confiança`, p: +trustTotal });
  }

  /* ── Fase 2: Penalització per densitat ──────────────────────── */
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > 0 && wordCount < 80 && riskTotal >= 8) {
    const densityRatio   = riskTotal / wordCount;
    const densityPenalty = Math.min(25, Math.round(densityRatio * densityRatio * 4));
    if (densityPenalty >= 3) {
      score -= densityPenalty;
      det.push({ t: 'neg', ico: '📐', l: 'Alta densitat de risc',
                 d: `Text curt (${wordCount} paraules) amb risc alt`, p: -densityPenalty });
    }
  }

  /* ── Fase 3: Verbs d'atac transversals ──────────────────────── */
  let verbPenalty = 0;
  for (const verb of DB.verbs_atac) {
    if (trobarLexema(textNorm, verb.w)) {
      verbsDetectats.push(verb.w);
      verbPenalty += verb.s;
    }
  }
  if (verbPenalty > 0) {
    const cap = Math.min(verbPenalty, 20);
    score -= cap;
    det.push({ t: 'neg', ico: '🗡️',
               l: `Verbs d'atac (${verbsDetectats.length})`,
               d: `"${verbsDetectats.slice(0,4).join('", "')}"${verbsDetectats.length>4?'...':''}`,
               p: -cap });
  }

  /* ── Fase 4: Bigrames perillosos (−25% del score actual) ───── */
  for (const bigram of DB.bigrames_perill) {
    const hasA = bigram.a.some(w => trobarLexema(textNorm, w));
    const hasB = bigram.b.some(w => trobarLexema(textNorm, w));
    if (hasA && hasB) {
      bigramesDetectats.push(bigram.label);
      const penalty = Math.round(score * 0.25);
      score -= penalty;
      det.push({ t: 'neg', ico: '💥',
                 l: `Bigrama: ${bigram.label}`,
                 d: 'Combinació temàtica+conspiracionista → −25% fiabilitat', p: -penalty });
    }
  }

  /* ── Fase 5: Relació de conceptes (multiplicador ×1.5) ─────── */
  const relacio = detectarRelacioConceptes(temaHits, riskTotal);
  if (relacio.active && relacio.penalty > 0) {
    score -= relacio.penalty;
    det.push({ t: 'neg', ico: '🔗',
               l: 'Relació de conceptes (×1.5)',
               d: `Emocionalitat + contingut: ${relacio.cats.slice(0,3).join(' + ')}`,
               p: -relacio.penalty });
  }

  /* ── Fase 6: Anomalies de format ────────────────────────────── */
  // Majúscules ≥ 20% → −15% del score actual
  const alfa   = text.replace(/[^a-zA-ZàáèéíïòóúüçÀÁÈÉÍÏÒÓÚÜÇ]/g, '');
  const majPct = alfa.length > 10
    ? alfa.replace(/[a-zàáèéíïòóúüç]/g, '').length / alfa.length : 0;
  if (majPct >= 0.20) {
    const rawP = Math.round(score * 0.15);
    const p    = -(majPct >= 0.50 ? Math.min(rawP * 2, 25) : Math.max(rawP, 10));
    score += p;
    det.push({ t: 'neg', ico: '🔠', l: 'Majúscules excessives',
               d: `${Math.round(majPct*100)}% del text en majúscules → −15% automàtic`, p });
  }
  // Exclamacions ≥ 3 → −15% del score actual
  const excl = (text.match(/!/g) || []).length;
  if (excl >= 3) {
    const p = -(Math.max(Math.round(score * 0.15), 10));
    score += p;
    det.push({ t: 'neg', ico: '❗', l: 'Exclamacions excessives',
               d: `${excl} signes d'exclamació → −15% automàtic`, p });
  }
  // Crida a l'acció
  const ctaRx = /\b(passa.?ho|p[aà]sa.?lo|m[àa]xima.difusi[oó]|reenvieu|comparte|fes.ho.córrer|avisa.a.tothom|avisa.a.todos)\b/i;
  const ctaM  = text.match(ctaRx);
  if (ctaM) {
    score -= 12;
    det.push({ t: 'neg', ico: '📢', l: "Crida a l'acció buida", d: `"${ctaM[0]}"`, p: -12 });
  }
  // Emojis d'alarma
  const alarmEmoji = (text.match(/[🚨⚠️🔴❗‼️🆘]/g) || []).length;
  if (alarmEmoji >= 2) {
    score -= 8;
    det.push({ t: 'neg', ico: '🚨', l: "Emojis d'alarma", d: `${alarmEmoji} emojis d'alerta`, p: -8 });
  }

  /* ── Regla d'Or: si >3 paraules de risc, cap a 60% ─────────── *
   * Encara que l'usuari escrigui "Segons la UNESCO", si ha detectat
   * més de 3 paraules de risc la nota no pot pujar del 60%.
   * ─────────────────────────────────────────────────────────────── */
  const riskWordCount = detectedKW.filter(k => k.type !== 'trust').length;
  if (riskWordCount > 3 && score > 60) {
    score = 60;
    det.push({ t: 'neg', ico: '🔒',
               l: 'Regla d\'Or activada',
               d: `Més de 3 paraules de risc detectades (${riskWordCount}) — nota limitada al 60%`, p: 0 });
  }

  /* ── Fase 7: Detector de Números ────────────────────────────── *
   * REGLA 1: Només penalitza si el número porta % i és > 50.
   * REGLA 2: Xifres monetàries (euros, $, €) → NO penalitzen,
   *          però es detecten com a "Tema Econòmic" informatiu.
   * ─────────────────────────────────────────────────────────────── */
  let numAlarm = false;

  // Percentatges: NOMÉS busca N% on N > 50
  const pctMatches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)];
  const highPct    = pctMatches.filter(m => {
    const v = parseFloat(m[1].replace(',','.'));
    return !isNaN(v) && v > 50;
  });
  if (highPct.length > 0 && trustTotal === 0) {
    const examples = highPct.map(m => m[0]).slice(0,3).join(', ');
    score    -= 20;
    numAlarm  = true;
    det.push({ t: 'neg', ico: '📊',
               l: 'Percentatge elevat sense font',
               d: `Detectat: ${examples} — xifra alta sense font verificada → −20 pts`, p: -20 });
  }

  // Xifres monetàries: detecta però NO penalitza — marca tema econòmic
  const monRx = /\b(\d+(?:[.,]\d+)?)\s*(euros?|€|\$|dòlars?|dolares?|lliures?)\b|\b(euros?|€|\$|dòlars?|dolares?|lliures?)\s*(\d+(?:[.,]\d+)?)\b/gi;
  const monMatches = [...text.matchAll(monRx)];
  if (monMatches.length > 0) {
    const exemples = monMatches.map(m => m[0]).slice(0,3).join(', ');
    det.push({ t: 'neg', ico: '💶',
               l: 'Xifres econòmiques detectades',
               d: `Imports: ${exemples} — verificar la font d'aquestes dades`, p: 0 });
  }

  /* ── Fase 8: Indicadors de rigor addicionals (+) ────────────── */
  if (/\b(seg[uú]ns?|según|d.acord.amb|de.acuerdo.con|publicat.a|publicado.en|informe.de|estudi.de|font:)\b/i.test(text)) {
    score += 8;
    det.push({ t: 'pos', ico: '📎', l: 'Font citada en el text', d: 'El text menciona una font', p: +8 });
  }
  if (/https?:\/\/[^\s]+/.test(text)) {
    score += 8;
    det.push({ t: 'pos', ico: '🔗', l: 'URL verificable present', d: 'Conté un o més enllaços', p: +8 });
  }
  if (/\b(estudi[ao]?|investigaci[oó]|peer.review|assaig.cl[ií]nic|metaanàlisi)\b/i.test(text)) {
    score += 8;
    det.push({ t: 'pos', ico: '🔬', l: 'Referència científica', d: 'Menciona estudis o investigacions', p: +8 });
  }

  /* ── Cas Neutral: sense cap paraula del JSON → exactament 50% ── *
   * Si no s'ha detectat cap paraula (ni risc ni confiança),
   * la fiabilitat es fixa a 50 amb missatge d'avís específic.
   * ─────────────────────────────────────────────────────────────── */
  // Guarda isNaN: si el càlcul ha fallat per qualsevol motiu, fixa a 50
  if (isNaN(score) || !isFinite(score)) score = 50;

  let finalScore = Math.max(0, Math.min(100, Math.round(score)));
  let neutral = false;

  if (detectedKW.length === 0 && verbsDetectats.length === 0 && !numAlarm) {
    // Cap paraula del JSON ni números alarmistes → text neutre
    finalScore = 50;
    neutral    = true;
    det.push({ t: 'neg', ico: 'ℹ️',
               l: 'Anàlisi Inconclusa',
               d: 'No hi ha prou dades per validar el text', p: 0 });
  } else if (isNaN(finalScore) || !isFinite(finalScore)) {
    // Seguretat extra: si malgrat tot el valor és inválid
    finalScore = 50;
    neutral    = true;
  } else if (finalScore >= 45 && finalScore <= 55 && detectedKW.length > 0) {
    neutral = true;
    det.push({ t: 'neg', ico: '⚖️',
               l: 'Resultat Inconclusiu',
               d: 'Indicadors equilibrats: no predomina risc ni fiabilitat', p: 0 });
  }

  /* ── Tema dominant (per categoria de risc) ───────────────────── */
  let temaData = null, topTox = 0;
  for (const [, data] of Object.entries(temaHits)) {
    if (data.topic.type !== 'trust' && data.tox > topTox) {
      topTox = data.tox; temaData = data.topic;
    }
  }

  return {
    score: finalScore,
    det, detectedKW, bigramesDetectats, verbsDetectats,
    temaData, riskTotal, trustTotal,
    toxicityTotal: riskTotal,   // compatibilitat amb heatmap
    neutral, numAlarm,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   2. DETECCIÓ DE TO
════════════════════════════════════════════════════════════════════ */
function analitzarTo(text) {
  const CONSP = /\b(illuminati|deep.state|nou.ordre|nuevo.orden|agenda.oculta|veritat.oculta|conspirac|shadow.government|reptilians|bilderberg)\b/i;
  const ALARM = /\b(tots.morirem|fi.del.món|amenaça.mortal|genocidi|extermini|invasió.imminent|perill.extrem|fi.del.mundo)\b/i;
  const PERS  = /\b(vota|comparteix|mobilitza|resistència|lluiteu|junts.podem)\b/i;
  if (CONSP.test(text)) return { label: 'Conspiracionista',          cls: 'chip-consp' };
  if (ALARM.test(text)) return { label: 'Alarmista / Emocional',     cls: 'chip-alarm' };
  if (PERS.test(text))  return { label: 'Persuasiu / Propagandístic', cls: 'chip-pers'  };
  return                       { label: 'Informatiu / Neutre',        cls: 'chip-info'  };
}

/* ═══════════════════════════════════════════════════════════════════
   3. RENDER — neteja SEMPRE els contenidors abans de pintar
════════════════════════════════════════════════════════════════════ */

/* Helpers de neteja -------------------------------------------- */
function clearPanel(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}
function clearAll(full = false) {
  if (full) {
    document.getElementById('msgInput').value = '';
    document.getElementById('charCount').textContent = '0 / 3000';
  }
  // Amaga el dashboard i neteja tots els contenidors
  document.getElementById('dashboard').classList.remove('visible');
  ['heatBody','varList','cebaGrid'].forEach(clearPanel);
  document.getElementById('heatCount').textContent = '0';
  document.getElementById('varCount').textContent  = '0';
  document.getElementById('scanId').textContent    = '0000';
  document.getElementById('scanTs').textContent    = '--:--:--';
  // Reset gauge
  const fill   = document.getElementById('gaugeFill');
  const needle = document.getElementById('gaugeNeedle');
  const val    = document.getElementById('scoreVal');
  const verd   = document.getElementById('gaugeVerdict');
  if (fill)   { fill.style.strokeDashoffset = '376.99'; fill.style.stroke = '#22d3ee'; }
  if (needle) { needle.setAttribute('x2', '60'); needle.setAttribute('y2', '140'); }
  if (val)    { val.textContent = '--'; val.style.color = 'var(--cyan)'; }
  if (verd)   { verd.textContent = ''; verd.className = 'gauge-verdict'; }
  lastResult = null;
}

/* Gauge --------------------------------------------------------- */
function renderGauge(score) {
  const CIRC  = 376.99;
  const fill   = document.getElementById('gaugeFill');
  const needle = document.getElementById('gaugeNeedle');
  const val    = document.getElementById('scoreVal');
  const verdict = document.getElementById('gaugeVerdict');

  fill.style.strokeDashoffset = CIRC * (1 - score / 100);

  let col, cls, vtext;
  if      (score <= 30) { col = '#f87171'; cls = 'red';   vtext = 'BULO PROBABLE'; }
  else if (score <= 70) { col = '#fbbf24'; cls = 'amber'; vtext = 'VERIFICACIÓ NECESSÀRIA'; }
  else                  { col = '#10d98a'; cls = 'green'; vtext = 'INDICADORS FIABLES'; }

  fill.style.stroke = col;
  val.style.color   = col;

  const angle = Math.PI * (1 - score / 100);
  needle.setAttribute('x2', (150 + 90 * Math.cos(angle)).toFixed(1));
  needle.setAttribute('y2', (140 - 90 * Math.sin(angle)).toFixed(1));

  // Count-up animat
  let cur = 0;
  const step  = score / 40;
  const timer = setInterval(() => {
    cur = Math.min(cur + step, score);
    val.textContent = Math.round(cur);
    if (cur >= score) { clearInterval(timer); val.textContent = score; }
  }, 25);

  verdict.textContent = vtext;
  verdict.className   = 'gauge-verdict ' + cls;
}

/* Heatmap ------------------------------------------------------- */
function heatClass(s) {
  if (s <= 3) return 'heat-t1';
  if (s <= 6) return 'heat-t2';
  if (s <= 8) return 'heat-t3';
  return 'heat-t4';
}

function renderHeatmap(detectedKW, bigrames, verbs) {
  const body  = document.getElementById('heatBody');
  const count = document.getElementById('heatCount');
  body.innerHTML = ''; // CLEAR

  // Deduplicar i ordenar per score desc
  const seen = new Set();
  const uniq = detectedKW.filter(kw => {
    if (seen.has(kw.word)) return false;
    seen.add(kw.word);
    return true;
  }).sort((a, b) => b.score - a.score);

  count.textContent = uniq.length + verbs.length;

  if (!uniq.length && !verbs.length && !bigrames.length) {
    body.innerHTML = '<div class="heatmap-empty">Cap paraula clau detectada en la base de dades.</div>';
    return;
  }

  const tagsWrap = document.createElement('div');
  tagsWrap.className = 'heatmap-wrap';
  uniq.forEach(kw => {
    const tag = document.createElement('span');
    tag.className = `heat-tag ${heatClass(kw.score)}`;
    tag.title     = `${kw.topicNom} · Toxicitat ${kw.score}/10`;
    tag.innerHTML = `${kw.word}<span class="heat-tag__score">T${kw.score}</span><span class="heat-tag__cat">${kw.topicIcon}</span>`;
    tagsWrap.appendChild(tag);
  });
  body.appendChild(tagsWrap);

  if (verbs.length) {
    const div = document.createElement('div');
    div.className = 'verb-alert';
    div.innerHTML = `⚔️ Verbs d'atac: <strong>${verbs.slice(0, 6).join(', ')}${verbs.length > 6 ? ` i ${verbs.length - 6} més` : ''}</strong>`;
    body.appendChild(div);
  }

  bigrames.forEach(b => {
    const div = document.createElement('div');
    div.className = 'bigram-alert';
    div.innerHTML = `💥 Bigrama perillós: <strong>${b}</strong> → −30% fiabilitat`;
    body.appendChild(div);
  });
}

/* Variable chips ------------------------------------------------ */
function renderVariables(det) {
  const list  = document.getElementById('varList');
  const count = document.getElementById('varCount');
  list.innerHTML = ''; // CLEAR
  count.textContent = det.length;

  if (!det.length) {
    list.innerHTML = '<div class="var-empty">Cap variable detectada.</div>';
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'var-chips';
  det.forEach(v => {
    const chip = document.createElement('span');
    chip.className = `var-chip ${v.t}`;
    chip.title     = v.d;
    chip.innerHTML = `<span class="var-chip__ico">${v.ico}</span>${v.l}<span class="var-chip__pts">${v.p > 0 ? '+' : ''}${v.p}</span>`;
    wrap.appendChild(chip);
  });
  list.appendChild(wrap);
}

/* Context panel ------------------------------------------------- */
function renderContext(temaData, to, score, neutral, kwCount) {
  const grid = document.getElementById('cebaGrid');
  grid.innerHTML = ''; // CLEAR

  const catHtml = temaData
    ? `<span class="ceba-chip chip-cat">${temaData.icon} ${temaData.nom}</span>`
    : `<span class="ceba-chip chip-unk">⬡ General</span>`;

  // Diagnòstic — kwCount evita el bug de scope de detectedKW
  let diag;
  if (neutral && kwCount === 0) {
    diag = '🔍 Text no identificat com a notícia: No s\'han detectat paraules clau informatives. Pot ser una conversa personal, una opinió o un tema privat. No és possible determinar si és un bulo o una veritat.';
  } else if (neutral) {
    diag = '⚖️ Resultat Inconclusiu: els indicadors de risc i de fiabilitat s\'equilibren. Aplica verificació manual.';
  } else if (score <= 30) {
    diag = '⛔ Risc alt: múltiples indicadors de bulo confirmats.';
  } else if (score <= 50) {
    diag = '⚠️ Risc moderat: patrons sospitosos detectats. Verificació urgent.';
  } else if (score <= 70) {
    diag = '🔶 Inconclusiu: alguns indicadors dubtosos. Comprova les fonts.';
  } else {
    diag = '✅ Indicadors de fiabilitat superiors als de risc.';
  }

  // Fonts: preferim fonts_fiables (URLs clicables)
  const fontsArr  = temaData?.fonts_fiables || temaData?.fonts || ['maldita.es','newtral.es','verificat.cat'];
  const fontsHtml = fontsArr.map(f => {
    const isUrl = f.includes('.');
    const href  = isUrl ? `https://${f}` : '#';
    const label = isUrl ? f.replace(/^www\./, '') : f;
    return `<a href="${href}" target="_blank" rel="noopener" class="src-link">${label}</a>`;
  }).join('');

  const recomHtml = temaData
    ? `<div class="recom-notice">Recomanem contrastar a: ${fontsArr.slice(0,3).map(f=>`<strong>${f.replace(/^www\./,'')}</strong>`).join(', ')}</div>`
    : '';

  const rows = [
    ['CATEGORIA',   catHtml],
    ['TO DETECTAT', `<span class="ceba-chip ${to.cls}">${to.label}</span>`],
    ['DIAGNÒSTIC',  diag],
    ['FONTS',       `<div class="ceba-sources">${fontsHtml}</div>`],
  ];

  rows.forEach(([key, val]) => {
    const row  = document.createElement('div');
    row.className = 'ceba-row';
    row.innerHTML = `<div class="ceba-key">${key}</div><div class="ceba-val">${val}</div>`;
    grid.appendChild(row);
  });

  if (recomHtml) {
    const div = document.createElement('div');
    div.innerHTML = recomHtml;
    grid.appendChild(div.firstElementChild);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   CERCA INTEL·LIGENT — Multi-cerca (Opció C)
   1. Extreu paraules clau reals del text (no del JSON)
   2. Obre Google News per informació recent
   3. Obre els fact-checkers per verificació
   Les paraules clau s'extreuen del text de l'usuari directament,
   ignorant articles, preposicions i paraules buides.
════════════════════════════════════════════════════════════════════ */

// Paraules buides que NO volem a la cerca (ca + es + en)
const STOP_WORDS = new Set([
  'el','la','els','les','un','una','uns','unes','de','del','dels','a','en','i','o','que',
  'es','per','amb','com','però','si','no','sí','ja','molt','més','tot','tots','tota',
  'totes','aquest','aquesta','aquests','aquestes','aquell','aquella','aquells','aquelles',
  'lo','los','las','hay','han','son','ser','este','esta','estos','estas','ese','esa',
  'con','por','para','pero','porque','como','cuando','donde','me','te','se','nos',
  'os','le','les','al','mi','tu','su','sus','mis','tus','yo','tú','él','ella',
  'nosotros','ellos','ellas','the','and','for','are','but','not','you','all','can',
  'had','her','was','one','our','que','les','des','une','est','qui','que','sur',
  'se','si','ni','na','hi','ho','li','hem','heu','han','era','eren','fou','van',
  'molt','poc','cap','cada','altre','altres','mateix','mateixa',
  'también','también','también','porque','cuando','donde','sobre','entre',
  'hasta','desde','hacia','según','durante','mediante','ante','bajo','tras',
  'este','aquel','algún','ningún','todo','cada','ambos','varios'
]);

function extraureParaulesClau(text) {
  return [...new Set(
    text
      .replace(/[^\w\sàáèéíïòóúüçÀÁÈÉÍÏÒÓÚÜÇ]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
  )].sort((a, b) => b.length - a.length);
}

function verificarGoogle() {
  const text = document.getElementById('msgInput').value.trim();
  if (!text) { flashInput(); return; }

  // ── Extreu les paraules clau reals del text ──────────────────────
  const kwText    = extraureParaulesClau(text);
  // Top 4 paraules més llargues i significatives del text de l'usuari
  const topText   = kwText.slice(0, 4);

  // ── Afegeix paraules de risc del JSON si n'hi ha ─────────────────
  const riskKW = lastResult?.detectedKW
    ?.filter(kw => kw.type === 'risk' || !kw.type)
    ?.sort((a, b) => b.score - a.score)
    ?.slice(0, 2)
    ?.map(k => k.word) || [];

  // Combina: text real primer, després paraules de risc del JSON
  const allTerms = [...new Set([...topText, ...riskKW])].slice(0, 5);
  const queryBase = allTerms.join(' ');

  // ── Fonts específiques de la categoria detectada ─────────────────
  const temaData  = lastResult?.temaData;
  const siteFC    = temaData?.fonts_fiables?.length
    ? temaData.fonts_fiables.slice(0, 3).map(u => `site:${u}`).join(' OR ')
    : 'site:maldita.es OR site:newtral.es OR site:verificat.cat OR site:afpfactual.com';

  // ── Construeix les 3 URLs ─────────────────────────────────────────

  // 1. Google News — informació recent sobre el tema
  const qNews = encodeURIComponent(queryBase);
  const urlNews = `https://news.google.com/search?q=${qNews}&hl=ca&gl=ES`;

  // 2. Fact-checkers oficials — verificació específica
  const qFC = encodeURIComponent(`${queryBase} ${siteFC}`);
  const urlFC = `https://www.google.com/search?q=${qFC}`;

  // 3. Google general — context ampli
  const qGeneral = encodeURIComponent(`${queryBase} verificacion bulo`);
  const urlGeneral = `https://www.google.com/search?q=${qGeneral}`;

  // ── Obre les 3 pestanyes amb un petit retard entre elles ─────────
  // (alguns navegadors bloquegen obertures simultànies)
  window.open(urlNews,    '_blank', 'noopener');
  setTimeout(() => window.open(urlFC,     '_blank', 'noopener'), 300);
  setTimeout(() => window.open(urlGeneral,'_blank', 'noopener'), 600);
}

/* ═══════════════════════════════════════════════════════════════════
   5. INFORME FORENSE — Blob HTML, download directe
════════════════════════════════════════════════════════════════════ */
function descarregarInforme() {
  if (!lastResult) return;
  const { text, score, det, detectedKW, bigramesDetectats, verbsDetectats,
          temaData, to, scanId, scanTs, toxicityTotal } = lastResult;

  const now      = new Date();
  const dateStr  = now.toLocaleDateString('ca-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let scoreColor, scoreLabel;
  if      (score <= 30) { scoreColor = '#f87171'; scoreLabel = 'BULO PROBABLE'; }
  else if (score <= 70) { scoreColor = '#fbbf24'; scoreLabel = 'VERIFICACIÓ NECESSÀRIA'; }
  else                  { scoreColor = '#10d98a'; scoreLabel = 'INDICADORS FIABLES'; }

  // Heatmap tags
  const seen = new Set();
  const uniqKW = detectedKW.filter(kw => {
    if (seen.has(kw.word)) return false;
    seen.add(kw.word); return true;
  }).sort((a, b) => b.score - a.score);

  function tagColor(s) {
    if (s <= 3) return ['rgba(16,217,138,.12)', '#10d98a'];
    if (s <= 6) return ['rgba(251,191,36,.12)',  '#fbbf24'];
    if (s <= 8) return ['rgba(248,113,113,.12)', '#f87171'];
    return              ['rgba(255,50,50,.18)',   '#ff4466'];
  }

  const heatTagsHtml = uniqKW.map(kw => {
    const [bg, col] = tagColor(kw.score);
    return `<span style="display:inline-flex;align-items:center;gap:5px;background:${bg};color:${col};border:1px solid ${col}44;border-radius:6px;padding:4px 9px;font-family:'Share Tech Mono',monospace;font-size:11px;font-weight:700;margin:3px">` +
           `${kw.word}<span style="background:rgba(0,0,0,.3);border-radius:3px;padding:1px 4px;font-size:9px">T${kw.score}</span>` +
           `<span style="font-size:10px">${kw.topicIcon}</span></span>`;
  }).join('') || '<span style="font-family:Share Tech Mono,monospace;font-size:11px;color:#2e3650;padding:8px 0;display:block">Cap paraula clau detectada.</span>';

  const varsHtml = det.map(v => `
    <tr style="border-bottom:1px solid rgba(90,120,220,.08)">
      <td style="padding:8px 10px;font-size:17px;text-align:center">${v.ico}</td>
      <td style="padding:8px 10px;font-family:'Exo 2',sans-serif;font-weight:600;font-size:13px;color:#c8d0e8">${v.l}</td>
      <td style="padding:8px 10px;font-family:'Share Tech Mono',monospace;font-size:10.5px;color:#6472a0">${v.d}</td>
      <td style="padding:8px 10px;font-family:'Bebas Neue',sans-serif;font-size:18px;text-align:right;color:${v.t === 'neg' ? '#f87171' : '#10d98a'}">${v.p > 0 ? '+' : ''}${v.p}</td>
    </tr>`).join('');

  const bigramHtml = bigramesDetectats.map(b =>
    `<div style="background:rgba(255,50,50,.08);border:1px solid rgba(255,50,50,.25);border-radius:8px;padding:8px 12px;` +
    `font-family:'Share Tech Mono',monospace;font-size:11px;color:#ff7a8a;margin-top:6px">💥 ${b} → −30%</div>`
  ).join('');

  const verbHtml = verbsDetectats.length
    ? `<div style="background:rgba(184,126,255,.08);border:1px solid rgba(184,126,255,.2);border-radius:8px;padding:8px 12px;` +
      `font-family:'Share Tech Mono',monospace;font-size:11px;color:#b87eff;margin-top:6px">⚔️ Verbs d'atac: ${verbsDetectats.slice(0, 6).join(', ')}</div>`
    : '';

  const metaItems = [
    ['SCAN ID', `#${scanId}`], ['DATA', dateStr], ['HORA', scanTs],
    ['CARÀCTERS', text.length], ['TOXICITAT Σ', toxicityTotal],
  ].map(([k, v]) =>
    `<div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:#6472a0">${k}: <span style="color:#c8d0e8">${v}</span></div>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="ca">
<head>
<meta charset="UTF-8"/>
<title>Informe NEURONA #${scanId}</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Exo+2:wght@300;400;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Exo 2',sans-serif;background:#07090f;color:#c8d0e8;min-height:100vh;padding:36px 20px 60px;
background-image:linear-gradient(rgba(34,211,238,.012) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.012) 1px,transparent 1px);background-size:32px 32px}
.report{max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
.card{border:1px solid rgba(90,120,220,.15);border-radius:14px;background:#0f1320;overflow:hidden}
.card-hdr{padding:13px 20px;border-bottom:1px solid rgba(90,120,220,.1);background:#141828;display:flex;align-items:center;gap:10px}
.card-hdr-ico{font-size:14px}
.card-hdr-t{font-family:'Share Tech Mono',monospace;font-size:10.5px;color:#6472a0;letter-spacing:.1em;text-transform:uppercase}
.card-body{padding:20px}
@media print{body{background:#07090f!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}}
</style>
</head>
<body>
<div class="report">

  <div class="no-print" style="text-align:right;margin-bottom:-8px">
    <button onclick="window.print()" style="background:#1a1f30;color:#22d3ee;border:1px solid rgba(34,211,238,.3);border-radius:8px;padding:8px 16px;font-family:'Share Tech Mono',monospace;font-size:11px;cursor:pointer;letter-spacing:.06em">🖨️ IMPRIMIR / GUARDAR PDF</button>
  </div>

  <div class="card">
    <div class="card-body" style="padding:28px">
      <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:#22d3ee;letter-spacing:.12em;margin-bottom:8px">▸ INFORME TÈCNIC FORENSE — NEURONA v6.1</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:30px;letter-spacing:.1em;color:#fff;line-height:1">WEIGHTED MATRIX ANALYSIS REPORT</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:#6472a0;letter-spacing:.07em;margin-top:6px">SISTEMA D'ANÀLISI DE MATRIU DE PESOS · data.json extern</div>
      <div style="display:flex;gap:22px;margin-top:14px;flex-wrap:wrap">${metaItems}</div>
    </div>
  </div>

  <div class="card">
    <div class="card-body" style="text-align:center;padding:32px">
      <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:#6472a0;letter-spacing:.1em;margin-bottom:12px">ÍNDEX DE FIABILITAT</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:96px;line-height:1;color:${scoreColor}">${score}<span style="font-size:22px;color:#6472a0">/100</span></div>
      <div style="width:100%;max-width:420px;height:10px;background:#1a1f30;border-radius:5px;margin:16px auto;overflow:hidden">
        <div style="height:100%;width:${score}%;background:${scoreColor};border-radius:5px"></div>
      </div>
      <div style="display:inline-block;font-family:'Exo 2',sans-serif;font-weight:700;font-size:13px;letter-spacing:.12em;text-transform:uppercase;padding:5px 20px;border-radius:20px;color:${scoreColor};background:${scoreColor}18;border:1px solid ${scoreColor}44">${scoreLabel}</div>
      <div style="margin-top:12px;font-size:13px;color:#6472a0">Categoria: <strong style="color:#c8d0e8">${temaData ? temaData.icon + ' ' + temaData.nom : '⬡ General'}</strong> · To: <strong style="color:#c8d0e8">${to.label}</strong></div>
    </div>
  </div>

  <div class="card">
    <div class="card-hdr"><span class="card-hdr-ico">📄</span><span class="card-hdr-t">Text original analitzat</span></div>
    <div class="card-body"><div style="font-size:14px;font-weight:300;line-height:1.75;color:#9298b0;font-style:italic;word-break:break-word">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div></div>
  </div>

  <div class="card">
    <div class="card-hdr"><span class="card-hdr-ico">🔥</span><span class="card-hdr-t">Mapa de calor · ${uniqKW.length} paraules detectades</span></div>
    <div class="card-body">
      <div style="display:flex;flex-wrap:wrap;gap:4px">${heatTagsHtml}</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#6472a0;margin-top:12px;display:flex;gap:14px;flex-wrap:wrap">
        <span>🟢 T1-3 (baix)</span><span>🟡 T4-6 (moderat)</span><span>🟠 T7-8 (alt)</span><span>🔴 T9-10 (crític)</span>
      </div>
      ${verbHtml}${bigramHtml}
    </div>
  </div>

  <div class="card">
    <div class="card-hdr"><span class="card-hdr-ico">⬡</span><span class="card-hdr-t">Variables estructurals (${det.length})</span></div>
    <div class="card-body" style="padding:0">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#141828;font-family:'Share Tech Mono',monospace;font-size:9px;color:#6472a0;letter-spacing:.07em">
          <th style="padding:8px 10px;font-weight:400;text-align:left"></th>
          <th style="padding:8px 10px;font-weight:400;text-align:left">VARIABLE</th>
          <th style="padding:8px 10px;font-weight:400;text-align:left">DETALL</th>
          <th style="padding:8px 10px;font-weight:400;text-align:right">IMPACTE</th>
        </tr></thead>
        <tbody>${varsHtml}</tbody>
      </table>
    </div>
  </div>

  <div style="text-align:center;font-family:'Share Tech Mono',monospace;font-size:9px;color:#2e3650;letter-spacing:.05em;line-height:1.9">
    NEURONA v6.1 · WEIGHTED MATRIX ANALYSIS ENGINE<br>
    ANÀLISI 100% LOCAL · CAP DADA ENVIADA A SERVIDORS EXTERNS<br>
    Aquest informe és una eina orientativa. No substitueix la verificació humana experta.
  </div>

</div>
</body>
</html>`;

  // Descàrrega via Blob — cap popup, cap window.open
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `neurona-informe-${scanId}-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.html`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
}

/* ═══════════════════════════════════════════════════════════════════
   6. UI HELPERS
════════════════════════════════════════════════════════════════════ */
function updateCount(el) {
  document.getElementById('charCount').textContent = `${el.value.length} / ${el.maxLength}`;
}

function flashInput() {
  const ta = document.getElementById('msgInput');
  ta.focus();
  ta.style.borderColor = 'rgba(248,113,113,.6)';
  setTimeout(() => ta.style.borderColor = '', 1400);
}

function showLoading(on) {
  const ov  = document.getElementById('loadingOverlay');
  const btn = document.getElementById('btnAnalyze');
  if (on) {
    ov.classList.add('active');
    btn.disabled = true;
    btn.classList.add('loading');
    // Anima barres
    ['sb1','sb2','sb3','sb4'].forEach((id, i) => {
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) { el.style.transition = 'width .9s ease'; el.style.width = ['68%','90%','55%','100%'][i]; }
      }, i * 280 + 80);
    });
  } else {
    ov.classList.remove('active');
    btn.disabled = false;
    btn.classList.remove('loading');
    ['sb1','sb2','sb3','sb4'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.width = '0';
    });
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════════════════════════════
   7. ANÀLISI PRINCIPAL — Motor local
════════════════════════════════════════════════════════════════════ */
async function analyze() {
  const input = document.getElementById('msgInput');
  if (!input.value.trim()) { flashInput(); return; }
  if (!DB) { alert("La base de dades encara s'està carregant. Torna a intentar-ho."); return; }

  const text = input.value.trim();

  resetUI();
  showLoading(true);
  await delay(1600);
  showLoading(false);

  let result, to;
  try {
    result = calcularFiabilitat(text);
    to     = analitzarTo(text);
  } catch (err) {
    console.error('[NEURONA] Error al càlcul:', err);
    result = {
      score: 50, det: [], detectedKW: [], bigramesDetectats: [], verbsDetectats: [],
      temaData: null, riskTotal: 0, trustTotal: 0, toxicityTotal: 0, neutral: true, numAlarm: false
    };
    result.det.push({ t: 'neg', ico: '⚠️', l: 'Error intern',
                      d: `El sistema ha trobat un problema: ${err.message}`, p: 0 });
    to = { label: 'Indeterminat', cls: 'chip-unk' };
  }

  scanCounter++;
  const scanId = scanCounter;
  const scanTs = new Date().toLocaleTimeString('ca-ES');

  document.getElementById('scanId').textContent = scanId;
  document.getElementById('scanTs').textContent = scanTs;

  lastResult = { ...result, text, to, scanId, scanTs };

  renderGauge(result.score);
  renderHeatmap(result.detectedKW, result.bigramesDetectats, result.verbsDetectats);
  renderVariables(result.det);
  renderContext(result.temaData, to, result.score, result.neutral, result.detectedKW.length);

  const dash = document.getElementById('dashboard');
  dash.classList.add('visible');
  setTimeout(() => dash.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}

/* ═══════════════════════════════════════════════════════════════════
   ANÀLISI PROFUNDA AMB CLAUDE (gratuït via claude.ai)
   Construeix un prompt forense preformat i obre Claude.ai
   amb el text de l'usuari ja inclòs. No necessita API key.
════════════════════════════════════════════════════════════════════ */
function analisiProfunda() {
  const text = document.getElementById('msgInput').value.trim();
  if (!text) { flashInput(); return; }

  // Resum del que el motor local ja ha detectat (per donar context a Claude)
  let resumLocal = '';
  if (lastResult) {
    const { score, riskTotal, trustTotal, temaData } = lastResult;
    resumLocal = `\n\nCONTEXT: El meu analitzador local ha obtingut una puntuació de fiabilitat de ${score}/100 (risc acumulat: ${riskTotal}, confiança: ${trustTotal})${temaData ? `, categoria detectada: ${temaData.nom}` : ''}.`;
  }

  // Prompt forense complet que enviem a Claude
  const prompt =
    `Ets un expert en verificació de fets i detecció de desinformació. ` +
    `Analitza el text següent i respon en català amb:\n\n` +
    `1. **Veredicte** (0-100): Quina probabilitat hi ha que sigui desinformació?\n` +
    `2. **Indicadors de risc**: Quines frases o elements et semblen sospitosos?\n` +
    `3. **Indicadors de credibilitat**: Hi ha elements que augmentin la confiança?\n` +
    `4. **Context**: De quin tema tracta i quines fonts oficials es podrien consultar?\n` +
    `5. **Recomanació**: Hauria l'usuari de compartir aquest contingut?\n\n` +
    `TEXT A ANALITZAR:\n"${text}"` +
    resumLocal;

  // Obre claude.ai amb el prompt preomplert a la URL
  const url = 'https://claude.ai/new?q=' + encodeURIComponent(prompt);
  window.open(url, '_blank', 'noopener');
}

/* ═══════════════════════════════════════════════════════════════════
   8. BASE DE DADES INJECTADA — sense necessitat de servidor
   Les dades estan aquí dins perquè el fitxer funcioni amb doble clic.
   Si vols actualitzar el data.json, executa: python3 inject_db.py
════════════════════════════════════════════════════════════════════ */
const NEURONA_DB_INLINE = {
  "meta": {
    "version": "8.0",
    "description": "NEURONA_CORE_DATA — Base de dades professional de desinformació. Arquitectura RISK/TRUST. Compatible amb script.js v6.1+",
    "author": "Dissenyada per a ús forense acadèmic",
    "last_updated": "2026-03",
    "stats": {
      "categories": 22,
      "type_risk": 18,
      "type_trust": 4,
      "total_lexemes": "~1200",
      "verbs_atac": 60,
      "bigrames": 20
    },
    "scoring": {
      "base": 50,
      "risk_lexeme": "s > 0, resta del score",
      "trust_lexeme": "s > 0 (valor absolut), suma al score",
      "scale": "1-3 lleu | 4-6 moderat | 7-8 alt | 9-10 critic"
    }
  },

  "categories": [

    {
      "id": "RISK_ALARMISME",
      "nom": "Alarmisme i Catastrofisme",
      "icon": "🚨",
      "type": "risk",
      "fonts": ["Maldita.es", "Newtral.es", "Verificat.cat"],
      "fonts_fiables": ["maldita.es", "newtral.es", "verificat.cat", "firstdraftnews.com"],
      "lexemes": [
        {"w": "catastrofe",          "s": 8}, {"w": "catástrofe",          "s": 8},
        {"w": "apocalipsi",          "s": 9}, {"w": "apocalipsis",          "s": 9},
        {"w": "fi del mon",          "s": 10},{"w": "fin del mundo",         "s": 10},
        {"w": "tots morirem",        "s": 10},{"w": "todos moriremos",       "s": 10},
        {"w": "col·lapse",           "s": 7}, {"w": "colapso",              "s": 7},
        {"w": "col.lapse total",     "s": 9}, {"w": "colapso total",        "s": 9},
        {"w": "disparat",            "s": 6}, {"w": "disparado",            "s": 6},
        {"w": "mai vist",            "s": 5}, {"w": "nunca visto",          "s": 5},
        {"w": "sense precedents",    "s": 5}, {"w": "sin precedentes",      "s": 5},
        {"w": "historic",            "s": 4}, {"w": "historico",            "s": 4},
        {"w": "fatal",               "s": 7}, {"w": "devastador",           "s": 7},
        {"w": "irreversible",        "s": 6}, {"w": "irrecuperable",        "s": 7},
        {"w": "shock",               "s": 5}, {"w": "xoc brutal",           "s": 7},
        {"w": "explosiu",            "s": 6}, {"w": "explosivo",            "s": 6},
        {"w": "alarma maxima",       "s": 8}, {"w": "alerta maxima",        "s": 8},
        {"w": "emergencia total",    "s": 8}, {"w": "emergència total",     "s": 8},
        {"w": "perill de mort",      "s": 9}, {"w": "peligro de muerte",    "s": 9},
        {"w": "destruccio total",    "s": 9}, {"w": "destruccion total",    "s": 9},
        {"w": "fi d'una era",        "s": 7}, {"w": "fin de una era",       "s": 6},
        {"w": "col·lapse civilitzacio","s": 10},{"w":"colapso civilizacion", "s": 10},
        {"w": "el mon tal com el coneixem","s":9},{"w":"el mundo tal como lo conocemos","s":9},
        {"w": "esgarrifos",          "s": 7}, {"w": "espeluznante",         "s": 7},
        {"w": "increïble",           "s": 4}, {"w": "increible",            "s": 4},
        {"w": "brutalment",          "s": 6}, {"w": "brutalmente",          "s": 6},
        {"w": "terrorific",          "s": 7}, {"w": "terrorífico",          "s": 7},
        {"w": "dantesc",             "s": 7}, {"w": "dantesco",             "s": 7},
        {"w": "insuportable",        "s": 6}, {"w": "insoportable",         "s": 6},
        {"w": "catastrofic",         "s": 8}, {"w": "catastrófico",         "s": 8},
        {"w": "noticia bomba",       "s": 7}, {"w": "bombshell",            "s": 6},
        {"w": "terratrèmol politic", "s": 7}, {"w": "terremoto politico",   "s": 7},
        {"w": "col·lapse del sistema","s": 9},{"w": "colapso del sistema",  "s": 9},
        {"w": "col·lapse economic",  "s": 8}, {"w": "colapso economico",    "s": 8},
        {"w": "armageddon",          "s": 9}, {"w": "apocalipsis economica","s": 9},
        {"w": "caos total",          "s": 8}, {"w": "caos absoluto",        "s": 8},
        {"w": "no hi ha solucio",    "s": 8}, {"w": "no hay solucion",      "s": 8},
        {"w": "perduts per sempre",  "s": 8}, {"w": "perdidos para siempre","s": 8}
      ]
    },

    {
      "id": "RISK_URGENCIA_FALSA",
      "nom": "Urgència Falsa i Crida a Difondre",
      "icon": "⏰",
      "type": "risk",
      "fonts": ["Poynter", "Maldita.es", "AFP Factual"],
      "fonts_fiables": ["poynter.org", "maldita.es", "afpfactual.com", "verificat.cat"],
      "lexemes": [
        {"w": "urgent",               "s": 7}, {"w": "urgente",              "s": 7},
        {"w": "passa-ho",             "s": 9}, {"w": "pasalo",               "s": 9},
        {"w": "passa-ho ara",         "s": 10},{"w": "pasalo ya",            "s": 10},
        {"w": "comparteix ara",       "s": 9}, {"w": "comparte ahora",       "s": 9},
        {"w": "comparteix",           "s": 5}, {"w": "comparte",             "s": 5},
        {"w": "reenvia",              "s": 8}, {"w": "reenvieu",             "s": 8},
        {"w": "reenvia ya",           "s": 9}, {"w": "reenvia ara",          "s": 9},
        {"w": "abans que ho esborrin","s": 10},{"w": "antes de que lo borren","s": 10},
        {"w": "ultimhora",            "s": 7}, {"w": "ultima hora",          "s": 6},
        {"w": "ultim minut",          "s": 8}, {"w": "ultimo minuto",        "s": 8},
        {"w": "atencion",             "s": 5}, {"w": "atencio important",    "s": 7},
        {"w": "avis urgent",          "s": 8}, {"w": "aviso urgente",        "s": 8},
        {"w": "maxima difusio",       "s": 9}, {"w": "maxima difusion",      "s": 9},
        {"w": "s'acaba el temps",     "s": 9}, {"w": "se acaba el tiempo",   "s": 9},
        {"w": "actua ara",            "s": 8}, {"w": "actua ahora",          "s": 8},
        {"w": "no esperis",           "s": 7}, {"w": "no esperes",           "s": 7},
        {"w": "han esborrat",         "s": 9}, {"w": "han borrado",          "s": 9},
        {"w": "han censurat",         "s": 9}, {"w": "han censurado",        "s": 9},
        {"w": "esborren tot",         "s": 9}, {"w": "borran todo",          "s": 9},
        {"w": "avisa a tothom",       "s": 9}, {"w": "avisa a todos",        "s": 9},
        {"w": "fes-ho correr",        "s": 9}, {"w": "hazlo correr",         "s": 9},
        {"w": "difon ara",            "s": 8}, {"w": "difunde ya",           "s": 8},
        {"w": "no te'n perdis",       "s": 6}, {"w": "no te lo pierdas",     "s": 5},
        {"w": "imprescindible",       "s": 5}, {"w": "llegeix ara",          "s": 6},
        {"w": "llegeix-ho ara",       "s": 7}, {"w": "lee ahora mismo",      "s": 7},
        {"w": "compte enrere",        "s": 8}, {"w": "cuenta atras",         "s": 8},
        {"w": "dema sera tard",       "s": 8}, {"w": "manana sera tarde",    "s": 8},
        {"w": "pronto sera tarde",    "s": 8}, {"w": "ara o mai",            "s": 9},
        {"w": "ahora o nunca",        "s": 9}, {"w": "temps limitat",        "s": 7},
        {"w": "tiempo limitado",      "s": 7}, {"w": "no pots ignorar",      "s": 7},
        {"w": "no puedes ignorar",    "s": 7}, {"w": "llegeix abans",        "s": 7},
        {"w": "lee antes de que",     "s": 8}, {"w": "comparteix-ho si",     "s": 7},
        {"w": "comparte si te importa","s": 7},{"w": "envieu a tothom",      "s": 8},
        {"w": "enviad a todos",       "s": 8}
      ]
    },

    {
      "id": "RISK_CONSPIRACIO_GENERAL",
      "nom": "Conspiranoia General",
      "icon": "🕳️",
      "type": "risk",
      "fonts": ["Bellingcat", "RAND", "EUvsDisinfo"],
      "fonts_fiables": ["bellingcat.com", "rand.org", "euvsdisinfo.eu", "isdglobal.org"],
      "lexemes": [
        {"w": "nou ordre mundial",    "s": 10},{"w": "nuevo orden mundial",   "s": 10},
        {"w": "nwo",                  "s": 9}, {"w": "deep state",            "s": 10},
        {"w": "govern secret",        "s": 9}, {"w": "gobierno secreto",      "s": 9},
        {"w": "shadow government",    "s": 10},{"w": "poder ocult",           "s": 9},
        {"w": "poder oculto",         "s": 9}, {"w": "elit global",           "s": 9},
        {"w": "elites globales",      "s": 9}, {"w": "agenda oculta",         "s": 9},
        {"w": "agenda secreta",       "s": 9}, {"w": "agenda global",         "s": 7},
        {"w": "illuminati",           "s": 10},{"w": "bilderberg",            "s": 10},
        {"w": "trilateria",           "s": 9}, {"w": "franc-macons",          "s": 8},
        {"w": "francmasones",         "s": 8}, {"w": "cabala",               "s": 9},
        {"w": "reptilians",           "s": 10},{"w": "reptilians controlen",  "s": 10},
        {"w": "depopulacio",          "s": 10},{"w": "depopulation",          "s": 10},
        {"w": "reduccio poblacio",    "s": 10},{"w": "reduccion poblacion",   "s": 10},
        {"w": "great reset",          "s": 9}, {"w": "gran reset",            "s": 9},
        {"w": "agenda 2030",          "s": 8}, {"w": "agenda 21",             "s": 8},
        {"w": "gran reemplacament",   "s": 10},{"w": "gran reemplazo",        "s": 10},
        {"w": "reemplacament demografic","s":10},{"w":"reemplazo demografico","s": 10},
        {"w": "ells ens controlen",   "s": 10},{"w": "ellos nos controlan",   "s": 10},
        {"w": "ells ens enganyen",    "s": 10},{"w": "ellos nos enganan",     "s": 10},
        {"w": "matriu",               "s": 6}, {"w": "matrix",               "s": 5},
        {"w": "sheeple",              "s": 8}, {"w": "borrecs",               "s": 7},
        {"w": "rebats",               "s": 6}, {"w": "despierta",             "s": 7},
        {"w": "desperta",             "s": 7}, {"w": "despertaos",            "s": 8},
        {"w": "qanon",                "s": 10},{"w": "pizzagate",             "s": 10},
        {"w": "club de roma",         "s": 8}, {"w": "davos control",         "s": 7},
        {"w": "sionisme",             "s": 8}, {"w": "sionismo",              "s": 8},
        {"w": "jueus controlen",      "s": 10},{"w": "judios controlan",      "s": 10},
        {"w": "satanisme",            "s": 9}, {"w": "satanismo",             "s": 9},
        {"w": "cabala satanica",      "s": 10},{"w": "pedofilia elit",        "s": 10},
        {"w": "terraplanisme",        "s": 10},{"w": "tierra plana",          "s": 10},
        {"w": "terra plana",          "s": 10},{"w": "terra es plana",        "s": 10}
      ]
    },

    {
      "id": "RISK_CONNECTORS_MANIPULACIO",
      "nom": "Connectors de Manipulació",
      "icon": "🎭",
      "type": "risk",
      "fonts": ["First Draft", "EUvsDisinfo", "Reuters Institute"],
      "fonts_fiables": ["firstdraftnews.com", "euvsdisinfo.eu", "reutersinstitute.politics.ox.ac.uk", "poynter.org"],
      "lexemes": [
        {"w": "veritat oculta",              "s": 9},
        {"w": "verdad oculta",               "s": 9},
        {"w": "el que no et diuen",          "s": 10},
        {"w": "lo que no te cuentan",        "s": 10},
        {"w": "el que no veuràs a la tele",  "s": 10},
        {"w": "lo que no veras en la tele",  "s": 10},
        {"w": "el que els poderosos no volen","s":10},
        {"w": "lo que los poderosos no quieren","s":10},
        {"w": "estan intentant eliminar",    "s": 10},
        {"w": "estan intentando eliminar",   "s": 10},
        {"w": "el pla secret",               "s": 9},
        {"w": "el plan secreto",             "s": 9},
        {"w": "oculten la realitat",         "s": 10},
        {"w": "ocultan la realidad",         "s": 10},
        {"w": "silencien la veritat",        "s": 9},
        {"w": "silencian la verdad",         "s": 9},
        {"w": "informacio suprimida",        "s": 9},
        {"w": "informacion suprimida",       "s": 9},
        {"w": "document filtrat",            "s": 8},
        {"w": "documento filtrado",          "s": 8},
        {"w": "font anonima confirma",       "s": 8},
        {"w": "fuente anonima confirma",     "s": 8},
        {"w": "llegeix abans que esborrin",  "s": 10},
        {"w": "lee antes de que borren",     "s": 10},
        {"w": "tots menteixen",              "s": 9},
        {"w": "todos mienten",              "s": 9},
        {"w": "sistema podrit",              "s": 9},
        {"w": "sistema podrido",             "s": 9},
        {"w": "no et pots fiar",             "s": 8},
        {"w": "no te puedes fiar",           "s": 8},
        {"w": "no siguis un borrec",         "s": 9},
        {"w": "no seas un borrego",          "s": 9},
        {"w": "obren els ulls",              "s": 8},
        {"w": "abrid los ojos",              "s": 8},
        {"w": "els que saben callen",        "s": 9},
        {"w": "los que saben callan",        "s": 9},
        {"w": "les veritats incòmodes",      "s": 8},
        {"w": "las verdades incomodas",      "s": 8},
        {"w": "el que no volen que sàpigues","s": 10},
        {"w": "lo que no quieren que sepas", "s": 10},
        {"w": "han eliminat la prova",       "s": 9},
        {"w": "han eliminado la prueba",     "s": 9},
        {"w": "prova irrefutable",           "s": 7},
        {"w": "prueba irrefutable",          "s": 7},
        {"w": "confirmado por fuentes",      "s": 7},
        {"w": "confirmat per fonts",         "s": 7}
      ]
    },

    {
      "id": "RISK_PSEUDOCIENCIA_SALUT",
      "nom": "Pseudociència i Remeis Falsos",
      "icon": "🔮",
      "type": "risk",
      "fonts": ["Cochrane", "PubMed", "Science-Based Medicine"],
      "fonts_fiables": ["cochranelibrary.com", "pubmed.ncbi.nlm.nih.gov", "sciencebasedmedicine.org", "quackwatch.org"],
      "lexemes": [
        {"w": "cura miraculosa",     "s": 9}, {"w": "curacion milagrosa",   "s": 9},
        {"w": "remei secret",        "s": 9}, {"w": "remedio secreto",      "s": 9},
        {"w": "cura definitiva",     "s": 9}, {"w": "curacion definitiva",  "s": 9},
        {"w": "big pharma amaga",    "s": 10},{"w": "big pharma oculta",    "s": 10},
        {"w": "metges menteixen",    "s": 9}, {"w": "medicos mienten",      "s": 9},
        {"w": "metges amaguen",      "s": 9}, {"w": "medicos ocultan",      "s": 9},
        {"w": "farmaceutiques oculten","s":9},{"w": "farmaceuticas ocultan","s": 9},
        {"w": "medicina oficial mata","s": 10},{"w":"medicina oficial falla","s": 9},
        {"w": "cura cancer oculta",  "s": 10},{"w": "cura cancer oculta",   "s": 10},
        {"w": "dioxid de clor",      "s": 10},{"w": "dioxido de cloro",     "s": 10},
        {"w": "mms cura",            "s": 10},{"w": "mms guareix",          "s": 10},
        {"w": "ozono terapia",       "s": 7}, {"w": "ozo-terapia",          "s": 7},
        {"w": "homeopatia cura tot", "s": 9}, {"w": "homeopatia funciona",  "s": 8},
        {"w": "quantum healing",     "s": 8}, {"w": "curacio quantica",     "s": 8},
        {"w": "energia quantica",    "s": 7}, {"w": "energia cuantica",     "s": 7},
        {"w": "vibracio curativa",   "s": 7}, {"w": "vibracion curativa",   "s": 7},
        {"w": "reprogramacio cel.lular","s":8},{"w":"reprogramacion celular","s":8},
        {"w": "detox complet",       "s": 6}, {"w": "desintoxicacio total", "s": 6},
        {"w": "toxines al cos",      "s": 7}, {"w": "toxinas en el cuerpo", "s": 7},
        {"w": "crystalline healing", "s": 7}, {"w": "cristalls curant",     "s": 7},
        {"w": "oli miraculos",       "s": 8}, {"w": "aceite milagroso",     "s": 8},
        {"w": "planta cura tot",     "s": 8}, {"w": "planta cura todo",     "s": 8},
        {"w": "suplement miracle",   "s": 7}, {"w": "suplemento milagro",   "s": 7},
        {"w": "metode prohibit",     "s": 9}, {"w": "metodo prohibido",     "s": 9},
        {"w": "nanobots",            "s": 8}, {"w": "nanotecnologia vacuna","s": 8},
        {"w": "grafe vacuna",        "s": 10},{"w": "grafeno vacuna",       "s": 10},
        {"w": "autoimmune cure",     "s": 7}, {"w": "cura natural definitiva","s":8},
        {"w": "protocol secret",     "s": 8}, {"w": "protocolo secreto",    "s": 8},
        {"w": "cura d'urgencia",     "s": 7}, {"w": "curate en casa",       "s": 6},
        {"w": "curate a casa",       "s": 6}, {"w": "sense efectes secundaris","s":6},
        {"w": "sin efectos secundarios","s":6},{"w":"100% natural",         "s": 5},
        {"w": "100% segur",          "s": 5}, {"w": "100% seguro",          "s": 5},
        {"w": "no te contraindicacions","s":7},{"w":"no tiene contraindicaciones","s":7}
      ]
    },

    {
      "id": "RISK_VACUNES_BULOS",
      "nom": "Bulos sobre Vacunes",
      "icon": "💉",
      "type": "risk",
      "fonts": ["OMS", "EMA", "PubMed", "Cochrane"],
      "fonts_fiables": ["who.int", "ema.europa.eu", "pubmed.ncbi.nlm.nih.gov", "cochranelibrary.com"],
      "lexemes": [
        {"w": "vacuna mata",         "s": 10},{"w": "vacuna matan",         "s": 10},
        {"w": "vacunes maten",       "s": 10},{"w": "vacunas matan",        "s": 10},
        {"w": "microxip vacuna",     "s": 10},{"w": "microchip vacuna",     "s": 10},
        {"w": "chip vacuna",         "s": 10},{"w": "chip subcutani",       "s": 10},
        {"w": "chip subcutaneo",     "s": 10},{"w": "antivacuna",           "s": 7},
        {"w": "antivacunes",         "s": 7}, {"w": "antivaxxer",           "s": 8},
        {"w": "antivax",             "s": 7}, {"w": "vacuna experimental",  "s": 6},
        {"w": "cobai vacuna",        "s": 8}, {"w": "conejillo vacuna",     "s": 8},
        {"w": "autisme vacuna",      "s": 10},{"w": "vacuna autisme",       "s": 10},
        {"w": "wakefield",           "s": 9}, {"w": "vacuna obligatoria",   "s": 7},
        {"w": "vacunacio forcada",   "s": 8}, {"w": "vacunacion forzada",   "s": 8},
        {"w": "passaport vacunal",   "s": 5}, {"w": "pasaporte vacunal",    "s": 5},
        {"w": "segregacio vacunal",  "s": 7}, {"w": "segregacion vacunal",  "s": 7},
        {"w": "thimerosal",          "s": 6}, {"w": "mercuri vacuna",       "s": 8},
        {"w": "mercurio vacuna",     "s": 8}, {"w": "alumini vacuna",       "s": 7},
        {"w": "aluminio vacuna",     "s": 7}, {"w": "adjuvant toxic",       "s": 7},
        {"w": "nanoparticules vacuna","s": 8},{"w": "nanoparticulas vacuna","s": 8},
        {"w": "esterilitzar vacuna", "s": 10},{"w": "esterilizar vacuna",   "s": 10},
        {"w": "vacuna esterilitza",  "s": 10},{"w": "vacuna esteriliza",    "s": 10},
        {"w": "mort sobtada vacuna", "s": 10},{"w": "muerte subita vacuna", "s": 10},
        {"w": "VAERS",               "s": 5}, {"w": "morts vacuna pfizer",  "s": 9},
        {"w": "muertes vacuna pfizer","s": 9},{"w": "vacuna mrna perillosa","s": 8},
        {"w": "mrna peligrosa",      "s": 8}, {"w": "vacuna no testada",    "s": 7},
        {"w": "vacuna sin testear",  "s": 7}, {"w": "immunit natural superior","s":6}
      ]
    },

    {
      "id": "RISK_PANDEMIA_BULOS",
      "nom": "Bulos sobre Pandèmies i Malalties",
      "icon": "🦠",
      "type": "risk",
      "fonts": ["OMS", "ECDC", "Johns Hopkins"],
      "fonts_fiables": ["who.int", "ecdc.europa.eu", "coronavirus.jhu.edu", "msf.es"],
      "lexemes": [
        {"w": "plandemia",           "s": 10},{"w": "scamdemic",            "s": 10},
        {"w": "pandemia falsa",      "s": 9}, {"w": "pandèmia falsa",       "s": 9},
        {"w": "virus fabricat",      "s": 10},{"w": "virus artificial",     "s": 9},
        {"w": "coronavirus arma",    "s": 10},{"w": "covid arma biologica",  "s": 10},
        {"w": "wuhan lab",           "s": 7}, {"w": "laboratori wuhan",     "s": 7},
        {"w": "lab leak",            "s": 6}, {"w": "fuga laboratorio",     "s": 6},
        {"w": "pcr fals",            "s": 8}, {"w": "pcr manipulado",       "s": 9},
        {"w": "falsos positius pcr", "s": 8}, {"w": "casedemic",            "s": 9},
        {"w": "es solo gripe",       "s": 7}, {"w": "es nomes grip",        "s": 7},
        {"w": "fauci menteix",       "s": 8}, {"w": "fauci miente",         "s": 8},
        {"w": "oms corrupta",        "s": 8}, {"w": "oms corrupte",         "s": 8},
        {"w": "pandemia programada", "s": 10},{"w": "pandèmia programada",  "s": 10},
        {"w": "event 201",           "s": 7}, {"w": "simulacre pandemia",   "s": 7},
        {"w": "confinament il.legal","s": 7}, {"w": "confinamiento ilegal", "s": 7},
        {"w": "mascareta inutil",    "s": 7}, {"w": "mascarilla inutil",    "s": 7},
        {"w": "mascareta fa mal",    "s": 8}, {"w": "mascarilla hace dano", "s": 8},
        {"w": "covid inexistent",    "s": 9}, {"w": "covid inventado",      "s": 9},
        {"w": "inventat covid",      "s": 9}, {"w": "sida lab",             "s": 8},
        {"w": "sida fabricado",      "s": 8}, {"w": "ebola fabricat",       "s": 8}
      ]
    },

    {
      "id": "RISK_5G_TECNOFOBIA",
      "nom": "Bulos sobre 5G i Radiació",
      "icon": "📡",
      "type": "risk",
      "fonts": ["OMS", "ICNIRP", "GSMA"],
      "fonts_fiables": ["who.int", "icnirp.org", "gsma.com", "itu.int"],
      "lexemes": [
        {"w": "5g perill",           "s": 8}, {"w": "5g peligro",           "s": 8},
        {"w": "5g mata",             "s": 9}, {"w": "5g matan",             "s": 9},
        {"w": "5g activa virus",     "s": 10},{"w": "5g covid",             "s": 10},
        {"w": "antena 5g perill",    "s": 8}, {"w": "antena 5g peligro",    "s": 8},
        {"w": "torre 5g canceren",   "s": 9}, {"w": "5g causa cancer",      "s": 9},
        {"w": "microxip vacuna 5g",  "s": 10},{"w": "chip 5g",             "s": 9},
        {"w": "electrosensibilitat", "s": 7}, {"w": "electrosensibilidad",  "s": 7},
        {"w": "wifi perill",         "s": 7}, {"w": "wifi peligroso",       "s": 7},
        {"w": "wifi fa mal",         "s": 7}, {"w": "wifi hace dano",       "s": 7},
        {"w": "bluetooth dany",      "s": 7}, {"w": "bluetooth daña",       "s": 7},
        {"w": "ones electromagnetiques perill","s":7},
        {"w": "ondas electromagneticas peligro","s":7},
        {"w": "radiacio perill",     "s": 6}, {"w": "radiacion peligrosa",  "s": 6},
        {"w": "smart meter perill",  "s": 7}, {"w": "contador inteligente mal","s":7},
        {"w": "starlink control",    "s": 8}, {"w": "satelit vigilancia",   "s": 7},
        {"w": "chemtrails",          "s": 9}, {"w": "esteles avio",         "s": 6},
        {"w": "fumigacio aerosol",   "s": 8}, {"w": "fumigacion aerea",     "s": 8},
        {"w": "barium fumigacio",    "s": 9}, {"w": "geoenginyeria oculta", "s": 8},
        {"w": "geoingenieria oculta","s": 8}, {"w": "fluor control mental", "s": 9},
        {"w": "fluoruro control",    "s": 9}, {"w": "fluor aigu",           "s": 8}
      ]
    },

    {
      "id": "RISK_CONSPIRACIO_POLITICA",
      "nom": "Conspiració Política i Frau Electoral",
      "icon": "🗳️",
      "type": "risk",
      "fonts": ["Bellingcat", "OCCRP", "Reuters"],
      "fonts_fiables": ["bellingcat.com", "occrp.org", "reuters.com", "apnews.com"],
      "lexemes": [
        {"w": "frau electoral",      "s": 8}, {"w": "fraude electoral",     "s": 8},
        {"w": "vots robats",         "s": 9}, {"w": "votos robados",        "s": 9},
        {"w": "urnes manipulades",   "s": 9}, {"w": "urnas manipuladas",    "s": 9},
        {"w": "eleccions fraudulentes","s":8},{"w":"elecciones fraudulentas","s":8},
        {"w": "dictadura",           "s": 7}, {"w": "totalitarisme",        "s": 7},
        {"w": "totalitarismo",       "s": 7}, {"w": "comunisme amagat",     "s": 8},
        {"w": "comunismo oculto",    "s": 8}, {"w": "marxisme cultural",    "s": 8},
        {"w": "marxismo cultural",   "s": 8}, {"w": "golp d'estat",         "s": 8},
        {"w": "golpe de estado",     "s": 8}, {"w": "govern ocult",         "s": 9},
        {"w": "gobierno oculto",     "s": 9}, {"w": "marionetes govern",    "s": 8},
        {"w": "marionetas gobierno", "s": 8}, {"w": "ordres de dalt",       "s": 9},
        {"w": "ordenes de arriba",   "s": 9}, {"w": "politic corrupte",     "s": 6},
        {"w": "politico corrupto",   "s": 6}, {"w": "tots corruptes",       "s": 7},
        {"w": "todos corruptos",     "s": 7}, {"w": "politicians criminals","s": 8},
        {"w": "pres politic",        "s": 6}, {"w": "preso politico",       "s": 6},
        {"w": "censura politica",    "s": 7}, {"w": "lawfare",              "s": 6},
        {"w": "lawfare judicial",    "s": 7}, {"w": "estat profund",        "s": 8},
        {"w": "estado profundo",     "s": 8}, {"w": "false flag",           "s": 9},
        {"w": "bandera falsa",       "s": 9}, {"w": "falsa bandera",        "s": 9},
        {"w": "atac fals",           "s": 9}, {"w": "ataque falso",         "s": 9},
        {"w": "operacio encoberta",  "s": 8}, {"w": "operacion encubierta", "s": 8},
        {"w": "atemptat autoinduit", "s": 9}, {"w": "atentado autoinfligido","s": 9},
        {"w": "11s conspirat",       "s": 10},{"w": "11s conspiración",     "s": 10}
      ]
    },

    {
      "id": "RISK_IMMIGRACIO_BULOS",
      "nom": "Bulos sobre Immigració i Refugiats",
      "icon": "🚶",
      "type": "risk",
      "fonts": ["ACNUR", "IOM", "Eurostat"],
      "fonts_fiables": ["acnur.org", "iom.int", "ec.europa.eu", "ine.es"],
      "lexemes": [
        {"w": "invasio migratoria",  "s": 9}, {"w": "invasion migratoria",  "s": 9},
        {"w": "gran reemplacament",  "s": 10},{"w": "gran reemplazo",       "s": 10},
        {"w": "reemplacament demografic","s":10},{"w":"reemplazo demografico","s":10},
        {"w": "invasio",             "s": 7}, {"w": "invasion",             "s": 7},
        {"w": "allau immigrants",    "s": 7}, {"w": "aluvion inmigrantes",  "s": 7},
        {"w": "roben feina",         "s": 8}, {"w": "roban trabajo",        "s": 8},
        {"w": "quitan empleos",      "s": 7}, {"w": "criminalitat immigrants","s":8},
        {"w": "criminalidad inmigrantes","s":8},{"w":"menes criminals",     "s": 9},
        {"w": "menas criminales",    "s": 9}, {"w": "no-go zones",          "s": 7},
        {"w": "zona prohibida",      "s": 6}, {"w": "islamitzacio",         "s": 8},
        {"w": "islamizacion",        "s": 8}, {"w": "sharia europa",        "s": 8},
        {"w": "eurabia",             "s": 9}, {"w": "califat europa",       "s": 9},
        {"w": "califato europa",     "s": 9}, {"w": "repatriacio massiva",  "s": 7},
        {"w": "repatriacion masiva", "s": 7}, {"w": "deportar tots",        "s": 8},
        {"w": "deportar a todos",    "s": 8}, {"w": "fronteres obertes perill","s":7},
        {"w": "fronteras abiertas peligro","s":7},
        {"w": "immigrants terroristes","s":9},{"w": "inmigrantes terroristas","s":9}
      ]
    },

    {
      "id": "RISK_CLIMA_NEGACIONISME",
      "nom": "Negacionisme Climàtic",
      "icon": "🌡️",
      "type": "risk",
      "fonts": ["IPCC", "NASA Climate", "NOAA"],
      "fonts_fiables": ["ipcc.ch", "climate.nasa.gov", "noaa.gov", "copernicus.eu"],
      "lexemes": [
        {"w": "canvi climatic fals", "s": 9}, {"w": "cambio climatico falso","s": 9},
        {"w": "negacionisme climatic","s": 8},{"w": "negacionismo climatico","s": 8},
        {"w": "fraude climatico",    "s": 9}, {"w": "estafa climatica",     "s": 9},
        {"w": "hoax clima",          "s": 9}, {"w": "mentida climatica",    "s": 9},
        {"w": "mentira climatica",   "s": 9}, {"w": "agenda climatica",     "s": 7},
        {"w": "estafa climàtica",    "s": 9}, {"w": "greta robot",          "s": 7},
        {"w": "activisme pagat",     "s": 7}, {"w": "activismo pagado",     "s": 7},
        {"w": "ipcc menteix",        "s": 9}, {"w": "ipcc miente",          "s": 9},
        {"w": "scientists lie",      "s": 8}, {"w": "scientists paid",      "s": 7},
        {"w": "cicles naturals normals","s":5},{"w": "sol controla clima",  "s": 5},
        {"w": "co2 no fa mal",       "s": 7}, {"w": "co2 no es malo",       "s": 7},
        {"w": "hivernacle fals",     "s": 8}, {"w": "efecto invernadero falso","s":8},
        {"w": "geoenginyeria secret","s": 8}, {"w": "manipulacio clima",    "s": 8}
      ]
    },

    {
      "id": "RISK_ECONOMIA_BULOS",
      "nom": "Bulos Econòmics i Financers",
      "icon": "💸",
      "type": "risk",
      "fonts": ["BCE", "FMI", "Eurostat", "BdE"],
      "fonts_fiables": ["ecb.europa.eu", "imf.org", "ec.europa.eu", "bde.es"],
      "lexemes": [
        {"w": "gran reset economic",  "s": 9},{"w": "great reset economico", "s": 9},
        {"w": "col.lapse economic",   "s": 8},{"w": "colapso economico",     "s": 8},
        {"w": "hiperinflacio",        "s": 6},{"w": "hiperinflacion",        "s": 6},
        {"w": "sistema bancari corrupte","s":8},{"w":"bancos corruptos",    "s": 8},
        {"w": "estafa financera",     "s": 8},{"w": "estafa financiera",    "s": 8},
        {"w": "robatori fiscal",      "s": 8},{"w": "robo fiscal",          "s": 8},
        {"w": "impost il.legal",      "s": 7},{"w": "impuesto ilegal",      "s": 7},
        {"w": "pensions robades",     "s": 8},{"w": "pensiones robadas",    "s": 8},
        {"w": "esquema ponzi",        "s": 9},{"w": "ponzi nacional",       "s": 9},
        {"w": "piramide financera",   "s": 9},{"w": "piramide financiera",  "s": 9},
        {"w": "moneda digital control","s":8},{"w": "cbdc control",         "s": 8},
        {"w": "eliminar efectiu",     "s": 7},{"w": "eliminar efectivo",    "s": 7},
        {"w": "eliminar cash control","s": 8},{"w": "bitcoin solucio",      "s": 5},
        {"w": "cripto estafa",        "s": 8},{"w": "crypto scam",          "s": 8},
        {"w": "pump and dump",        "s": 9},{"w": "rug pull",             "s": 9},
        {"w": "inversio garantida",   "s": 7},{"w": "inversion garantizada","s": 7},
        {"w": "dobla diners",         "s": 8},{"w": "duplica dinero",       "s": 8},
        {"w": "hazte rico rapido",    "s": 8},{"w": "fes-te ric rapid",     "s": 8},
        {"w": "forex estafa",         "s": 8},{"w": "borsas manipulades",   "s": 7},
        {"w": "bolsas manipuladas",   "s": 7},{"w": "fmi vol empobrir",     "s": 8},
        {"w": "fmi quiere empobrecer","s": 8},
        {"w": "inflacion disparada",  "s": 7},{"w": "inflacio disparada",   "s": 7},
        {"w": "inflacion",            "s": 4},{"w": "inflacio",             "s": 4},
        {"w": "petroleo",             "s": 4},{"w": "petroli",              "s": 4},
        {"w": "precio petroleo",      "s": 5},{"w": "preu petroli",         "s": 5},
        {"w": "precio disparado",     "s": 7},{"w": "preu disparat",        "s": 7},
        {"w": "precio se dispara",    "s": 7},{"w": "preu es dispara",      "s": 7},
        {"w": "desbocado",            "s": 6},{"w": "desbocada",            "s": 6},
        {"w": "descontrolado",        "s": 6},{"w": "descontrolada",        "s": 6},
        {"w": "crisis energetica",    "s": 6},{"w": "crisi energetica",     "s": 6},
        {"w": "apagon energetico",    "s": 7},{"w": "col.lapse energetic",  "s": 7},
        {"w": "recesion",             "s": 5},{"w": "recessio",             "s": 5},
        {"w": "quiebra",              "s": 6},{"w": "fallida",              "s": 6},
        {"w": "bancarrota",           "s": 7},{"w": "bancarrota total",     "s": 8}
      ]
    },

    {
      "id": "RISK_GENERE_BULOS",
      "nom": "Bulos sobre Gènere i Igualtat",
      "icon": "⚧️",
      "type": "risk",
      "fonts": ["OMS", "Eurostat", "UN Women"],
      "fonts_fiables": ["who.int", "ec.europa.eu", "unwomen.org", "ilga.org"],
      "lexemes": [
        {"w": "ideologia de genere",  "s": 7},{"w": "ideologia de género",  "s": 7},
        {"w": "adoctrinament genere", "s": 8},{"w": "adoctrinamiento genero","s": 8},
        {"w": "destruir familia",     "s": 9},{"w": "destruyen familia",    "s": 9},
        {"w": "atac a la familia",    "s": 8},{"w": "ataque a la familia",  "s": 8},
        {"w": "agenda lgtb",          "s": 7},{"w": "lobby lgtb",           "s": 8},
        {"w": "lobby gay",            "s": 7},{"w": "agenda gay",           "s": 7},
        {"w": "feminazi",             "s": 8},{"w": "ultrafeministra",      "s": 6},
        {"w": "mutilacio menors",     "s": 8},{"w": "mutilacion menores",   "s": 8},
        {"w": "curar homosexualitat", "s": 9},{"w": "curar homosexualidad", "s": 9},
        {"w": "terapia de conversio", "s": 8},{"w": "terapia de conversion","s": 8},
        {"w": "genere imposat",       "s": 7},{"w": "genero impuesto",      "s": 7},
        {"w": "transgenere menors perill","s":7},{"w":"transgenerismo peligroso","s":7},
        {"w": "violencia de genere inventada","s":8},{"w":"violencia genero inventada","s":8}
      ]
    },

    {
      "id": "RISK_EDUCACIO_BULOS",
      "nom": "Bulos sobre Educació",
      "icon": "📚",
      "type": "risk",
      "fonts": ["OCDE/PISA", "UNESCO", "Ministeri Educació"],
      "fonts_fiables": ["pisa.oecd.org", "unesco.org", "educacionyfp.gob.es", "consellescolar.gencat.cat"],
      "lexemes": [
        {"w": "adoctrinament escolar","s": 8},{"w": "adoctrinamiento escolar","s": 8},
        {"w": "escola woke",          "s": 8},{"w": "escuela woke",          "s": 8},
        {"w": "woke",                 "s": 6},{"w": "ideologia escola",      "s": 7},
        {"w": "ideologia escuela",    "s": 7},{"w": "roben fills",           "s": 9},
        {"w": "roban hijos",          "s": 9},{"w": "fills adoctrinats",     "s": 8},
        {"w": "hijos adoctrinados",   "s": 8},{"w": "professor adoctrinador","s": 8},
        {"w": "maestro adoctrinador", "s": 8},{"w": "manual marxista",       "s": 8},
        {"w": "marxisme educacio",    "s": 8},{"w": "marxismo educacion",    "s": 8},
        {"w": "teoria critica raça",  "s": 7},{"w": "teoria critica raza",   "s": 7},
        {"w": "prohibit pensar",      "s": 7},{"w": "prohibido pensar",      "s": 7},
        {"w": "censura escolar",      "s": 6},{"w": "censura en educacion",  "s": 6}
      ]
    },

    {
      "id": "RISK_INSTITUCIONS_DESCONFIANCA",
      "nom": "Desconfiança en Institucions",
      "icon": "🏛️",
      "type": "risk",
      "fonts": ["RAND", "Reuters Institute", "ISD Global"],
      "fonts_fiables": ["rand.org", "reutersinstitute.politics.ox.ac.uk", "isdglobal.org", "euvsdisinfo.eu"],
      "lexemes": [
        {"w": "oms corrompuda",       "s": 8},{"w": "oms corrupta",         "s": 8},
        {"w": "onu corrompuda",       "s": 8},{"w": "onu corrupta",         "s": 8},
        {"w": "periodistes venuts",   "s": 9},{"w": "periodistas vendidos",  "s": 9},
        {"w": "cientifics pagats",    "s": 9},{"w": "cientificos pagados",   "s": 9},
        {"w": "metges corruptes",     "s": 9},{"w": "medicos corruptos",     "s": 9},
        {"w": "institucions corruptes","s":9},{"w":"instituciones corruptas","s": 9},
        {"w": "tot es mentida",       "s": 9},{"w": "todo es mentira",      "s": 9},
        {"w": "sistema podrit",       "s": 9},{"w": "sistema podrido",      "s": 9},
        {"w": "totalment corrupte",   "s": 8},{"w": "totalmente corrupto",  "s": 8},
        {"w": "no et pots fiar de",   "s": 8},{"w": "no te puedes fiar de", "s": 8},
        {"w": "jutges corruptes",     "s": 8},{"w": "jueces corruptos",     "s": 8},
        {"w": "policia corrupta",     "s": 7},{"w": "policia corrupta",     "s": 7},
        {"w": "exercit il.legal",     "s": 7},{"w": "ejercito ilegal",      "s": 7},
        {"w": "govern mentider",      "s": 8},{"w": "gobierno mentiroso",   "s": 8},
        {"w": "premsa controlada",    "s": 8},{"w": "prensa controlada",    "s": 8},
        {"w": "media mainstream menteix","s":8},{"w":"mainstream media mentira","s":8},
        {"w": "bbc menteix",          "s": 8},{"w": "cnn menteix",          "s": 8},
        {"w": "cnn miente",           "s": 8},{"w": "new york times mentira","s":7},
        {"w": "propagand",            "s": 7}
      ]
    },

    {
      "id": "RISK_TERRORISME_GEOPOLITICA",
      "nom": "Terrorisme i Conflictes Armats",
      "icon": "💣",
      "type": "risk",
      "fonts": ["Europol", "CITCO", "Bellingcat"],
      "fonts_fiables": ["europol.europa.eu", "interior.gob.es", "bellingcat.com", "occrp.org"],
      "lexemes": [
        {"w": "atemptat imminent",    "s": 8},{"w": "atentado inminente",   "s": 8},
        {"w": "cellula terrorista",   "s": 7},{"w": "celula terrorista",    "s": 7},
        {"w": "cellula dormant",      "s": 7},{"w": "celula durmiente",     "s": 7},
        {"w": "lone wolf atac",       "s": 7},{"w": "lone wolf ataque",     "s": 7},
        {"w": "jihadisme actiu",      "s": 7},{"w": "yihadismo activo",     "s": 7},
        {"w": "califat imminent",     "s": 8},{"w": "califato inminente",   "s": 8},
        {"w": "guerra civil imminent","s": 8},{"w": "guerra civil inminente","s":8},
        {"w": "guerra mundial",       "s": 7},{"w": "tercera guerra mundial","s":8},
        {"w": "guerra",               "s": 4},{"w": "conflict armat",       "s": 5},
        {"w": "conflicto armado",     "s": 5},{"w": "guerra iran",          "s": 6},
        {"w": "guerra rusia",         "s": 6},{"w": "guerra ucrania",       "s": 5},
        {"w": "guerra oriente medio", "s": 6},{"w": "guerra orient mitja",  "s": 6},
        {"w": "estalla la guerra",    "s": 8},{"w": "esclata la guerra",    "s": 8},
        {"w": "inicio de guerra",     "s": 7},{"w": "inici de guerra",      "s": 7},
        {"w": "ww3",                  "s": 8},{"w": "nuclear attack imminent","s":9},
        {"w": "atac nuclear imminent","s": 9},{"w": "ataque nuclear inminente","s":9},
        {"w": "invasio imminent",     "s": 8},{"w": "invasion inminente",   "s": 8},
        {"w": "false flag atac",      "s": 9},{"w": "false flag ataque",    "s": 9}
      ]
    },

    {
      "id": "RISK_EMOCIO_POR",
      "nom": "Manipulació Emocional i Por",
      "icon": "😱",
      "type": "risk",
      "fonts": ["First Draft", "Reuters Institute"],
      "fonts_fiables": ["firstdraftnews.com", "reutersinstitute.politics.ox.ac.uk", "poynter.org", "rand.org"],
      "lexemes": [
        {"w": "patir",               "s": 4}, {"w": "suffering",            "s": 4},
        {"w": "desesperacio",        "s": 7}, {"w": "desesperacion",        "s": 7},
        {"w": "por",                 "s": 5}, {"w": "miedo",                "s": 5},
        {"w": "panic",               "s": 7}, {"w": "terror",               "s": 7},
        {"w": "horror",              "s": 7}, {"w": "odi",                  "s": 7},
        {"w": "odio",                "s": 7}, {"w": "ira",                  "s": 6},
        {"w": "rabi",                "s": 6}, {"w": "rabia",                "s": 6},
        {"w": "indignacio",          "s": 6}, {"w": "indignacion",          "s": 6},
        {"w": "nens moren",          "s": 9}, {"w": "ninos mueren",         "s": 9},
        {"w": "victimes innocents",  "s": 7}, {"w": "victimas inocentes",   "s": 7},
        {"w": "indefensos",          "s": 6}, {"w": "desprotegits",         "s": 6},
        {"w": "plora",               "s": 5}, {"w": "llora",                "s": 5},
        {"w": "suplic",              "s": 6}, {"w": "suplico",              "s": 6},
        {"w": "perill imminent",     "s": 8}, {"w": "peligro inminente",    "s": 8},
        {"w": "amenaça directa",     "s": 8}, {"w": "amenaza directa",      "s": 8},
        {"w": "no hi ha esperança",  "s": 8}, {"w": "no hay esperanza",     "s": 8},
        {"w": "esteu condemnats",    "s": 9}, {"w": "estais condenados",    "s": 9},
        {"w": "tots perduts",        "s": 8}, {"w": "todos perdidos",       "s": 8},
        {"w": "combat emocional",    "s": 6}, {"w": "batalla emocional",    "s": 6},
        {"w": "sofriment",           "s": 5}, {"w": "sufrimiento",          "s": 5},
        {"w": "trauma col.lectiu",   "s": 7}, {"w": "trauma colectivo",     "s": 7}
      ]
    },

    {
      "id": "RISK_ANTIMEDIS",
      "nom": "Atac als Medis i Periodisme",
      "icon": "📰",
      "type": "risk",
      "fonts": ["RSF", "CPJ", "Reuters Institute"],
      "fonts_fiables": ["rsf.org", "cpj.org", "reutersinstitute.politics.ox.ac.uk", "ifcncodeofprinciples.poynter.org"],
      "lexemes": [
        {"w": "fake news",           "s": 5}, {"w": "bulo evident",         "s": 5},
        {"w": "medis controlen",     "s": 9}, {"w": "medios controlan",     "s": 9},
        {"w": "media menteix",       "s": 8}, {"w": "medios mienten",       "s": 8},
        {"w": "periodistes venuts",  "s": 9}, {"w": "periodistas vendidos", "s": 9},
        {"w": "periodisme corrupte", "s": 7}, {"w": "periodismo corrupto",  "s": 7},
        {"w": "censura informativa", "s": 7}, {"w": "silencien noticia",    "s": 8},
        {"w": "silencian noticia",   "s": 8}, {"w": "suprimeixen info",     "s": 8},
        {"w": "suprimen informacion","s": 8}, {"w": "noticia censurada",    "s": 8},
        {"w": "informacio prohibida","s": 8}, {"w": "informacion prohibida","s": 8},
        {"w": "propietaris dels medis","s":7},{"w": "duenos de los medios", "s": 7},
        {"w": "periodista a sou",    "s": 8}, {"w": "periodista a sueldo",  "s": 8},
        {"w": "tele menteix",        "s": 7}, {"w": "television miente",    "s": 7},
        {"w": "radio menteix",       "s": 7}, {"w": "radio miente",         "s": 7}
      ]
    },

    {
      "id": "RISK_CIBERSEGURETAT_BULOS",
      "nom": "Bulos sobre Ciberseguretat i Privacitat",
      "icon": "🛡️",
      "type": "risk",
      "fonts": ["INCIBE", "CCN-CERT", "ENISA"],
      "fonts_fiables": ["incibe.es", "ccn-cert.cni.es", "enisa.europa.eu", "cisa.gov"],
      "lexemes": [
        {"w": "espionatge total",    "s": 8}, {"w": "espionaje total",      "s": 8},
        {"w": "vigilancia massiva",  "s": 7}, {"w": "vigilancia masiva",    "s": 7},
        {"w": "big brother",         "s": 7}, {"w": "gran germa",           "s": 7},
        {"w": "totalitarisme digital","s":8}, {"w": "totalitarismo digital","s": 8},
        {"w": "societat de control", "s": 7}, {"w": "sociedad de control",  "s": 7},
        {"w": "credit social",       "s": 7}, {"w": "credito social",       "s": 7},
        {"w": "social credit xina",  "s": 7}, {"w": "internet apagat",      "s": 7},
        {"w": "apagon de internet",  "s": 7}, {"w": "control d'internet",   "s": 7},
        {"w": "cancel cultura",      "s": 6}, {"w": "cancel culture",       "s": 6},
        {"w": "shadowban",           "s": 5}, {"w": "shadowbanning",        "s": 5},
        {"w": "algorisme censura",   "s": 7}, {"w": "algoritmo censura",    "s": 7},
        {"w": "facebook espiona",    "s": 7}, {"w": "google espiona",       "s": 7},
        {"w": "google espia",        "s": 7}, {"w": "microfon activat",     "s": 7},
        {"w": "microfono activo",    "s": 7}, {"w": "escoltant converses",  "s": 8},
        {"w": "escuchando conversaciones","s":8},{"w":"camara activa",      "s": 7}
      ]
    },

    {
      "id": "TRUST_FONTS_CIENTIFIQUES",
      "nom": "Fonts Científiques i Acadèmiques",
      "icon": "🔬",
      "type": "trust",
      "fonts": ["Nature", "Science", "Lancet", "NEJM"],
      "fonts_fiables": ["nature.com", "sciencemag.org", "thelancet.com", "nejm.org"],
      "lexemes": [
        {"w": "publicat a nature",        "s": 9},
        {"w": "publicado en nature",      "s": 9},
        {"w": "publicat a science",       "s": 9},
        {"w": "publicado en science",     "s": 9},
        {"w": "lancet",                   "s": 8},
        {"w": "new england journal",      "s": 9},
        {"w": "nejm",                     "s": 8},
        {"w": "peer review",              "s": 8},
        {"w": "revisio per parells",      "s": 8},
        {"w": "assaig clinic",            "s": 7},
        {"w": "ensayo clinico",           "s": 7},
        {"w": "assaig aleatoritzat",      "s": 8},
        {"w": "ensayo aleatorizado",      "s": 8},
        {"w": "metaanalisi",              "s": 8},
        {"w": "metaanalisis",             "s": 8},
        {"w": "revisio sistematica",      "s": 8},
        {"w": "revision sistematica",     "s": 8},
        {"w": "evidencia cientifica",     "s": 8},
        {"w": "evidència científica",     "s": 8},
        {"w": "estudi publicat",          "s": 7},
        {"w": "estudio publicado",        "s": 7},
        {"w": "publicat a plos",          "s": 7},
        {"w": "publicat a jama",          "s": 8},
        {"w": "publicado en jama",        "s": 8},
        {"w": "publicat a bmj",           "s": 8},
        {"w": "publicado en bmj",         "s": 8},
        {"w": "arxiv",                    "s": 6},
        {"w": "preprint verificat",       "s": 6},
        {"w": "investigadors del mit",    "s": 7},
        {"w": "investigadores del mit",   "s": 7},
        {"w": "universitat de harvard",   "s": 7},
        {"w": "universidad de harvard",   "s": 7},
        {"w": "csic",                     "s": 7},
        {"w": "cnrs",                     "s": 7},
        {"w": "dades de l'ine",           "s": 6},
        {"w": "datos del ine",            "s": 6},
        {"w": "eurostat confirma",        "s": 6},
        {"w": "eurostat confirma",        "s": 6},
        {"w": "dades oficials eurostat",  "s": 7},
        {"w": "datos oficiales eurostat", "s": 7}
      ]
    },

    {
      "id": "TRUST_INSTITUCIONS_OFICIALS",
      "nom": "Institucions i Fonts Oficials",
      "icon": "🏛️",
      "type": "trust",
      "fonts": ["OMS", "UNESCO", "BCE", "Nacions Unides"],
      "fonts_fiables": ["who.int", "unesco.org", "ecb.europa.eu", "un.org"],
      "lexemes": [
        {"w": "boe",                      "s": 8},
        {"w": "butlleti oficial",         "s": 8},
        {"w": "boletin oficial",          "s": 8},
        {"w": "boe confirma",             "s": 8},
        {"w": "oms",                      "s": 6},
        {"w": "who",                      "s": 6},
        {"w": "organitzacio mundial salut","s": 7},
        {"w": "organizacion mundial salud","s":7},
        {"w": "unesco",                   "s": 7},
        {"w": "unicef",                   "s": 6},
        {"w": "nacions unides",           "s": 6},
        {"w": "naciones unidas",          "s": 6},
        {"w": "onu",                      "s": 5},
        {"w": "ministeri",                "s": 5},
        {"w": "ministerio",               "s": 5},
        {"w": "consell de ministres",     "s": 6},
        {"w": "consejo de ministros",     "s": 6},
        {"w": "parlament europeu",        "s": 6},
        {"w": "parlamento europeo",       "s": 6},
        {"w": "comissio europea",         "s": 6},
        {"w": "comision europea",         "s": 6},
        {"w": "tribunal suprem",          "s": 6},
        {"w": "tribunal supremo",         "s": 6},
        {"w": "tribunal constitucional",  "s": 6},
        {"w": "agencia europea del medicament","s":7},
        {"w": "ema",                      "s": 6},
        {"w": "agencia europea medicamento","s":7},
        {"w": "fda aprovada",             "s": 7},
        {"w": "fda aprobada",             "s": 7},
        {"w": "cdc confirma",             "s": 6},
        {"w": "ecdc",                     "s": 6},
        {"w": "institut nacional estadistica","s":6},
        {"w": "instituto nacional estadistica","s":6},
        {"w": "bank of spain",            "s": 5},
        {"w": "banco de espana",          "s": 5},
        {"w": "banc d'espanya",           "s": 5},
        {"w": "informacio oficial",       "s": 6},
        {"w": "informacion oficial",      "s": 6},
        {"w": "comunicat oficial",        "s": 6},
        {"w": "comunicado oficial",       "s": 6},
        {"w": "nota de premsa oficial",   "s": 7},
        {"w": "nota de prensa oficial",   "s": 7}
      ]
    },

    {
      "id": "TRUST_VERIFICADORS_FACTCHECKING",
      "nom": "Verificadors i Fact-Checking",
      "icon": "✅",
      "type": "trust",
      "fonts": ["Maldita.es", "Newtral.es", "Verificat.cat", "AFP Factual"],
      "fonts_fiables": ["maldita.es", "newtral.es", "verificat.cat", "afpfactual.com"],
      "lexemes": [
        {"w": "maldita.es",               "s": 8},
        {"w": "maldita es",               "s": 8},
        {"w": "newtral.es",               "s": 8},
        {"w": "newtral es",               "s": 8},
        {"w": "verificat.cat",            "s": 8},
        {"w": "verificat cat",            "s": 8},
        {"w": "afpfactual",               "s": 8},
        {"w": "afp fact check",           "s": 8},
        {"w": "fact-check",               "s": 7},
        {"w": "fact check",               "s": 7},
        {"w": "verificat per",            "s": 7},
        {"w": "verificado por",           "s": 7},
        {"w": "desmentit per",            "s": 7},
        {"w": "desmentido por",           "s": 7},
        {"w": "es fals que",              "s": 7},
        {"w": "es falso que",             "s": 7},
        {"w": "no es veritat que",        "s": 7},
        {"w": "no es verdad que",         "s": 7},
        {"w": "bulo desmentit",           "s": 9},
        {"w": "bulo desmentido",          "s": 9},
        {"w": "rumor fals",               "s": 7},
        {"w": "rumor falso",              "s": 7},
        {"w": "hoax desmentit",           "s": 8},
        {"w": "hoax desmentido",          "s": 8},
        {"w": "snopes",                   "s": 7},
        {"w": "politifact",               "s": 7},
        {"w": "poynter",                  "s": 6},
        {"w": "ifcn",                     "s": 6},
        {"w": "reuters fact check",       "s": 8},
        {"w": "reuters fact-check",       "s": 8},
        {"w": "bbc reality check",        "s": 7},
        {"w": "les veritats",             "s": 5},
        {"w": "desmentim",                "s": 7},
        {"w": "desmentimos",              "s": 7}
      ]
    },

    {
      "id": "TRUST_RIGOR_PERIODISTIC",
      "nom": "Rigor Periodístic i Fonts Citades",
      "icon": "📎",
      "type": "trust",
      "fonts": ["Reuters", "AP", "EFE", "AFP"],
      "fonts_fiables": ["reuters.com", "apnews.com", "efe.com", "afp.com"],
      "lexemes": [
        {"w": "segons fonts de",          "s": 6},
        {"w": "segun fuentes de",         "s": 6},
        {"w": "d'acord amb",              "s": 5},
        {"w": "de acuerdo con",           "s": 5},
        {"w": "publicat a",               "s": 5},
        {"w": "publicado en",             "s": 5},
        {"w": "informa reuters",          "s": 8},
        {"w": "informa la agencia reuters","s":8},
        {"w": "ap informa",               "s": 7},
        {"w": "informa ap",               "s": 7},
        {"w": "efe informa",              "s": 7},
        {"w": "afp informa",              "s": 7},
        {"w": "informa el pais",          "s": 6},
        {"w": "el pais informa",          "s": 6},
        {"w": "la vanguardia",            "s": 5},
        {"w": "la vanguardia informa",    "s": 6},
        {"w": "the guardian",             "s": 6},
        {"w": "the new york times",       "s": 6},
        {"w": "washington post",          "s": 6},
        {"w": "informe de la oms",        "s": 7},
        {"w": "informe de l'oms",         "s": 7},
        {"w": "informe official",         "s": 6},
        {"w": "informe oficial",          "s": 6},
        {"w": "dades de",                 "s": 4},
        {"w": "datos de",                 "s": 4},
        {"w": "estadistiques de",         "s": 5},
        {"w": "estadisticas de",          "s": 5},
        {"w": "l'estudi diu",             "s": 6},
        {"w": "el estudio dice",          "s": 6},
        {"w": "l'informe conclou",        "s": 7},
        {"w": "el informe concluye",      "s": 7},
        {"w": "la investigacio mostra",   "s": 7},
        {"w": "la investigacion muestra", "s": 7},
        {"w": "els resultats indiquen",   "s": 7},
        {"w": "los resultados indican",   "s": 7},
        {"w": "es confirma que",          "s": 5},
        {"w": "se confirma que",          "s": 5},
        {"w": "universitat",              "s": 5},
        {"w": "universidad",              "s": 5},
        {"w": "investigadors han demostrat","s":7},
        {"w": "investigadores han demostrado","s":7},
        {"w": "cientifics han descobert", "s": 7},
        {"w": "cientificos han descubierto","s":7},
        {"w": "doctors sense fronteres",  "s": 6},
        {"w": "medicos sin fronteras",    "s": 6}
      ]
    }

  ],

  "verbs_atac": [
    {"w": "oculten",     "s": 8}, {"w": "ocultan",     "s": 8},
    {"w": "amaguen",     "s": 7}, {"w": "amagan",      "s": 7},
    {"w": "menteixen",   "s": 8}, {"w": "mienten",     "s": 8},
    {"w": "menteix",     "s": 8}, {"w": "miente",      "s": 8},
    {"w": "enganyen",    "s": 8}, {"w": "engañan",     "s": 8},
    {"w": "enganya",     "s": 8}, {"w": "engana",      "s": 8},
    {"w": "manipulen",   "s": 8}, {"w": "manipulan",   "s": 8},
    {"w": "manipula",    "s": 7}, {"w": "controlen",   "s": 7},
    {"w": "controlan",   "s": 7}, {"w": "controla",    "s": 6},
    {"w": "obliguen",    "s": 7}, {"w": "obligan",     "s": 7},
    {"w": "forcen",      "s": 7}, {"w": "fuerzan",     "s": 7},
    {"w": "roben",       "s": 8}, {"w": "roban",       "s": 8},
    {"w": "roba",        "s": 7}, {"w": "envenen",     "s": 9},
    {"w": "envenenan",   "s": 9}, {"w": "enverina",    "s": 9},
    {"w": "envenena",    "s": 9}, {"w": "destrueixen", "s": 7},
    {"w": "destruyen",   "s": 7}, {"w": "destrueix",   "s": 7},
    {"w": "destruye",    "s": 7}, {"w": "amenacen",    "s": 7},
    {"w": "amenazan",    "s": 7}, {"w": "silencien",   "s": 7},
    {"w": "silencian",   "s": 7}, {"w": "censuren",    "s": 7},
    {"w": "censuran",    "s": 7}, {"w": "reprimeixen", "s": 7},
    {"w": "reprimen",    "s": 7}, {"w": "oprimeixen",  "s": 7},
    {"w": "oprimen",     "s": 7}, {"w": "arruinen",    "s": 8},
    {"w": "arruinan",    "s": 8}, {"w": "arruina",     "s": 7},
    {"w": "adoctrinen",  "s": 8}, {"w": "adoctrinan",  "s": 8},
    {"w": "inoculen",    "s": 7}, {"w": "inoculan",    "s": 7},
    {"w": "assassinen",  "s": 9}, {"w": "asesinan",    "s": 9},
    {"w": "eliminen",    "s": 7}, {"w": "eliminan",    "s": 7},
    {"w": "esborren",    "s": 7}, {"w": "borran",      "s": 7},
    {"w": "programen",   "s": 7}, {"w": "programan",   "s": 7},
    {"w": "implanten",   "s": 7}, {"w": "implantan",   "s": 7},
    {"w": "infecten",    "s": 8}, {"w": "infectan",    "s": 8},
    {"w": "intoxiquen",  "s": 8}, {"w": "intoxican",   "s": 8}
  ],

  "bigrames_perill": [
    {
      "a": ["vacuna", "vacunes", "vacunacio"],
      "b": ["microxip", "chip", "xip", "control", "mata", "nanobots", "grafe", "esterilitza"],
      "label": "Bulo vacuna+control tecnologic"
    },
    {
      "a": ["5g", "antena", "torre telecomunicacio"],
      "b": ["virus", "covid", "malaltia", "mata", "causa", "activa", "cancer"],
      "label": "Bulo 5G+malaltia"
    },
    {
      "a": ["govern", "gobierno", "estat", "estado"],
      "b": ["menteix", "oculta", "amaga", "enganya", "mata", "enverina", "espiona"],
      "label": "Narrativa govern corrupte"
    },
    {
      "a": ["medis", "premsa", "periodistes", "televisio", "radio"],
      "b": ["controlen", "menteixen", "oculten", "censurats", "manipulen", "pagats"],
      "label": "Narrativa antimedis"
    },
    {
      "a": ["immigrants", "migrants", "refugiats", "inmigrantes"],
      "b": ["invasio", "destrouen", "crims", "terroristes", "arrasaran", "destrueixen"],
      "label": "Bulo immigracio+criminalitat"
    },
    {
      "a": ["escola", "educacio", "professors", "escuela", "maestros"],
      "b": ["adoctrinen", "manipulen", "programen", "endoctrinen", "adoctrinan"],
      "label": "Bulo adoctrinament escolar"
    },
    {
      "a": ["bill gates", "gates", "soros", "george soros"],
      "b": ["chip", "microxip", "control", "vacuna", "depopulacio", "financa", "paga"],
      "label": "Teoria conspirativa personatges"
    },
    {
      "a": ["aliment", "menjar", "pa", "agua", "aigua"],
      "b": ["enverina", "envenena", "mata", "contamina", "toxic", "qimic"],
      "label": "Bulo alimentacio+veri"
    },
    {
      "a": ["big pharma", "farmaceutica", "laboratori farmaceutic"],
      "b": ["amaga", "oculta", "cura", "cancer", "menteix", "miente", "enriqueix"],
      "label": "Bulo Big Pharma"
    },
    {
      "a": ["oms", "who", "cdc", "agencia sanitaria"],
      "b": ["menteix", "miente", "corrompuda", "corrupta", "pagada", "controlada", "oculta"],
      "label": "Bulo institucions sanitaries corrompudes"
    },
    {
      "a": ["eleccions", "elecciones", "vot", "voto"],
      "b": ["frau", "fraude", "robades", "robadas", "manipulades", "manipuladas", "trampa"],
      "label": "Bulo frau electoral"
    },
    {
      "a": ["pcr", "test covid", "test antigen"],
      "b": ["fals", "falso", "manipulat", "manipulado", "inventat", "inventado", "no funciona"],
      "label": "Bulo tests covid falsos"
    },
    {
      "a": ["chemtrails", "esteles", "fumigacio"],
      "b": ["control mental", "barium", "alumini", "esprai", "toxic", "govern", "secret"],
      "label": "Bulo chemtrails"
    },
    {
      "a": ["terra", "mon", "planeta"],
      "b": ["plana", "plana no rodona", "terra plana", "no es rodona", "pla", "flat"],
      "label": "Bulo terraplanisme"
    },
    {
      "a": ["nou ordre mundial", "nwo", "illuminati", "deep state"],
      "b": ["controla", "dirige", "planeja", "organitza", "finança", "paga", "dirigeix"],
      "label": "Conspiranoia global"
    },
    {
      "a": ["climate", "canvi climatic", "escalfament global"],
      "b": ["fals", "falso", "mentida", "mentira", "estafa", "fraude", "inventat"],
      "label": "Negacionisme climatic"
    },
    {
      "a": ["microxip", "chip", "implant"],
      "b": ["control", "seguiment", "tracking", "espiona", "governa", "activat 5g"],
      "label": "Bulo microxip de control"
    },
    {
      "a": ["fluorur", "fluor", "clor"],
      "b": ["control mental", "cervell", "submis", "manipulacio", "obediencia"],
      "label": "Bulo fluor control mental"
    },
    {
      "a": ["periodista", "reporter", "informador"],
      "b": ["ven", "venuda", "pagat", "pagada", "corrupte", "corrupta", "a sou de"],
      "label": "Atac a periodistes"
    },
    {
      "a": ["cientific", "investigador", "doctor", "metge"],
      "b": ["pagat per", "corrupte", "menteix", "amaguen", "venen", "financat per"],
      "label": "Atac a la ciencia"
    }
  ]
}
;

function init() {
  const statusTxt = document.querySelector('.status-txt');
  const statusDot = document.querySelector('.status-dot');

  try {
    DB = NEURONA_DB_INLINE;
    const total = DB.categories.reduce((acc, c) => acc + c.lexemes.length, 0);
    console.info(`[NEURONA] DB inline carregada: ${DB.categories.length} categories, ${total} lexemes`);

    if (statusTxt) statusTxt.textContent = 'EN LÍNIA';
    if (statusDot) { statusDot.style.background = '#10d98a'; statusDot.style.boxShadow = '0 0 6px #10d98a'; }
  } catch (err) {
    console.error('[NEURONA] Error carregant DB inline:', err);
    if (statusTxt) statusTxt.textContent = 'ERROR DB';
    if (statusDot) { statusDot.style.background = '#f87171'; statusDot.style.boxShadow = '0 0 6px #f87171'; }
    alert('Error intern carregant la base de dades. Recarrega la pàgina.');
  }
}

/* ── Escolta d'events ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  init();
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') analyze();
  });
});
