/* ═══════════════════════════════════════════════════════════
   Vozen site — main.js
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── config ──────────────────────────────────────────────
     CLIENT_ID é público (está em qualquer link de convite).
     SUPPORT_URL é o convite do servidor de suporte do Vozen. */
  const CLIENT_ID = "1523826014935842997";
  const INVITE_PERMISSIONS = "3230720"; // Connect+Speak+ViewChannel+SendMessages+ReadMessageHistory+EmbedLinks
  const SUPPORT_URL = "https://discord.gg/V6PZYZmhcQ"; // servidor de suporte do Vozen
  const INVITE_URL =
    CLIENT_ID && CLIENT_ID !== "YOUR_CLIENT_ID"
      ? `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`
      : "#";
  const TOPGG_URL =
    CLIENT_ID && CLIENT_ID !== "YOUR_CLIENT_ID" ? `https://top.gg/bot/${CLIENT_ID}/vote` : "#";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── external links ──────────────────────────────────── */
  $$(".js-invite").forEach((a) => {
    a.href = INVITE_URL;
    if (INVITE_URL !== "#") a.target = "_blank";
  });
  $$(".js-support").forEach((a) => {
    a.href = SUPPORT_URL;
    a.target = "_blank";
  });
  $$(".js-vote").forEach((a) => {
    a.href = TOPGG_URL;
    if (TOPGG_URL !== "#") a.target = "_blank";
  });

  /* ── i18n ────────────────────────────────────────────── */
  const DICT = window.VOZEN_I18N;
  // Idioma por defeito: INGLÊS. NÃO fazemos sniffing do navigator (senão um browser PT
  // abria o site em português). Só respeitamos uma escolha EXPLÍCITA (guardada quando o
  // utilizador carrega no toggle EN/PT). Chave nova ("vozen.lang") para ignorar o valor que
  // a versão anterior auto-guardava a partir do navigator — assim toda a gente recomeça em EN.
  const LS_KEY = "vozen.lang";
  let lang = localStorage.getItem(LS_KEY) || "en";

  function applyLang(l) {
    lang = DICT[l] ? l : "en";
    document.documentElement.lang = lang;
    const d = DICT[lang];
    $$("[data-i18n]").forEach((el) => {
      const k = el.getAttribute("data-i18n");
      if (d[k] != null) el.textContent = d[k];
    });
    $$(".lang-toggle button").forEach((b) => b.classList.toggle("is-active", b.dataset.lang === lang));
    renderCommands();
    renderFaq();
  }

  $$(".lang-toggle button").forEach((b) =>
    b.addEventListener("click", () => {
      // Só uma escolha EXPLÍCITA persiste (o default EN não escreve nada).
      localStorage.setItem(LS_KEY, b.dataset.lang);
      applyLang(b.dataset.lang);
    }),
  );

  /* ── navbar ──────────────────────────────────────────── */
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("is-stuck", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const burger = $("#burger");
  const links = $(".nav__links");
  burger.addEventListener("click", () => {
    const open = links.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
  });
  $$(".nav__links a").forEach((a) =>
    a.addEventListener("click", () => {
      links.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    }),
  );

  /* ── reveal on scroll ────────────────────────────────── */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in-view");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  $$(".reveal:not([data-r])").forEach((el) => io.observe(el));

  /* ── animated counters ───────────────────────────────── */
  const counters = $$(".count");
  const cio = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        const el = e.target;
        const to = +el.dataset.to;
        if (reduce) {
          el.textContent = to;
          return;
        }
        const dur = 1100;
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - start) / dur);
          el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    { threshold: 0.5 },
  );
  counters.forEach((c) => cio.observe(c));

  /* ── language marquee ────────────────────────────────── */
  const LANGS = [
    ["🇵🇹", "Português"], ["🇬🇧", "English"], ["🇪🇸", "Español"], ["🇫🇷", "Français"],
    ["🇩🇪", "Deutsch"], ["🇮🇹", "Italiano"], ["🇳🇱", "Nederlands"], ["🇵🇱", "Polski"],
    ["🇷🇺", "Русский"], ["🇺🇦", "Українська"], ["🇹🇷", "Türkçe"], ["🇸🇪", "Svenska"],
    ["🇯🇵", "日本語"], ["🇨🇳", "中文"], ["🇸🇦", "العربية"], ["🇬🇷", "Ελληνικά"],
    ["🇨🇿", "Čeština"], ["🇩🇰", "Dansk"], ["🇫🇮", "Suomi"], ["🇷🇴", "Română"],
    ["🇭🇺", "Magyar"], ["🇻🇳", "Tiếng Việt"], ["🇮🇸", "Íslenska"], ["🇬🇪", "ქართული"],
  ];
  const track = $("#marqueeTrack");
  if (track) {
    const chip = ([f, n]) => `<span class="chip">${f} ${n}</span>`;
    // duplicate the set so the -50% loop is seamless
    track.innerHTML = LANGS.map(chip).join("") + LANGS.map(chip).join("");
  }

  /* ── wordle mock ─────────────────────────────────────── */
  const WORD = [
    [["V", "x"], ["O", "y"], ["I", "x"], ["C", "x"], ["E", "y"]],
    [["S", "x"], ["O", "g"], ["U", "x"], ["N", "x"], ["D", "x"]],
    [["V", "g"], ["O", "g"], ["X", "g"], ["E", "g"], ["L", "g"]],
  ];
  const wordle = $("#wordle");
  if (wordle) {
    wordle.innerHTML = WORD.map(
      (row) =>
        `<div class="wrow">${row
          .map(([ch, s]) => `<span class="wtile ${s}">${ch}</span>`)
          .join("")}</div>`,
    ).join("");
  }

  /* ── commands ────────────────────────────────────────── */
  const cmdList = $("#cmdList");
  let activeTab = "general";
  function renderCommands() {
    if (!cmdList) return;
    const rows = window.VOZEN_COMMANDS[activeTab] || [];
    cmdList.innerHTML = rows
      .map(([cmd, desc]) => `<div class="cmd"><code>${cmd}</code><span>${desc[lang] || desc.en}</span></div>`)
      .join("");
  }
  $$("#cmdTabs button").forEach((b) =>
    b.addEventListener("click", () => {
      activeTab = b.dataset.tab;
      $$("#cmdTabs button").forEach((x) => x.classList.toggle("is-active", x === b));
      renderCommands();
    }),
  );

  /* ── faq ─────────────────────────────────────────────── */
  const faqList = $("#faq-list");
  function renderFaq() {
    if (!faqList) return;
    faqList.innerHTML = window.VOZEN_FAQ.map(
      ([q, a], i) => `
      <div class="qa">
        <button class="qa__q" aria-expanded="false" aria-controls="qa-${i}">
          <span>${q[lang] || q.en}</span>
        </button>
        <div class="qa__a" id="qa-${i}" role="region"><p>${a[lang] || a.en}</p></div>
      </div>`,
    ).join("");
    $$(".qa__q", faqList).forEach((btn) =>
      btn.addEventListener("click", () => {
        const qa = btn.parentElement;
        const panel = qa.querySelector(".qa__a");
        const open = qa.classList.toggle("is-open");
        btn.setAttribute("aria-expanded", String(open));
        panel.style.maxHeight = open ? panel.scrollHeight + "px" : "0";
      }),
    );
  }

  /* ── animated Discord chat mock ──────────────────────── */
  const chat = $("#chat");
  const SCRIPT = [
    { name: "Kai", av: "K", cls: "u", text: "what's the plan tonight?", say: "EN" },
    { name: "Ana", av: "A", cls: "u", text: "boa noite pessoal 🌙", say: "PT" },
    { name: "Léa", av: "L", cls: "u", text: "on lance une partie ? 🎮", say: "FR" },
  ];

  function bubble(m, textHtml, speaking) {
    const el = document.createElement("div");
    el.className = "msg";
    el.innerHTML = `
      <div class="msg__av msg__av--${m.cls}">${m.av}</div>
      <div class="msg__b">
        <div class="msg__name">${m.name}</div>
        <div class="msg__text">${textHtml}</div>
        ${speaking ? `<div class="speaking"><span class="eq"><i></i><i></i><i></i><i></i><i></i></span> Vozen is speaking…</div>` : ""}
      </div>`;
    return el;
  }

  function vozenBubble() {
    const el = document.createElement("div");
    el.className = "msg";
    el.innerHTML = `
      <div class="msg__av msg__av--v"><span class="eq" style="height:16px"><i></i><i></i><i></i><i></i><i></i></span></div>
      <div class="msg__b">
        <div class="msg__name"><b>Vozen</b><span class="tag">APP</span></div>
        <div class="speaking"><span class="eq"><i></i><i></i><i></i><i></i><i></i></span> reading it out loud…</div>
      </div>`;
    return el;
  }

  async function typeInto(node, text) {
    const t = node.querySelector(".msg__text");
    for (let i = 0; i <= text.length; i++) {
      t.innerHTML = text.slice(0, i) + '<span class="cursor"></span>';
      await sleep(38 + Math.random() * 40);
    }
    t.textContent = text;
  }

  async function runChat() {
    if (!chat) return;
    if (reduce) {
      // static: show one exchange, no loop
      chat.appendChild(bubble(SCRIPT[0], SCRIPT[0].text, false));
      chat.appendChild(vozenBubble());
      return;
    }
    let i = 0;
    for (;;) {
      const m = SCRIPT[i % SCRIPT.length];
      chat.innerHTML = "";
      const b = bubble(m, '<span class="cursor"></span>', false);
      chat.appendChild(b);
      await sleep(300);
      await typeInto(b, m.text);
      await sleep(450);
      chat.appendChild(vozenBubble());
      await sleep(2600);
      i++;
    }
  }

  /* ── hero waveform (signature: sound made visible) ───── */
  const wave = $("#wave");
  if (wave && !reduce) {
    const ctx = wave.getContext("2d");
    let W = 0, H = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wave.clientWidth;
      H = wave.clientHeight;
      wave.width = Math.round(W * dpr);
      wave.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    // three neon layers, each a speech-like burst tapered at the edges
    const layers = [
      { amp: 0.52, freq: 1.5, speed: 0.6, col: "rgba(102,114,255,0.85)", lw: 2.6 },
      { amp: 0.36, freq: 2.4, speed: -0.95, col: "rgba(46,230,200,0.8)", lw: 2.1 },
      { amp: 0.22, freq: 3.7, speed: 1.35, col: "rgba(154,164,255,0.55)", lw: 1.5 },
    ];
    let t = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const mid = H / 2;
      for (const L of layers) {
        ctx.beginPath();
        ctx.lineWidth = L.lw;
        ctx.strokeStyle = L.col;
        ctx.shadowBlur = 10;
        ctx.shadowColor = L.col;
        for (let x = 0; x <= W; x += 5) {
          const p = x / W;
          const env = Math.sin(p * Math.PI); // taper to 0 at both ends
          const y =
            mid +
            (Math.sin(p * Math.PI * 2 * L.freq + t * L.speed) * (H * L.amp * 0.5) +
              Math.sin(p * Math.PI * L.freq + t * L.speed * 1.7) * (H * L.amp * 0.22)) *
              env;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      t += 0.028;
      requestAnimationFrame(draw);
    };
    draw();
  }

  /* ── hear (audio demo) ─────────────────────────────────── */
  // Cada amostra: bandeira, nome da lingua e a frase EXATA que foi sintetizada
  // (tem de bater certo com o audio) + o mp3 gerado por tools/gen-samples.mjs.
  const SAMPLES = {
    // engines: motores com clipe para esta lingua. O japones so tem Google (o Piper
    // standard nao tem modelo japones). Google = <lang>.mp3, Piper = <lang>-piper.mp3.
    en: { flag: "🇬🇧", lang: "English", phrase: "Hey! Welcome to the server. Type anything and I'll read it out loud.", engines: ["google", "piper"] },
    pt: { flag: "🇵🇹", lang: "Português", phrase: "Olá! Escreva qualquer coisa e eu leio em voz alta.", engines: ["google", "piper"] },
    es: { flag: "🇪🇸", lang: "Español", phrase: "¡Hola! Escribe lo que quieras y lo leeré en voz alta.", engines: ["google", "piper"] },
    fr: { flag: "🇫🇷", lang: "Français", phrase: "Salut ! Écris ce que tu veux, je le lis à voix haute.", engines: ["google", "piper"] },
    de: { flag: "🇩🇪", lang: "Deutsch", phrase: "Hallo! Schreib irgendwas und ich lese es laut vor.", engines: ["google", "piper"] },
    ja: { flag: "🇯🇵", lang: "日本語", phrase: "こんにちは！メッセージを読み上げます。", engines: ["google"] },
  };

  function initHear() {
    const stage = $("#hearStage");
    const audio = $("#hearAudio");
    const btn = $("#hearBtn");
    if (!stage || !audio || !btn) return;
    const flagEl = $("#hearFlag"),
      langEl = $("#hearLang"),
      phraseEl = $("#hearPhrase"),
      engTag = $("#hearEngTag");
    const ENGINE_NAME = { google: "Google", piper: "Piper" };
    let current = "en";
    let engine = "google";

    const srcFor = (code, eng) => "assets/samples/" + code + (eng === "piper" ? "-piper" : "") + ".mp3";

    const select = (code, autoplay) => {
      const s = SAMPLES[code];
      if (!s) return;
      // Se a lingua nao tem o motor escolhido (ex.: japones sem Piper), toca no Google.
      const eng = s.engines.includes(engine) ? engine : "google";
      current = code;
      flagEl.textContent = s.flag;
      langEl.textContent = s.lang;
      phraseEl.textContent = s.phrase;
      engTag.textContent = ENGINE_NAME[eng];
      $$(".hear__chip").forEach((c) => c.classList.toggle("is-active", c.dataset.sample === code));
      audio.src = srcFor(code, eng); // preload="none" => so descarrega ao dar play
      if (autoplay) audio.play().catch(() => {});
    };

    // Marca como indisponiveis os chips das linguas sem o motor escolhido.
    const refreshChips = () =>
      $$(".hear__chip").forEach((c) => {
        const s = SAMPLES[c.dataset.sample];
        c.classList.toggle("is-disabled", !s || !s.engines.includes(engine));
      });

    // Troca de motor: reavalia os chips e recarrega a lingua atual nesse motor (ou cai
    // numa que o tenha — ex.: japones + Piper -> ingles). Mantem o estado tocar/pausa.
    $$(".hear__eng").forEach((b) =>
      b.addEventListener("click", () => {
        engine = b.dataset.engine;
        $$(".hear__eng").forEach((x) => x.classList.toggle("is-active", x === b));
        refreshChips();
        const playing = !audio.paused;
        select(SAMPLES[current].engines.includes(engine) ? current : "en", playing);
      }),
    );

    // Toca/pausa. is-playing (icone + equalizador) segue os eventos do <audio>, por
    // isso trocar de lingua/motor a meio nunca deixa dois a tocar.
    btn.addEventListener("click", () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
    $$(".hear__chip").forEach((chip) =>
      chip.addEventListener("click", () => select(chip.dataset.sample, true)),
    );
    audio.addEventListener("play", () => {
      stage.classList.add("is-playing");
      btn.setAttribute("aria-pressed", "true");
    });
    const off = () => {
      stage.classList.remove("is-playing");
      btn.setAttribute("aria-pressed", "false");
    };
    audio.addEventListener("pause", off);
    audio.addEventListener("ended", off);

    refreshChips();
    select("en", false); // estado inicial: EN + Google, sem tocar
  }

  /* ── boot ────────────────────────────────────────────── */
  applyLang(lang);
  runChat();
  initHear();
})();
