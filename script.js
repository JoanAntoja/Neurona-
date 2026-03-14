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
   1. MOTOR PRINCIPAL — calcularFiabilitat(text)
   Retorna: { score, det, detectedKW, bigramesDetectats,
               verbsDetectats, temaData, toxicityTotal }
════════════════════════════════════════════════════════════════════ */
function calcularFiabilitat(text) {
  const textNorm      = norm(text);
  let   score         = 100;
  const det           = [];      // Variables estructurals (chips)
  const detectedKW    = [];      // Paraules clau amb pes
  const bigramesDetectats = [];
  const verbsDetectats    = [];

  /* ── Fase 1: Escaneig de categories ─────────────────────────── */
  let toxicityTotal = 0;
  const temaHits    = {};   // id → { count, tox, topic }

  for (const topic of DB.categories) {
    let hits = 0, topicTox = 0;
    for (const lex of topic.lexemes) {
      if (trobarLexema(textNorm, lex.w)) {
        hits++;
        topicTox      += lex.s;
        toxicityTotal += lex.s;
        detectedKW.push({
          word:      lex.w,
          score:     lex.s,
          topicId:   topic.id,
          topicIcon: topic.icon,
          topicNom:  topic.nom,
        });
      }
    }
    if (hits > 0) temaHits[topic.id] = { count: hits, tox: topicTox, topic };
  }

  /* Regla de toxicitat acumulada */
  if (toxicityTotal > 0) {
    if (toxicityTotal >= 15) {
      const penalty = Math.min(60, 10 + toxicityTotal * 2.5);
      score -= penalty;
      det.push({
        t: 'neg', ico: '☠️',
        l: `Toxicitat crítica (Σ=${toxicityTotal})`,
        d: `Suma de pesos supera el llindar crític de 15`,
        p: -Math.round(penalty),
      });
    } else if (toxicityTotal >= 8) {
      const penalty = Math.min(30, toxicityTotal * 2);
      score -= penalty;
      det.push({
        t: 'neg', ico: '⚠️',
        l: `Toxicitat moderada (Σ=${toxicityTotal})`,
        d: `${detectedKW.length} paraules de risc detectades`,
        p: -Math.round(penalty),
      });
    } else {
      score -= toxicityTotal;
      det.push({
        t: 'neg', ico: '🔍',
        l: `Lexemes de risc (Σ=${toxicityTotal})`,
        d: `${detectedKW.length} paraules clau de risc baix`,
        p: -toxicityTotal,
      });
    }
  }

  /* ── Fase 2: Verbs d'atac transversals ──────────────────────── */
  let verbPenalty = 0;
  for (const verb of DB.verbs_atac) {
    if (trobarLexema(textNorm, verb.w)) {
      verbsDetectats.push(verb.w);
      verbPenalty += verb.s;
    }
  }
  if (verbPenalty > 0) {
    const cap = Math.min(verbPenalty, 30);
    score -= cap;
    det.push({
      t: 'neg', ico: '🗡️',
      l: `Verbs d'atac (${verbsDetectats.length})`,
      d: `"${verbsDetectats.slice(0, 4).join('", "')}"${verbsDetectats.length > 4 ? '...' : ''}`,
      p: -cap,
    });
  }

  /* ── Fase 3: Bigrames perillosos (−30% extra) ───────────────── */
  for (const bigram of DB.bigrames_perill) {
    const hasA = bigram.a.some(w => trobarLexema(textNorm, w));
    const hasB = bigram.b.some(w => trobarLexema(textNorm, w));
    if (hasA && hasB) {
      bigramesDetectats.push(bigram.label);
      const penalty = Math.round(score * 0.30);
      score -= penalty;
      det.push({
        t: 'neg', ico: '💥',
        l: `Bigrama: ${bigram.label}`,
        d: 'Combinació temàtica+conspiracionista → −30% fiabilitat',
        p: -penalty,
      });
    }
  }

  /* ── Fase 4: Variables estructurals de text ─────────────────── */
  // T1. Majúscules sostingudes (≥20%)
  const alfa   = text.replace(/[^a-zA-ZàáèéíïòóúüçÀÁÈÉÍÏÒÓÚÜÇ]/g, '');
  const majPct = alfa.length > 10
    ? alfa.replace(/[a-zàáèéíïòóúüç]/g, '').length / alfa.length
    : 0;
  if (majPct >= 0.20) {
    const p = majPct >= 0.50 ? -30 : -15;
    score += p;
    det.push({
      t: 'neg', ico: '🔠',
      l: 'Majúscules excessives',
      d: `${Math.round(majPct * 100)}% del text en majúscules`,
      p,
    });
  }

  // T2. Exclamacions excessives (≥3)
  const excl = (text.match(/!/g) || []).length;
  if (excl >= 3) {
    score -= 15;
    det.push({ t: 'neg', ico: '❗', l: 'Exclamacions excessives', d: `${excl} signes d'exclamació`, p: -15 });
  }

  // T3. Crida a l'acció buida
  const ctaRx = /\b(passa.?ho|p[aà]sa.?lo|m[àa]xima.difusi[oó]|reenvieu|comparte|fes.ho.córrer|avisa.a.tothom|avisa.a.todos)\b/i;
  const ctaM  = text.match(ctaRx);
  if (ctaM) {
    score -= 15;
    det.push({ t: 'neg', ico: '📢', l: "Crida a l'acció buida", d: `"${ctaM[0]}"`, p: -15 });
  }

  // T4. Emojis d'alarma (≥2)
  const alarmEmoji = (text.match(/[🚨⚠️🔴❗‼️🆘]/g) || []).length;
  if (alarmEmoji >= 2) {
    score -= 10;
    det.push({ t: 'neg', ico: '🚨', l: "Emojis d'alarma", d: `${alarmEmoji} emojis d'alerta`, p: -10 });
  }

  /* ── Fase 5: Indicadors de rigor (+10) ──────────────────────── */
  if (/\b(seg[uú]ns?|según|d.acord.amb|de.acuerdo.con|publicat.a|publicado.en|informe.de|estudi.de|font:)\b/i.test(text)) {
    score += 10;
    det.push({ t: 'pos', ico: '📎', l: 'Font identificada', d: 'El text cita fonts', p: +10 });
  }
  if (/https?:\/\/[^\s]+/.test(text)) {
    score += 10;
    det.push({ t: 'pos', ico: '🔗', l: 'URL present', d: 'Conté enllaços verificables', p: +10 });
  }
  if (/\b(estudi[ao]?|investigaci[oó]|peer.review|assaig.cl[ií]nic|metaanàlisi)\b/i.test(text)) {
    score += 10;
    det.push({ t: 'pos', ico: '🔬', l: 'Referència científica', d: 'Menciona estudis o investigacions', p: +10 });
  }

  /* ── Lògica de buit: sense indicadors → 50 (NEUTRAL) ────────── */
  let neutral = false;
  if (detectedKW.length === 0 && verbsDetectats.length === 0 && det.filter(d => d.t === 'neg').length === 0) {
    score   = 50;
    neutral = true;
    det.push({
      t: 'neg', ico: 'ℹ️',
      l: 'Sense indicadors suficients',
      d: 'Text sense paraules clau forenses identificables',
      p: 0,
    });
  }

  /* ── Tema dominant ───────────────────────────────────────────── */
  let temaData = null, topTox = 0;
  for (const [, data] of Object.entries(temaHits)) {
    if (data.tox > topTox) { topTox = data.tox; temaData = data.topic; }
  }

  return {
    score:    Math.max(0, Math.min(100, Math.round(score))),
    det,
    detectedKW,
    bigramesDetectats,
    verbsDetectats,
    temaData,
    toxicityTotal,
    neutral,
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
function renderContext(temaData, to, score, neutral) {
  const grid = document.getElementById('cebaGrid');
  grid.innerHTML = ''; // CLEAR

  const catHtml = temaData
    ? `<span class="ceba-chip chip-cat">${temaData.icon} ${temaData.nom}</span>`
    : `<span class="ceba-chip chip-unk">⬡ General</span>`;

  let diag;
  if (neutral)      diag = 'ℹ️ Text sense indicadors forenses suficients. Aplicar verificació manual.';
  else if (score <= 30) diag = '⛔ Risc alt: múltiples indicadors de bulo confirmats.';
  else if (score <= 50) diag = '⚠️ Risc moderat: patrons sospitosos. Verificació urgent.';
  else if (score <= 70) diag = '🔶 Inconclusiu: alguns indicadors dubtosos.';
  else              diag = '✅ Cap indicador crític detectat.';

  const fonts = (temaData ? temaData.fonts : ['Maldita.es', 'Newtral.es', 'Verificat.cat'])
    .map(f => `<a href="#" class="src-link" onclick="return false">${f}</a>`).join('');

  const rows = [
    ['CATEGORIA',   catHtml],
    ['TO DETECTAT', `<span class="ceba-chip ${to.cls}">${to.label}</span>`],
    ['DIAGNÒSTIC',  diag],
    ['FONTS',       `<div class="ceba-sources">${fonts}</div>`],
  ];

  rows.forEach(([key, val]) => {
    const row  = document.createElement('div');
    row.className = 'ceba-row';
    row.innerHTML = `<div class="ceba-key">${key}</div><div class="ceba-val">${val}</div>`;
    grid.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════════════════
   4. CERCA A GOOGLE — top 3 paraules per Toxicity Score
════════════════════════════════════════════════════════════════════ */
function verificarGoogle() {
  const text = document.getElementById('msgInput').value.trim();
  if (!text) { flashInput(); return; }

  let topTerms = [];

  if (lastResult && lastResult.detectedKW.length >= 2) {
    const seen = new Set();
    const uniq = lastResult.detectedKW.filter(kw => {
      if (seen.has(kw.word)) return false;
      seen.add(kw.word); return true;
    });
    topTerms = uniq.sort((a, b) => b.score - a.score).slice(0, 3).map(k => k.word);
  }

  // Fallback: 5 paraules més llargues del text
  if (topTerms.length < 2) {
    topTerms = [...new Set(
      text.replace(/[^\w\sàáèéíïòóúüç]/g, ' ').split(/\s+/)
          .map(w => w.trim()).filter(w => w.length >= 5)
    )].sort((a, b) => b.length - a.length).slice(0, 5);
  }

  const sites = 'site:maldita.es OR site:newtral.es OR site:verificat.cat OR site:afpfactual.com';
  const q     = encodeURIComponent(topTerms.join(' ') + ' ' + sites);
  window.open('https://www.google.com/search?q=' + q, '_blank', 'noopener');
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
   7. ANÀLISI PRINCIPAL
════════════════════════════════════════════════════════════════════ */
async function analyze() {
  const input = document.getElementById('msgInput');
  if (!input.value.trim()) { flashInput(); return; }
  if (!DB) { alert('La base de dades encara s\'està carregant. Torna a intentar-ho.'); return; }

  // 1. Neteja total del resultat anterior ABANS de fer res
  clearAll(false);
  showLoading(true);
  await delay(1900);
  showLoading(false);

  // 2. Càlcul
  const text   = input.value.trim();
  const result = calcularFiabilitat(text);
  const to     = analitzarTo(text);

  scanCounter++;
  const scanId = scanCounter;
  const scanTs = new Date().toLocaleTimeString('ca-ES');

  document.getElementById('scanId').textContent = scanId;
  document.getElementById('scanTs').textContent = scanTs;

  // 3. Desa per a l'informe
  lastResult = { ...result, text, to, scanId, scanTs };

  // 4. Pinta (ordre important: gauge → heatmap → variables → context)
  renderGauge(result.score);
  renderHeatmap(result.detectedKW, result.bigramesDetectats, result.verbsDetectats);
  renderVariables(result.det);
  renderContext(result.temaData, to, result.score, result.neutral);

  // 5. Mostra el dashboard
  const dash = document.getElementById('dashboard');
  dash.classList.add('visible');
  setTimeout(() => dash.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}

/* ═══════════════════════════════════════════════════════════════════
   8. INICIALITZACIÓ — carrega data.json via fetch
════════════════════════════════════════════════════════════════════ */
async function init() {
  const statusTxt = document.querySelector('.status-txt');
  const statusDot = document.querySelector('.status-dot');

  if (statusTxt) statusTxt.textContent = 'CARREGANT DB...';
  if (statusDot) statusDot.style.background = '#fbbf24';

  try {
    const resp = await fetch('data.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    DB = await resp.json();

    const total = DB.categories.reduce((acc, c) => acc + c.lexemes.length, 0);
    console.info(`[NEURONA] DB carregada: ${DB.categories.length} categories, ${total} lexemes, ${DB.verbs_atac.length} verbs d'atac, ${DB.bigrames_perill.length} bigrames`);

    if (statusTxt) statusTxt.textContent = 'EN LÍNIA';
    if (statusDot) { statusDot.style.background = '#10d98a'; statusDot.style.boxShadow = '0 0 6px #10d98a'; }
  } catch (err) {
    console.error('[NEURONA] Error carregant data.json:', err);
    if (statusTxt) statusTxt.textContent = 'DB ERROR';
    if (statusDot) { statusDot.style.background = '#f87171'; statusDot.style.boxShadow = '0 0 6px #f87171'; }
    // Alerta no bloquejant
    setTimeout(() => alert(
      'No s\'ha pogut carregar data.json.\n' +
      'Assegura\'t d\'obrir index.html des d\'un servidor web (no des del sistema de fitxers directament).\n\n' +
      'Prova: python3 -m http.server 8000'
    ), 500);
  }
}

/* ── Escolta d'events ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  init();
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') analyze();
  });
});
