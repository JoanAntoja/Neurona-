<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>NEURONA · Sistema d'Anàlisi Forense v6.1</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Exo+2:ital,wght@0,300;0,400;0,600;0,700;1,300&family=Share+Tech+Mono&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
<div class="app">

  <!-- ════ HEADER ════════════════════════════════════════════ -->
  <header class="header">
    <div class="header__row">
      <div class="header__brand">
        <div class="logo">🧠</div>
        <div>
          <div class="brand-name">NEURONA</div>
          <div class="brand-sub">WEIGHTED MATRIX ANALYSIS ENGINE v6.1</div>
        </div>
      </div>
      <div class="status-row">
        <div class="status-dot"></div>
        <span class="status-txt">CARREGANT...</span>
        <span class="ver-badge">v6.1</span>
      </div>
    </div>
  </header>

  <!-- ════ LOADING OVERLAY (full-screen) ═════════════════════ -->
  <div id="loadingOverlay">
    <div class="loading-box">
      <div class="loading-title">ANALITZANT...</div>
      <div class="scan-line s1">
        <div class="scan-dot"></div>
        <span style="width:150px">Anàlisi local...</span>
        <div class="scan-bar-wrap"><div class="scan-bar" id="sb1"></div></div>
      </div>
      <div class="scan-line s2">
        <div class="scan-dot"></div>
        <span style="width:150px">Detectant patrons...</span>
        <div class="scan-bar-wrap"><div class="scan-bar" id="sb2"></div></div>
      </div>
      <div class="scan-line s3">
        <div class="scan-dot"></div>
        <span style="width:150px">IA externa (si cal)...</span>
        <div class="scan-bar-wrap"><div class="scan-bar" id="sb3"></div></div>
      </div>
      <div class="scan-line s4">
        <div class="scan-dot"></div>
        <span style="width:150px">Computant resultat...</span>
        <div class="scan-bar-wrap"><div class="scan-bar" id="sb4"></div></div>
      </div>
    </div>
  </div>

  <!-- ════ MAIN ═══════════════════════════════════════════════ -->
  <main class="main">

    <!-- Textarea input -->
    <div class="inp-block">
      <div class="sec-label">INPUT / Missatge a analitzar</div>
      <div class="ta-wrap">
        <textarea
          id="msgInput"
          maxlength="3000"
          placeholder="Enganxa aquí el missatge sospitós per iniciar l'anàlisi de matriu de pesos..."
          oninput="updateCount(this)"
          aria-label="Missatge a analitzar"
        ></textarea>
        <div class="ta-bar">
          <span class="char-ct" id="charCount">0 / 3000</span>
          <span class="kbd-hint"><kbd>⌘</kbd>+<kbd>↵</kbd></span>
        </div>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="btn-row">
      <button class="btn-analyze" id="btnAnalyze" onclick="analyze()">
        <span class="btn-ico">⬡</span>
        <span class="btn-lbl">INICIAR ANÀLISI</span>
        <div class="spinner"></div>
      </button>
      <button class="btn-clear" onclick="clearAll(true)">NETEJAR</button>
    </div>

    <!-- ════ DASHBOARD ═══════════════════════════════════════ -->
    <div class="dashboard" id="dashboard">

      <!-- Scan header -->
      <div class="scan-hdr">
        <span class="scan-id">SCAN #<span id="scanId">0000</span></span>
        <span class="scan-ts" id="scanTs">--:--:--</span>
      </div>

      <!-- Gauge: Índex de Fiabilitat -->
      <div class="gauge-panel">
        <div class="gauge-label-top">ÍNDEX DE FIABILITAT</div>
        <svg class="gauge-svg" viewBox="0 0 300 165" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <!-- Track fosc (fons) — única barra de fons -->
          <path d="M 30,140 A 120,120 0 0 1 270,140" stroke="#1a1f30" stroke-width="14" stroke-linecap="round" fill="none"/>
          <!-- Arc de resultat (JS controla color i longitud) -->
          <path id="gaugeFill"
            d="M 30,140 A 120,120 0 0 1 270,140"
            stroke="#22d3ee" stroke-width="14" stroke-linecap="round" fill="none"
            stroke-dasharray="376.99" stroke-dashoffset="376.99"
            style="transition: stroke-dashoffset 1s cubic-bezier(.4,0,.2,1), stroke .5s ease"/>
          <!-- Ticks dels extrems -->
          <line x1="26"  y1="140" x2="18"  y2="140" stroke="#2e3650" stroke-width="1.5"/>
          <line x1="274" y1="140" x2="282" y2="140" stroke="#2e3650" stroke-width="1.5"/>
          <!-- Agulla (JS controla posició) -->
          <line id="gaugeNeedle"
            x1="150" y1="140" x2="60" y2="140"
            stroke="#c8d0e8" stroke-width="2" stroke-linecap="round"
            style="transform-origin: 150px 140px; transition: all 1s cubic-bezier(.4,0,.2,1)"/>
          <!-- Punt central -->
          <circle cx="150" cy="140" r="5" fill="#0f1320" stroke="#22d3ee" stroke-width="1.5"/>
          <!-- Etiquetes numèriques -->
          <text x="22"  y="157" font-family="Share Tech Mono" font-size="9" fill="#3d4560">0</text>
          <text x="268" y="157" font-family="Share Tech Mono" font-size="9" fill="#3d4560">100</text>
          <text x="84"  y="27"  font-family="Share Tech Mono" font-size="9" fill="#3d4560">30</text>
          <text x="203" y="27"  font-family="Share Tech Mono" font-size="9" fill="#3d4560">70</text>
        </svg>
        <div class="gauge-score-wrap">
          <span class="score-val" id="scoreVal" style="color:var(--cyan)">--</span>
          <span class="score-unit">/100</span>
        </div>
        <div class="gauge-verdict" id="gaugeVerdict"></div>
        <div class="gauge-zones">
          <span class="zone-pill z-red">0–30 · BULO PROBABLE</span>
          <span class="zone-pill z-amber">31–70 · VERIFICAR</span>
          <span class="zone-pill z-green">71–100 · FIABLE</span>
        </div>
      </div>

      <!-- Mapa de Calor -->
      <div class="panel">
        <div class="panel-hdr">
          <span class="panel-ico">🔥</span>
          <span class="panel-title">Mapa de Calor · Paraules Clau Detectades</span>
          <span class="panel-count" id="heatCount">0</span>
        </div>
        <div class="panel-body" id="heatBody"></div>
      </div>

      <!-- Variables Estructurals -->
      <div class="panel">
        <div class="panel-hdr">
          <span class="panel-ico">⬡</span>
          <span class="panel-title">Variables Estructurals</span>
          <span class="panel-count" id="varCount">0</span>
        </div>
        <div class="panel-body">
          <div id="varList"></div>
        </div>
      </div>

      <!-- Anàlisi de Context -->
      <div class="panel">
        <div class="panel-hdr">
          <span class="panel-ico">◎</span>
          <span class="panel-title">ANÀLISI DE CONTEXT</span>
        </div>
        <div class="panel-body">
          <div class="ceba-grid" id="cebaGrid"></div>
        </div>
      </div>

      <!-- Verificar a Google -->
      <button class="btn-verify" onclick="verificarGoogle()">
        <div>🔍 VERIFICAR · 3 CERQUES SIMULTÀNIES</div>
        <div class="verify-sites">Google News · Fact-checkers · Google General</div>
      </button>

      <!-- Descarregar Informe -->
      <button class="btn-download" onclick="descarregarInforme()">
        📥 DESCARREGAR INFORME FORENSE (.html)
      </button>

      <!-- Anàlisi Profunda amb Claude -->
      <button class="btn-claude" onclick="analisiProfunda()">
        <div>🧠 ANÀLISI PROFUNDA AMB IA</div>
        <div class="btn-claude-sub">Obre Claude·ai amb un prompt preparat · Gratuït</div>
      </button>

    </div><!-- /dashboard -->

  </main>

  <footer class="footer">
    <div class="footer-txt">
      NEURONA v6.1 · WEIGHTED MATRIX ENGINE · ANÀLISI 100% LOCAL · CAP DADA S'ENVIA A SERVIDORS EXTERNS
    </div>
  </footer>

</div><!-- /app -->

<script src="script.js"></script>
</body>
</html>
