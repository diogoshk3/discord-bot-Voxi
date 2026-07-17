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
  // Painel Premium: base HTTPS da API do bot (GET /api/me/premium). VAZIO => o painel fica
  // escondido (a feature ainda não está no ar). Preenche com o teu host quando tiveres o
  // domínio/túnel + PREMIUM_API_ENABLED=true no bot. Ex.: "https://api.vozen.xyz".
  const PREMIUM_API_BASE = "https://api.vozen.org";
  const INVITE_URL =
    CLIENT_ID && CLIENT_ID !== "YOUR_CLIENT_ID"
      ? `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`
      : "#";
  const TOPGG_URL =
    CLIENT_ID && CLIENT_ID !== "YOUR_CLIENT_ID" ? `https://top.gg/bot/${CLIENT_ID}/vote` : "#";

  // Forma do Ref de encomenda do Ko-fi, como aparece no recibo por email: `Ref: S-M1X823C9FW`.
  // Nao e um codigo que possamos aceitar — o webhook do Ko-fi nao envia este campo — mas e a unica
  // coisa com ar de codigo no email, por isso e o que a pessoa cola. Reconhece-se para a mandar
  // para a ajuda em vez de um 404 seco. Nao ha risco de apanhar um tx id verdadeiro: esses sao
  // UUIDs, e nenhum UUID comeca por "S-".
  const REF_RE = /^S-[A-Za-z0-9]{6,16}$/;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Página dedicada da conta (account.html). Só aí o painel Premium é o conteúdo
  // principal — e mostra o estado "em breve" enquanto o backend não está no ar.
  const IS_ACCOUNT = document.body.classList.contains("page-account");

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
    renderPanel(); // re-renderiza o painel Premium na língua atual (sem novo fetch)
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

  /* ── toggle Mês/Ano dos preços ───────────────────────── */
  // Só troca o que se vê (classe .is-annual na grelha); os spans .amt/.per fazem o resto.
  const pricingGrid = $(".pricing");
  $$(".bill-toggle__btn").forEach((b) =>
    b.addEventListener("click", () => {
      const annual = b.dataset.bill === "year";
      if (pricingGrid) pricingGrid.classList.toggle("is-annual", annual);
      $$(".bill-toggle__btn").forEach((x) => x.classList.toggle("is-active", x === b));
      syncKofiLinks();
    }),
  );

  /* ── toggle 3/10 servidores (só no cartão Premium) ────── */
  // Mesma tier, muda o nº de licenças e o preço. Como o bill-toggle: só troca uma classe
  // (.is-10 no cartão); o CSS mostra o combo certo (preço/período/riscado/deal/nota).
  const proCard = $(".price-card--pro");
  $$(".seat-toggle__btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (proCard) proCard.classList.toggle("is-10", b.dataset.seats === "10");
      $$(".seat-toggle__btn").forEach((x) => x.classList.toggle("is-active", x === b));
      syncKofiLinks();
    }),
  );

  /* ── link de compra do Ko-fi por estado dos toggles ───────
     As memberships do Ko-fi só cobram ao MES, por isso os passes anuais sao produtos da
     Shop, cada um com o seu link proprio. Os toggles acima so trocam uma classe e deixam o
     CSS mostrar o preco certo — mas um href nao e algo que o CSS mude. Sem isto, quem
     escolhe "anual" ve €18.99 e aterra na pagina generica, onde esse produto nao existe.
     Os codigos tem de bater certo com o KOFI_SHOP_MAP do bot: e o direct_link_code que diz
     ao webhook o que foi comprado (o Ko-fi nao envia o nome do produto). */
  const KOFI_PAGE = "https://ko-fi.com/rexy00";
  const KOFI_ANNUAL_PLUS = "https://ko-fi.com/s/e1a8ba4ca5";
  const KOFI_ANNUAL_PRO_3 = "https://ko-fi.com/s/64240758ef";
  const KOFI_ANNUAL_PRO_8 = "https://ko-fi.com/s/8f72543ad0";
  const plusBuy = $(".price-card__buy.js-kofi:not(.price-card__buy--pro)");
  const proBuy = $(".price-card__buy--pro");
  function syncKofiLinks() {
    const annual = !!pricingGrid && pricingGrid.classList.contains("is-annual");
    if (plusBuy) plusBuy.href = annual ? KOFI_ANNUAL_PLUS : KOFI_PAGE;
    if (proBuy) {
      const eight = !!proCard && proCard.classList.contains("is-10");
      proBuy.href = !annual ? KOFI_PAGE : eight ? KOFI_ANNUAL_PRO_8 : KOFI_ANNUAL_PRO_3;
    }
  }
  syncKofiLinks();

  /* ── Painel Premium (login com Discord + estado da conta) ─────────────
     OAuth2 implicit (scope identify): 100% client-side, sem segredo. O token vem no
     fragment (#access_token), guardamo-lo em sessionStorage, limpamos o fragment, e
     chamamos GET {API_BASE}/api/me/premium. A API valida o token na Discord e devolve só
     o estado DESTE utilizador. Escondido enquanto PREMIUM_API_BASE estiver vazio. */
  const TOK_KEY = "vozen.dtoken";
  const STATE_KEY = "vozen.oauthstate";
  const NAV_USER_KEY = "vozen.navuser";
  const OAUTH_REDIRECT = new URL("/account", location.href).href;
  let panelState = { mode: "hidden" };

  const t = (k) => (DICT[lang] && DICT[lang][k]) || (DICT.en && DICT.en[k]) || k;
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const fmtDate = (ts) => {
    try {
      return new Date(ts).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return new Date(ts).toISOString().slice(0, 10);
    }
  };
  const DISCORD_MARK =
    '<svg viewBox="0 0 24 18" width="20" height="15" aria-hidden="true" fill="currentColor"><path d="M20.3 1.6A19.8 19.8 0 0 0 15.4.1a14 14 0 0 0-.6 1.3 18.3 18.3 0 0 0-5.5 0A13 13 0 0 0 8.6.1 19.7 19.7 0 0 0 3.7 1.6C.6 6.3-.3 10.8.2 15.3a19.9 19.9 0 0 0 6 3 14.7 14.7 0 0 0 1.3-2.1 12.9 12.9 0 0 1-2-1c.2-.1.3-.3.5-.4a14.2 14.2 0 0 0 12 0l.5.4a12.8 12.8 0 0 1-2 1 14.5 14.5 0 0 0 1.3 2.1 19.8 19.8 0 0 0 6-3c.6-5.2-.8-9.7-3.5-13.7ZM8 12.6c-1.2 0-2.1-1.1-2.1-2.4S6.8 7.8 8 7.8s2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/></svg>';

  function storedToken() {
    try {
      return sessionStorage.getItem(TOK_KEY);
    } catch {
      return null;
    }
  }

  function cachedNavData() {
    if (!storedToken()) return null;
    try {
      const data = JSON.parse(sessionStorage.getItem(NAV_USER_KEY) || "null");
      return data && data.user ? data : null;
    } catch {
      return null;
    }
  }

  function cacheNavData(data) {
    try {
      if (data && data.user) {
        sessionStorage.setItem(NAV_USER_KEY, JSON.stringify({ user: data.user }));
      } else {
        sessionStorage.removeItem(NAV_USER_KEY);
      }
    } catch {}
  }

  function navDataForState(s = panelState) {
    return s.mode === "ok" ? s.data : cachedNavData();
  }

  function unlockAccountPage() {
    if (IS_ACCOUNT) document.body.classList.add("is-account-ready");
  }

  function randState() {
    const a = new Uint8Array(16);
    const c = window.crypto || window.msCrypto;
    // Fail-closed: sem CSPRNG não geramos um `state` fraco/previsível (seria um oráculo
    // de CSRF no OAuth). Abortamos o login — todos os browsers modernos têm crypto.
    if (!c || typeof c.getRandomValues !== "function") {
      throw new Error("secure-random-unavailable");
    }
    c.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function login() {
    let state;
    try {
      state = randState();
    } catch {
      alert("Your browser can't generate a secure login token. Please update it and try again.");
      return;
    }
    try {
      sessionStorage.setItem(STATE_KEY, state);
    } catch {}
    const u = new URL("https://discord.com/oauth2/authorize");
    u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("redirect_uri", OAUTH_REDIRECT);
    u.searchParams.set("response_type", "token");
    u.searchParams.set("scope", "identify");
    u.searchParams.set("state", state);
    location.href = u.toString();
  }

  function logout() {
    try {
      sessionStorage.removeItem(TOK_KEY);
      sessionStorage.removeItem(NAV_USER_KEY);
    } catch {}
    if (IS_ACCOUNT) {
      window.location.href = "/";
      return;
    }
    setPanel({ mode: "anon" });
  }

  // Lê o token do fragment no regresso do OAuth, valida o `state` (CSRF) e LIMPA o fragment.
  function readTokenFromHash() {
    if (!location.hash || location.hash.length < 2) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    const tok = p.get("access_token");
    if (!tok) return null;
    const st = p.get("state");
    let expected = null;
    try {
      expected = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY);
    } catch {}
    history.replaceState(null, "", location.pathname + location.search); // fragment fora do URL
    // CSRF: exige um `state` guardado que bata certo. Sem ele (ou diferente) => descarta o
    // token — nunca aceitamos um fragment que não conseguimos verificar como nosso.
    if (!expected || st !== expected) return null;
    return tok;
  }

  function setPanel(s) {
    if (s.mode === "ok") cacheNavData(s.data);
    if (s.mode === "anon" || (s.mode === "hidden" && !storedToken())) cacheNavData(null);
    panelState = s;
    renderNavLogin(navDataForState(s));
    renderPanel();
  }

  async function loadPanel() {
    if (!PREMIUM_API_BASE) {
      // Backend ainda não está no ar: na página da conta mostramos "em breve"
      // (nunca disparamos o OAuth, senão o redirect não registado dava erro no
      // Discord); nas outras páginas o painel fica escondido.
      setPanel(IS_ACCOUNT ? { mode: "soon" } : { mode: "hidden" });
      return;
    }
    const fromHash = readTokenFromHash();
    if (fromHash) {
      try {
        sessionStorage.setItem(TOK_KEY, fromHash);
      } catch {}
      // Bounce de regresso: o /dashboard reutiliza o redirect /account (o único registado no
      // portal) para o OAuth com scope `guilds`. O token fica no sessionStorage (mesmo
      // domínio), e saltamos de volta. Só caminhos internos (anti open-redirect).
      let rt = null;
      try {
        rt = sessionStorage.getItem("vozen.returnTo");
        sessionStorage.removeItem("vozen.returnTo");
      } catch {}
      // `^\/[^/]` (not just `^\/`): a leading "//" is protocol-relative, so "//evil"
      // would navigate OFF-SITE. Not reachable today (only our own code writes this key,
      // always "/dashboard") and the charset already rejects dots, so no real host could
      // be named — but this is the check that stops it becoming an open redirect the day
      // returnTo ever comes from somewhere less trusted.
      if (rt && /^\/[A-Za-z0-9_-][A-Za-z0-9/_-]*$/.test(rt)) {
        location.replace(rt);
        return;
      }
    }
    const tok = storedToken();
    if (!tok) {
      if (IS_ACCOUNT) {
        login();
        return;
      }
      setPanel({ mode: "hidden" });
      return;
    }
    setPanel({ mode: "loading" });
    try {
      const res = await fetch(PREMIUM_API_BASE + "/api/me/premium", {
        headers: { Authorization: "Bearer " + tok },
      });
      if (res.status === 401) {
        try {
          sessionStorage.removeItem(TOK_KEY);
          sessionStorage.removeItem(NAV_USER_KEY);
        } catch {}
        if (IS_ACCOUNT) {
          login();
          return;
        }
        setPanel({ mode: "anon" });
        return;
      }
      if (!res.ok) throw new Error("http " + res.status);
      setPanel({ mode: "ok", data: await res.json() });
    } catch {
      setPanel({ mode: "error" });
    }
  }

  function avatarMarkup(u, cls, size) {
    const initial = esc((u.username || "?").slice(0, 1).toUpperCase());
    if (u.id && u.avatar) {
      const ext = String(u.avatar).startsWith("a_") ? "gif" : "png";
      return `<img class="${cls}" src="https://cdn.discordapp.com/avatars/${esc(u.id)}/${esc(u.avatar)}.${ext}?size=${size}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`;
    }
    return `<span class="${cls} ${cls}--none">${initial}</span>`;
  }

  function statusRow(label, active, detail) {
    const state = active ? "is-on" : "is-off";
    const text = active ? "Active" : "Inactive";
    const mark = active ? "&#10003;" : "&#10005;";
    const action = active
      ? ""
      : `<a class="ppanel__get" href="/#premium">${t("nav.premium")} <span aria-hidden="true">→</span></a>`;
    return (
      `<div class="ppanel__status ${state}">` +
      `<span>${esc(label)}</span><b class="ppanel__mark ${state}" aria-label="${text}">${mark}</b>` +
      (detail ? `<small>${detail}</small>` : "") +
      action +
      `</div>`
    );
  }

  function renderNavLogin(data) {
    const btn = document.getElementById("navLogin");
    if (!btn) return;
    const u = data && data.user ? data.user : null;
    if (!u) {
      btn.classList.remove("nav__login--account");
      btn.removeAttribute("aria-label");
      btn.innerHTML = `${DISCORD_MARK}<span data-i18n="nav.login">${t("nav.login")}</span>`;
      return;
    }
    btn.classList.add("nav__login--account");
    btn.setAttribute("aria-label", `Discord account: ${u.username || "user"}`);
    btn.innerHTML = `${avatarMarkup(u, "nav__login-av", 24)}<span>${esc(u.username || "Account")}</span>`;
  }

  // Card "Ativar uma compra": o comprador cola o código do recibo Ko-fi e reclama a compra
  // que chegou sem Discord ID (o checkout de subscrição não tem caixa de mensagem). POST
  // autenticado a /api/link — ver doClaim. Aparece sempre que a pessoa está logada.
  function claimCard() {
    return (
      `<div class="ppanel__claim">` +
      `<span class="ppanel__claimtitle">${t("claim.title")}</span>` +
      `<p class="ppanel__claimhint">${t("claim.hint")}</p>` +
      `<form class="ppanel__claimform" id="ppClaimForm">` +
      `<input type="text" id="ppClaimCode" class="ppanel__claiminput" placeholder="${esc(t("claim.placeholder"))}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120">` +
      `<button type="submit" class="ppanel__claimbtn" id="ppClaimBtn">${t("claim.btn")}</button>` +
      `</form>` +
      // Consentimento afirmativo antes da entrega. A checkbox e OBRIGATORIA: ninguem ativa o passe
      // sem aceitar os termos (guardado abaixo por !consent.checked). A entrega acontece AQUI, no
      // momento da ativacao, nao no checkout do Ko-fi — por isso e aqui que a caixa tem de estar,
      // antes do POST /api/link. O quando fica registado em kofi_pending.claimed_at.
      // A renuncia dos 14 dias (dir. 2011/83/UE art. 16(m)) vive DENTRO dos /terms que a pessoa
      // aceita aqui: ativar o passe = pedir a entrega imediata e reconhecer que por isso se perde
      // o direito de retratacao (clausula concreta nos termos). A linha fica limpa; a renuncia esta
      // nos termos aceites, nao na cara do comprador.
      // {terms} no texto de claim.consent marca onde entra o link — substituido por um <a> para
      // /terms. O <a> e conteudo interativo: clicar nele abre os termos sem marcar a checkbox
      // (comportamento do <label> no HTML) — confirmado no browser.
      `<label class="ppanel__claimconsent"><input type="checkbox" id="ppClaimConsent"> <span>${t("claim.consent").replace("{terms}", `<a href="/terms" target="_blank" rel="noopener">${t("claim.consentTerms")}</a>`)}</span></label>` +
      `<p class="ppanel__claimmsg" id="ppClaimMsg" role="status" aria-live="polite" hidden></p>` +
      // Sits AFTER the status message on purpose: "no purchase found" is the moment someone
      // realises they no longer have the receipt, and the way out should be the next thing they
      // read. Closing the receipt tab was never a dead end — Ko-fi emails every buyer a copy —
      // but the card never said so, which made it one in practice.
      `<p class="ppanel__claimlost">${t("claim.lost")} <button type="button" class="ppanel__claimlostbtn" id="ppClaimHelpOpen">${t("claim.lostHelp")}</button></p>` +
      `</div>`
    );
  }

  // Modal de ajuda (plano 036). Existe por causa de uma armadilha do recibo do Ko-fi: o email
  // mostra `Ref: S-M1X823C9FW` — a unica coisa com ar de codigo no email inteiro — e o Ref NUNCA
  // pode activar nada, porque o webhook do Ko-fi nao no-lo envia. Quem procura um codigo encontra
  // aquilo, cola na caixa de cima, e leva um 404 seco por uma compra que fez mesmo.
  //
  // Passo 1 leva ao caminho que ACTIVA (o botao do email -> endereco da pagina -> caixa de cima).
  // Passo 2 pede o EMAIL que a pessoa usou no Ko-fi — nao o Ref. Porque? A pesquisa de transacoes
  // do Ko-fi so casa por nome ou email (confirmado no painel real, 2026-07-17); o Ref nao e
  // procuravel. Um clique manda (Discord ID, email) para o dono, que cola o email na pesquisa do
  // Ko-fi, confirma a encomenda paga e faz o grant. O email e pista de procura, nao prova (plano
  // 021 continua de pe). O suporte fica no rodape, um passo mais dentro.
  //
  // O href do suporte vai inline e nao por class="js-support": essa ligacao corre UMA vez sobre o
  // documento no arranque e isto e injectado depois do OAuth — sairia sem href nenhum.
  function claimHelpModal() {
    return (
      `<div class="ppmodal" id="ppClaimHelp" hidden>` +
      `<div class="ppmodal__backdrop" id="ppClaimHelpBackdrop"></div>` +
      `<div class="ppmodal__box" role="dialog" aria-modal="true" aria-labelledby="ppClaimHelpTitle" tabindex="-1" id="ppClaimHelpBox">` +
      `<button type="button" class="ppmodal__x" id="ppClaimHelpClose" aria-label="${esc(t("claim.help.close"))}">&times;</button>` +
      `<h2 class="ppmodal__title" id="ppClaimHelpTitle">${t("claim.help.title")}</h2>` +
      `<p class="ppmodal__step"><span class="ppmodal__num">1</span> ${t("claim.help.step1")}</p>` +
      `<p class="ppmodal__step"><span class="ppmodal__num">2</span> ${t("claim.help.step2")}</p>` +
      `<form class="ppanel__claimform" id="ppClaimHelpForm">` +
      `<input type="email" id="ppClaimHelpEmail" class="ppanel__claiminput" placeholder="${esc(t("claim.help.emailPlaceholder"))}" autocomplete="email" autocapitalize="off" inputmode="email" spellcheck="false" maxlength="254">` +
      `<button type="submit" class="ppanel__claimbtn" id="ppClaimHelpSend">${t("claim.help.send")}</button>` +
      `</form>` +
      `<p class="ppanel__claimmsg" id="ppClaimHelpMsg" role="status" aria-live="polite" hidden></p>` +
      `<p class="ppmodal__foot"><a href="${SUPPORT_URL}" target="_blank" rel="noopener">${t("claim.help.stillStuck")}</a></p>` +
      `</div>` +
      `</div>`
    );
  }

  function renderOk(d) {
    const u = d.user || {};
    const av = avatarMarkup(u, "ppanel__av", 128);
    const plus = d.plus || {};
    const pass = d.pass;
    const plusActive = !!plus.active;
    const premiumActive = !!(pass && pass.active);
    const plusDetail = plus.expiresAt
      ? `${plusActive ? t("panel.activeUntil") : t("panel.expiredOn")} ${esc(fmtDate(plus.expiresAt))}`
      : "";
    const premiumParts = [];
    if (pass) {
      premiumParts.push(`${esc(pass.used ?? 0)} / ${esc(pass.seats ?? 0)} ${t("panel.seatsUsed")}`);
      if (pass.expiresAt) {
        premiumParts.push(`${premiumActive ? t("panel.activeUntil") : t("panel.expiredOn")} ${esc(fmtDate(pass.expiresAt))}`);
      }
    }
    let servers = "";
    if (premiumActive) {
      if (pass.servers && pass.servers.length) {
        const items = pass.servers
          .map((s) => `<li>${s.name ? esc(s.name) : "<code>" + esc(s.id) + "</code>"}</li>`)
          .join("");
        servers = `<div class="ppanel__servers"><span class="ppanel__meta">${t("panel.servers")}</span><ul>${items}</ul></div>`;
      } else {
        servers = `<p class="ppanel__meta">${t("panel.noServers")}</p>`;
      }
    }
    return (
      `<div class="ppanel__account">` +
      `<div class="ppanel__user">${av}</div>` +
      `<div class="ppanel__identity"><span class="ppanel__name">${esc(u.username || "Discord user")}</span>` +
      `<button type="button" class="ppanel__id" data-id="${esc(u.id || "")}" aria-label="Copy Discord ID">Discord ID: <span class="ppanel__idnum">${esc(u.id || "-")}</span>` +
      `<svg class="ppanel__copyic" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-1v-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v1H8V7Z"/><path d="M3 10a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7Zm3-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H6Z"/></svg>` +
      `<svg class="ppanel__okic" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8.5-8.5 1.4 1.4-9.9 9.9Z"/></svg>` +
      `<span class="ppanel__tip" aria-hidden="true">Click to copy</span></button>` +
      `<button type="button" class="ppanel__logout" id="ppLogout">${t("panel.logout")}</button></div></div>` +
      `<div class="ppanel__statusgrid">` +
      statusRow("Vozen Premium", premiumActive, premiumParts.join(" &middot; ")) +
      statusRow("Vozen Plus", plusActive, plusDetail) +
      `</div>${servers}${claimCard()}`
    );
  }

  // Submete o código da transação a POST {API_BASE}/api/link (autenticado com o token do OAuth).
  // 200 => ativado (recarrega o painel); 400 "use_receipt_code" => colaram um email em vez do
  // código (plano 021: o email já não é aceite como prova de posse); 404 => código não
  // encontrado; 429 => rate-limit; 401 => token expirou (re-login). Nunca expõe qual código é
  // válido (404 genérico do backend).
  async function doClaim(ev) {
    ev.preventDefault();
    const el = document.getElementById("premiumPanel");
    const input = el && el.querySelector("#ppClaimCode");
    const btn = el && el.querySelector("#ppClaimBtn");
    const msg = el && el.querySelector("#ppClaimMsg");
    const consent = el && el.querySelector("#ppClaimConsent");
    if (!input || !btn) return;
    const code = (input.value || "").trim();
    const setMsg = (text, kind) => {
      if (!msg) return;
      msg.hidden = false;
      msg.textContent = text;
      msg.className = "ppanel__claimmsg" + (kind ? " is-" + kind : "");
    };
    if (!code) {
      setMsg(t("claim.notfound"), "err");
      return;
    }
    // O Ref do recibo (`Ref: S-M1X823C9FW`) e a unica coisa com ar de codigo no email do Ko-fi, e
    // nunca casa com nada: o webhook do Ko-fi nao envia esse campo. Deixa-lo ir ao servidor da um
    // 404 que a pessoa nao consegue accionar — e ela pagou mesmo. Apanha-se aqui, ANTES do fetch,
    // e abre-se a ajuda — que agora pede o EMAIL (o Ref nao serve para ninguem procurar).
    if (REF_RE.test(code)) {
      setMsg(t("claim.help.refPasted"), "err");
      openClaimHelp();
      return;
    }
    // Sem consentimento nao se entrega. Se falhassemos ABERTO aqui, activavamos o passe sem a
    // pessoa ter reconhecido nada — e o direito de retratacao ficava de pe, que e exactamente o
    // que isto existe para evitar.
    if (!consent || !consent.checked) {
      setMsg(t("claim.consentRequired"), "err");
      return;
    }
    const tok = storedToken();
    if (!tok) {
      login();
      return;
    }
    const prev = btn.textContent;
    btn.disabled = true;
    input.disabled = true;
    btn.textContent = t("claim.working");
    try {
      const res = await fetch(PREMIUM_API_BASE + "/api/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        setMsg(t("claim.ok"), "ok");
        input.value = "";
        window.setTimeout(loadPanel, 1200); // reflete o novo estado no painel
        return;
      }
      if (res.status === 401) {
        login();
        return;
      }
      if (res.status === 429) {
        setMsg(t("claim.ratelimited"), "err");
        return;
      }
      if (res.status === 404) {
        setMsg(t("claim.notfound"), "err");
        return;
      }
      let errCode = "";
      try {
        const errBody = await res.json();
        if (errBody && typeof errBody.error === "string") errCode = errBody.error;
      } catch {
        /* corpo sem JSON válido — cai no erro genérico abaixo */
      }
      setMsg(errCode === "use_receipt_code" ? t("claim.useReceiptCode") : t("claim.error"), "err");
    } catch {
      setMsg(t("claim.error"), "err");
    } finally {
      btn.disabled = false;
      input.disabled = false;
      btn.textContent = prev;
    }
  }

  // Quem abriu o modal, para lhe devolver o foco ao fechar. Sem isto, quem navega por teclado
  // volta ao topo do documento e tem de refazer o caminho todo ate ao cartao.
  let claimHelpOpener = null;

  // O modal vive no <body>, NAO dentro do #premiumPanel que o desenha. Nao e preferencia: o
  // .premium-panel tem `transform` e `backdrop-filter`, e qualquer um deles faz do painel o
  // containing block dos descendentes `position: fixed`. La dentro, o modal ficava preso ao
  // painel — media 836px de largura no meio da pagina em vez de cobrir o ecra, e o blur so tapava
  // o proprio painel. Verificado no browser; nenhum teste de string apanha isto.
  //
  // renderPanel reescreve o innerHTML do painel a cada loadPanel, por isso o modal e re-montado
  // aqui a seguir: substitui-se o anterior para nao acumular copias no body, e os handlers
  // ligam-se por document.getElementById (o modal ja nao esta dentro de `el`).
  function mountClaimHelp(el) {
    document.getElementById("ppClaimHelp")?.remove();
    if (!el.querySelector("#ppClaimHelpOpen")) return; // sem cartao de activacao, sem modal
    document.body.insertAdjacentHTML("beforeend", claimHelpModal());
    document.getElementById("ppClaimHelpClose")?.addEventListener("click", closeClaimHelp);
    document.getElementById("ppClaimHelpBackdrop")?.addEventListener("click", closeClaimHelp);
    document.getElementById("ppClaimHelpForm")?.addEventListener("submit", sendClaimHelp);
  }

  function openClaimHelp() {
    const modal = document.getElementById("ppClaimHelp");
    if (!modal) return;
    claimHelpOpener = document.activeElement;
    modal.hidden = false;
    document.body.classList.add("is-modal-open");
    // O foco entra na caixa (nao no input): quem usa leitor de ecra ouve o titulo e os dois
    // passos antes do campo, que e a ordem que explica o campo. Nao se pre-preenche nada — o campo
    // e o EMAIL do Ko-fi, e o que a pessoa possa ter colado antes (um Ref) nao e um email.
    document.getElementById("ppClaimHelpBox")?.focus();
  }

  function closeClaimHelp() {
    const modal = document.getElementById("ppClaimHelp");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove("is-modal-open");
    if (claimHelpOpener && typeof claimHelpOpener.focus === "function") claimHelpOpener.focus();
    claimHelpOpener = null;
  }

  // Esc fecha. Registado UMA vez no documento (nao por render) — o painel volta a desenhar-se a
  // cada loadPanel e um listener por render acumulava-se em silencio.
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeClaimHelp();
  });

  // Um UUID em qualquer forma (codigo solto, ou dentro de um link de recibo). Se aparecer no campo
  // de email, a pessoa colou o codigo/link no sitio errado — e ativa-se na mesma pela caixa
  // principal, sem ela ter de perceber a diferenca.
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  // Quando a notificacao nao sai (API em baixo, webhook por configurar), a pessoa nao pode ficar
  // sem saida: mostra-se a mensagem ja pronta para ela colar no suporte, com o email la dentro. E
  // o mesmo trabalho, feito a mao — mas ela sai daqui com alguma coisa.
  function showClaimHelpFallback(setMsg, email) {
    setMsg(t("claim.help.sendError"), "err");
    const box = document.getElementById("ppClaimHelpMsg");
    if (!box) return;
    const pre = document.createElement("pre");
    pre.className = "ppmodal__copy";
    pre.textContent = `Vozen: I can't activate my purchase. Ko-fi email: ${email}`;
    box.appendChild(pre);
  }

  // Envia (Discord ID via token, email do Ko-fi) para o dono activar a mao. O email e pista de
  // procura, NAO prova (ver claimHelpModal). Se o endpoint falhar, mostra uma mensagem pronta a
  // copiar: a pessoa nunca fica sem saida por a nossa API estar em baixo.
  async function sendClaimHelp(ev) {
    ev.preventDefault();
    const input = document.getElementById("ppClaimHelpEmail");
    const btn = document.getElementById("ppClaimHelpSend");
    const msg = document.getElementById("ppClaimHelpMsg");
    if (!input || !btn) return;
    const value = (input.value || "").trim();
    const setMsg = (text, kind) => {
      if (!msg) return;
      msg.hidden = false;
      msg.textContent = text;
      msg.className = "ppanel__claimmsg" + (kind ? " is-" + kind : "");
    };
    if (!value) return;
    // Colou aqui o codigo verdadeiro (ou o link do recibo)? Manda-se de volta para a caixa
    // principal e ativa-se — a pessoa nao tem de saber a diferenca.
    if (UUID_RE.test(value)) {
      const main = document.getElementById("ppClaimCode");
      if (main) {
        main.value = value;
        closeClaimHelp();
        main.focus();
        return;
      }
    }
    // Nao e um email? Diz-lho antes de enviar — o dono nao pode ficar com um ping inutil.
    if (!/^[^@\s]+@[^@\s]+$/.test(value)) {
      setMsg(t("claim.help.notEmail"), "err");
      return;
    }
    const tok = storedToken();
    if (!tok) {
      login();
      return;
    }
    const prev = btn.textContent;
    btn.disabled = true;
    input.disabled = true;
    btn.textContent = t("claim.working");
    try {
      const res = await fetch(PREMIUM_API_BASE + "/api/claim-help", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ email: value }),
      });
      if (res.ok) {
        setMsg(t("claim.help.sent"), "ok");
        return;
      }
      if (res.status === 401) {
        login();
        return;
      }
      if (res.status === 429) {
        setMsg(t("claim.ratelimited"), "err");
        return;
      }
      showClaimHelpFallback(setMsg, value);
    } catch {
      showClaimHelpFallback(setMsg, value);
    } finally {
      btn.disabled = false;
      input.disabled = false;
      btn.textContent = prev;
    }
  }

  function renderPanel() {
    const el = document.getElementById("premiumPanel");
    if (!el) return;
    if (panelState.mode === "hidden") {
      el.hidden = true;
      el.innerHTML = "";
      renderNavLogin(navDataForState());
      return;
    }
    el.hidden = false;
    if (IS_ACCOUNT && panelState.mode !== "anon") unlockAccountPage();
    const head = `<div class="ppanel__head"><span class="ppanel__title">💎 Membership status</span></div>`;
    let body = "";
    if (panelState.mode === "soon") {
      // Estado dormente da página da conta: backend ainda não configurado.
      body = `<p class="ppanel__meta">${t("panel.soon")}</p>`;
    } else if (panelState.mode === "anon") {
      body = `<div class="ppanel__anon"><button type="button" class="btn--discord" id="ppLogin">${DISCORD_MARK}<span>${t("panel.login")}</span></button><p class="ppanel__meta">${t("panel.noneSub")}</p></div>`;
    } else if (panelState.mode === "loading") {
      body = `<div class="ppanel__loading" aria-label="${esc(t("panel.loading"))}"><span class="ppanel__skel ppanel__skel--lg"></span><span class="ppanel__skel"></span><span class="ppanel__skel ppanel__skel--sm"></span></div>`;
    } else if (panelState.mode === "error") {
      body = `<div class="ppanel__error"><span class="ppanel__error-ic" aria-hidden="true">!</span><p class="ppanel__meta">${t("panel.error")}</p><button type="button" class="btn--ghost" id="ppRetry">${t("panel.retry")}</button></div>`;
    } else if (panelState.mode === "ok") {
      body = renderOk(panelState.data || {});
    }
    el.innerHTML = head + body;
    renderNavLogin(navDataForState());
    const byId = (id) => el.querySelector("#" + id);
    byId("ppLogin")?.addEventListener("click", login);
    byId("ppLogout")?.addEventListener("click", logout);
    byId("ppRetry")?.addEventListener("click", loadPanel);
    byId("ppClaimForm")?.addEventListener("submit", doClaim);
    byId("ppClaimHelpOpen")?.addEventListener("click", () => openClaimHelp(""));
    mountClaimHelp(el);
    el.querySelector(".ppanel__id")?.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      const id = btn.dataset.id || "";
      if (!id || !navigator.clipboard) return;
      const tip = btn.querySelector(".ppanel__tip");
      try {
        await navigator.clipboard.writeText(id);
        btn.classList.add("is-copied");
        if (tip) tip.textContent = "Copied!";
        window.setTimeout(() => {
          btn.classList.remove("is-copied");
          if (tip) tip.textContent = "Click to copy";
        }, 1500);
      } catch {}
    });
  }

  // Botão de login na navbar: leva à página dedicada da conta (account.html). Já na
  // página da conta, faz login OAuth quando o backend está no ar; senão faz scroll ao
  // painel (que mostra "em breve") — nunca dispara um redirect que ainda não existe.
  function scrollPremiumPanel() {
    document
      .getElementById("premiumPanel")
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }

  const navLoginBtn = document.getElementById("navLogin");
  if (navLoginBtn) {
    navLoginBtn.addEventListener("click", () => {
      if (!IS_ACCOUNT) {
        if (storedToken() || !PREMIUM_API_BASE) window.location.href = "/account";
        else login();
        return;
      }
      if (panelState.mode === "ok") {
        scrollPremiumPanel();
        return;
      }
      if (PREMIUM_API_BASE) login();
      else scrollPremiumPanel();
    });
  }

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
  loadPanel();
})();
