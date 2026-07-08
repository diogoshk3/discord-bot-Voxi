/* ═══════════════════════════════════════════════════════════
   Vozen site — main.js
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── config ──────────────────────────────────────────────
     CLIENT_ID é público (está em qualquer link de convite).
     SUPPORT_URL é o convite do servidor de suporte do Vozen. */
  const CLIENT_ID = "1523826014935842997";
  const INVITE_PERMISSIONS = "326420745216"; // Connect+Speak+ViewChannel+SendMessages+ReadMessageHistory+EmbedLinks + threads dos jogos (CreatePublicThreads+SendMessagesInThreads+ManageThreads)
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

  // Nome de uma língua NA LÍNGUA DO SITE (segue o botão EN/PT). Via Intl.DisplayNames
  // (dados do browser) — sem tabela à mão. PT devolve minúsculas ("inglês"), por isso
  // capitalizamos a 1.ª letra. Falha do ICU -> código em maiúsculas.
  const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  function hearLangName(code, siteLang) {
    try {
      return capFirst(new Intl.DisplayNames([siteLang, "en"], { type: "language" }).of(code));
    } catch {
      return code.toUpperCase();
    }
  }
  // Reescreve as labels dos chips do "Hear it" (e o nome no cartão) na língua do site.
  function localizeHear(siteLang) {
    $$(".hear__chip").forEach((c) => {
      const nameEl = c.querySelector(".hear__chip-name");
      if (nameEl) nameEl.textContent = hearLangName(c.dataset.sample, siteLang);
    });
    const active = document.querySelector(".hear__chip.is-active");
    const langEl = document.getElementById("hearLang");
    if (active && langEl) langEl.textContent = hearLangName(active.dataset.sample, siteLang);
  }

  // As 10 línguas do seletor: [código, bandeira, autónimo (nome na própria língua)].
  // Sem RTL — todas usam layout normal LTR (o texto árabe alinha à esquerda; o bidi do
  // Unicode continua a renderizar os caracteres na direção certa dentro da linha).
  const LANG_UI = [
    ["en", "🇬🇧", "English"],
    ["pt", "🇵🇹", "Português"],
    ["fr", "🇫🇷", "Français"],
    ["es", "🇪🇸", "Español"],
    ["de", "🇩🇪", "Deutsch"],
    ["tr", "🇹🇷", "Türkçe"],
    ["ar", "🇸🇦", "العربية"],
    ["zh", "🇹🇼", "繁體中文"],
    ["ru", "🇷🇺", "Русский"],
    ["ko", "🇰🇷", "한국어"],
  ];
  const LANG_META = Object.fromEntries(LANG_UI.map(([c, flag, name]) => [c, { flag, name }]));

  // Sincroniza o dropdown custom com a língua ativa: trigger (bandeira+nome) e o item ativo.
  function syncLangMenu(code) {
    const m = LANG_META[code];
    if (!m) return;
    const bf = $("#langBtnFlag"),
      bn = $("#langBtnName");
    if (bf) bf.textContent = m.flag;
    if (bn) bn.textContent = m.name;
    $$(".lang__opt").forEach((o) => {
      const on = o.dataset.lang === code;
      o.classList.toggle("is-active", on);
      o.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function applyLang(l) {
    lang = DICT[l] ? l : "en";
    document.documentElement.lang = lang;
    const d = DICT[lang];
    $$("[data-i18n]").forEach((el) => {
      const k = el.getAttribute("data-i18n");
      if (d[k] != null) el.textContent = d[k];
    });
    syncLangMenu(lang);
    localizeHear(lang);
    renderCommands();
    renderFaq();
  }

  // Dropdown custom de idioma (estilo MEE6): botão-trigger + painel role="listbox".
  // Nativo <select> não mostra bandeiras (o <option> é desenhado pelo SO), daí o custom.
  function buildLangMenu() {
    const menu = $("#langMenu"),
      btn = $("#langBtn"),
      panel = $("#langPanel");
    if (!menu || !btn || !panel) return;
    panel.innerHTML = LANG_UI.map(
      ([code, flag, name]) =>
        `<li class="lang__opt" role="option" data-lang="${code}" aria-selected="false" tabindex="-1">` +
        `<span class="lang__flag">${flag}</span><span class="lang__optname">${name}</span>` +
        `<svg class="lang__check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg></li>`,
    ).join("");
    const opts = $$(".lang__opt", panel);
    const isOpen = () => menu.classList.contains("is-open");
    const open = () => {
      menu.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      const cur = panel.querySelector('[aria-selected="true"]') || opts[0];
      if (cur) cur.focus();
    };
    const close = (focusBtn) => {
      menu.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      if (focusBtn) btn.focus();
    };
    const choose = (code) => {
      localStorage.setItem(LS_KEY, code); // escolha explícita persiste
      applyLang(code);
    };
    btn.addEventListener("click", () => (isOpen() ? close(false) : open()));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    opts.forEach((o, i) => {
      o.addEventListener("click", () => {
        choose(o.dataset.lang);
        close(true);
      });
      o.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose(o.dataset.lang);
          close(true);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          (opts[i + 1] || opts[0]).focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          (opts[i - 1] || opts[opts.length - 1]).focus();
        } else if (e.key === "Home") {
          e.preventDefault();
          opts[0].focus();
        } else if (e.key === "End") {
          e.preventDefault();
          opts[opts.length - 1].focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          close(true);
        }
      });
    });
    // clique fora fecha
    document.addEventListener("click", (e) => {
      if (isOpen() && !menu.contains(e.target)) close(false);
    });
  }
  buildLangMenu();

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
  // Vitrina de línguas (marquee): cada uma NA SUA PRÓPRIA LÍNGUA (autónimo). ~35, a par
  // do "35 languages" anunciado no site. É só showcase — não é a lista funcional do bot.
  const LANGS = [
    ["🇬🇧", "English"], ["🇵🇹", "Português"], ["🇪🇸", "Español"], ["🇫🇷", "Français"],
    ["🇩🇪", "Deutsch"], ["🇮🇹", "Italiano"], ["🇳🇱", "Nederlands"], ["🇵🇱", "Polski"],
    ["🇷🇺", "Русский"], ["🇺🇦", "Українська"], ["🇹🇷", "Türkçe"], ["🇸🇪", "Svenska"],
    ["🇯🇵", "日本語"], ["🇰🇷", "한국어"], ["🇨🇳", "中文"], ["🇸🇦", "العربية"],
    ["🇬🇷", "Ελληνικά"], ["🇨🇿", "Čeština"], ["🇩🇰", "Dansk"], ["🇫🇮", "Suomi"],
    ["🇷🇴", "Română"], ["🇭🇺", "Magyar"], ["🇻🇳", "Tiếng Việt"], ["🇮🇸", "Íslenska"],
    ["🇬🇪", "ქართული"], ["🇮🇷", "فارسی"], ["🇮🇳", "हिन्दी"], ["🇹🇭", "ไทย"],
    ["🇮🇩", "Bahasa Indonesia"], ["🇷🇸", "Српски"], ["🇸🇰", "Slovenčina"], ["🇸🇮", "Slovenščina"],
    ["🇱🇻", "Latviešu"], ["🇰🇿", "Қазақ тілі"], ["🇧🇬", "Български"],
  ];
  const track = $("#marqueeTrack");
  if (track) {
    const chip = ([f, n]) => `<span class="chip">${f} ${n}</span>`;
    // duplicate the set so the -50% loop is seamless
    track.innerHTML = LANGS.map(chip).join("") + LANGS.map(chip).join("");
  }

  /* ── wordle mock ─────────────────────────────────────── */
  // Solve to VOZEN: VOICE (V,O green) → TOKEN (O,E,N green) → VOZEN (all green).
  const WORD = [
    [["V", "g"], ["O", "g"], ["I", "x"], ["C", "x"], ["E", "y"]],
    [["T", "x"], ["O", "g"], ["K", "x"], ["E", "g"], ["N", "g"]],
    [["V", "g"], ["O", "g"], ["Z", "g"], ["E", "g"], ["N", "g"]],
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
    // SÓ línguas audíveis nos 3 motores (Google + Piper + Kokoro) — cada uma tem clipe
    // em todos, por isso NENHUM chip fica desativado. de saiu (sem voz Kokoro) e ja saiu
    // (Kokoro partido + sem Piper). Ver plano 018. Ficheiros: <lang>.mp3 (Google),
    // <lang>-piper.mp3 (Piper), <lang>-kokoro.mp3 (Kokoro).
    en: { flag: "🇬🇧", lang: "English", phrase: "Hey! Welcome to the server. Type anything and I'll read it out loud.", engines: ["google", "piper", "kokoro"] },
    pt: { flag: "🇵🇹", lang: "Português", phrase: "Olá! Escreva qualquer coisa e eu leio em voz alta.", engines: ["google", "piper", "kokoro"] },
    es: { flag: "🇪🇸", lang: "Español", phrase: "¡Hola! Escribe lo que quieras y lo leeré en voz alta.", engines: ["google", "piper", "kokoro"] },
    fr: { flag: "🇫🇷", lang: "Français", phrase: "Salut ! Écris ce que tu veux, je le lis à voix haute.", engines: ["google", "piper", "kokoro"] },
    it: { flag: "🇮🇹", lang: "Italiano", phrase: "Ciao! Scrivi quello che vuoi e lo leggerò ad alta voce.", engines: ["google", "piper", "kokoro"] },
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
    const ENGINE_NAME = { google: "Google", piper: "Piper", kokoro: "Kokoro" };
    let current = "en";
    let engine = "google";

    const ENGINE_SUFFIX = { google: "", piper: "-piper", kokoro: "-kokoro" };
    const srcFor = (code, eng) => "assets/samples/" + code + (ENGINE_SUFFIX[eng] || "") + ".mp3";

    const select = (code, autoplay) => {
      const s = SAMPLES[code];
      if (!s) return;
      // Se a lingua nao tem o motor escolhido (ex.: japones sem Piper), toca no Google.
      const eng = s.engines.includes(engine) ? engine : "google";
      current = code;
      flagEl.textContent = s.flag;
      langEl.textContent = hearLangName(code, lang); // nome na língua do site (segue EN/PT)
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
