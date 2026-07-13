/* Vozen — dashboard web de configuração da guild.
   OAuth: reutiliza o redirect /account (o único registado no portal) com scope
   `identify guilds`; o main.js guarda o token no sessionStorage e salta de volta a
   /dashboard (via `vozen.returnTo`). Aqui lemos o token e falamos com a API do bot
   (/api/dashboard/*). A autorização real (MANAGE_GUILD + bot presente) é no servidor. */
(function () {
  "use strict";
  var CLIENT_ID = "1523826014935842997";
  var API = "https://api.vozen.org";
  var REDIRECT = new URL("/account", location.href).href;
  var TOK_KEY = "vozen.dtoken";
  var STATE_KEY = "vozen.oauthstate";
  var RETURN_KEY = "vozen.returnTo";
  var LS_LANG = "vozen.lang";

  var root = document.getElementById("dashRoot");
  if (!root) return;

  /* ── i18n compacto (en base + pt; outras línguas caem no en) ── */
  var STR = {
    en: {
      loginTitle: "Log in to manage your servers",
      loginSub: "You'll be asked to share the list of servers you manage. We only touch servers where you're an admin and Vozen is present.",
      loginBtn: "Log in with Discord",
      loading: "Loading…",
      pick: "Pick a server",
      pickHint: "Servers where you're an admin and Vozen is added.",
      none: "No servers to manage",
      noneHint: "You need Manage Server permission on a server that has Vozen. Add Vozen, then reload.",
      expired: "Your login expired — please log in again.",
      forbidden: "You can't manage that server.",
      error: "Something went wrong. Try again in a moment.",
      save: "Save changes",
      saving: "Saving…",
      saved: "Saved ✓",
      saveFail: "Couldn't save — try again.",
      back: "← Choose another server",
      f_autoread: "Auto-read the set channel",
      f_xsaid: 'Announce who spoke ("{name} said …")',
      f_autojoin: "Join voice automatically",
      f_readBots: "Read other bots' messages",
      f_textInVoice: "Read the voice channel's text chat",
      f_antispam: "Anti-spam filter",
      f_streakAnnounce: "Daily 🔥 streak notices",
      f_soundboard: "Soundboard (/sound)",
      f_greetOnJoin: "Greet people when they join voice",
      f_maxChars: "Max characters read per message",
      f_ratePerMin: "Messages per minute (per user)",
    },
    pt: {
      loginTitle: "Entra para gerir os teus servidores",
      loginSub: "Vais autorizar a partilha da lista de servidores que geres. Só mexemos em servidores onde és admin e o Vozen está presente.",
      loginBtn: "Entrar com o Discord",
      loading: "A carregar…",
      pick: "Escolhe um servidor",
      pickHint: "Servidores onde és admin e o Vozen está adicionado.",
      none: "Sem servidores para gerir",
      noneHint: "Precisas da permissão Gerir Servidor num servidor com o Vozen. Adiciona o Vozen e recarrega.",
      expired: "A tua sessão expirou — entra outra vez.",
      forbidden: "Não podes gerir esse servidor.",
      error: "Algo correu mal. Tenta daqui a pouco.",
      save: "Guardar alterações",
      saving: "A guardar…",
      saved: "Guardado ✓",
      saveFail: "Não deu para guardar — tenta outra vez.",
      back: "← Escolher outro servidor",
      f_autoread: "Ler automaticamente o canal definido",
      f_xsaid: 'Anunciar quem falou ("{nome} disse …")',
      f_autojoin: "Entrar na call automaticamente",
      f_readBots: "Ler mensagens de outros bots",
      f_textInVoice: "Ler o chat de texto do canal de voz",
      f_antispam: "Filtro anti-spam",
      f_streakAnnounce: "Avisos de streak 🔥 diário",
      f_soundboard: "Soundboard (/sound)",
      f_greetOnJoin: "Saudar quem entra na call",
      f_maxChars: "Máx. de caracteres lidos por mensagem",
      f_ratePerMin: "Mensagens por minuto (por utilizador)",
    },
  };
  function lang() {
    try {
      var l = localStorage.getItem(LS_LANG) || "en";
      return STR[l] ? l : "en";
    } catch (e) {
      return "en";
    }
  }
  function t(k) {
    var l = lang();
    return (STR[l] && STR[l][k]) || STR.en[k] || k;
  }

  var TOGGLES = [
    "autoread",
    "xsaid",
    "autojoin",
    "readBots",
    "textInVoice",
    "antispam",
    "streakAnnounce",
    "soundboard",
    "greetOnJoin",
  ];
  var NUMS = [
    { key: "maxChars", min: 1, max: 2000 },
    { key: "ratePerMin", min: 1, max: 120 },
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function token() {
    try {
      return sessionStorage.getItem(TOK_KEY);
    } catch (e) {
      return null;
    }
  }
  function clearToken() {
    try {
      sessionStorage.removeItem(TOK_KEY);
    } catch (e) {}
  }
  function authHeaders() {
    return { Authorization: "Bearer " + token() };
  }

  /* ── OAuth: pede identify+guilds via o redirect /account; volta a /dashboard ── */
  function randState() {
    var a = new Uint8Array(16);
    var c = window.crypto || window.msCrypto;
    if (!c || typeof c.getRandomValues !== "function") throw new Error("no-csprng");
    c.getRandomValues(a);
    return [].map
      .call(a, function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }
  function login() {
    var state;
    try {
      state = randState();
    } catch (e) {
      alert("Your browser can't generate a secure login token. Please update it.");
      return;
    }
    try {
      sessionStorage.setItem(STATE_KEY, state);
      sessionStorage.setItem(RETURN_KEY, "/dashboard");
    } catch (e) {}
    var u = new URL("https://discord.com/oauth2/authorize");
    u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("redirect_uri", REDIRECT);
    u.searchParams.set("response_type", "token");
    u.searchParams.set("scope", "identify guilds");
    u.searchParams.set("state", state);
    location.href = u.toString();
  }

  /* ── estilos inline (CSP permite; usam as vars do tema do site) ── */
  var CARD =
    "background:var(--panel-2,#12121c);border:1px solid var(--line-2,#23233a);border-radius:16px;padding:22px;margin-top:18px";
  var BTN = "btn btn--primary";
  var MUTED = "color:var(--muted,#9a9ab0)";

  /* Grelha de servidores: classes precisam de :hover/:focus, impossível em style=""
     inline — injetamos um <style> uma vez (CSP style-src tem 'unsafe-inline'). */
  var GUILD_CSS =
    ".dash-guilds{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:14px;margin-top:16px}" +
    ".dash-guild{display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px 10px;background:var(--bg-0,#0a0a12);border:1px solid var(--line-2,#23233a);border-radius:14px;cursor:pointer;font:inherit;color:var(--text,#e9e9f2);transition:border-color .15s ease,transform .15s ease}" +
    ".dash-guild:hover,.dash-guild:focus-visible{border-color:var(--aqua,#38e0c8);transform:translateY(-2px)}" +
    ".dash-guild:active{transform:scale(.97)}" +
    ".dash-guild__img,.dash-guild__ph{width:64px;height:64px;border-radius:50%;flex:none}" +
    ".dash-guild__img{object-fit:cover;background:var(--panel-2,#12121c)}" +
    ".dash-guild__ph{display:flex;align-items:center;justify-content:center;background:var(--panel-2,#12121c);border:1px solid var(--line-2,#23233a);font-weight:700;font-size:1.05rem;color:var(--aqua,#38e0c8)}" +
    ".dash-guild__name{font-size:.92rem;line-height:1.3;text-align:center;overflow-wrap:anywhere}";
  var styleEl = document.createElement("style");
  styleEl.textContent = GUILD_CSS;
  document.head.appendChild(styleEl);

  function view(html) {
    root.innerHTML = html;
  }

  function renderLogin(msg) {
    view(
      '<div style="' +
        CARD +
        '">' +
        (msg ? '<p style="color:var(--amber,#e6b34d);margin:0 0 12px">' + esc(msg) + "</p>" : "") +
        "<h2 style=\"margin:0 0 6px;font-size:1.25rem\">" +
        esc(t("loginTitle")) +
        '</h2><p style="' +
        MUTED +
        ';margin:0 0 18px">' +
        esc(t("loginSub")) +
        '</p><button type="button" class="' +
        BTN +
        '" id="dashLogin">' +
        esc(t("loginBtn")) +
        "</button></div>",
    );
    var b = document.getElementById("dashLogin");
    if (b) b.addEventListener("click", login);
  }

  function renderMessage(title, hint, opts) {
    opts = opts || {};
    view(
      '<div style="' +
        CARD +
        '"><h2 style="margin:0 0 6px;font-size:1.25rem">' +
        esc(title) +
        '</h2><p style="' +
        MUTED +
        ';margin:0">' +
        esc(hint) +
        "</p>" +
        (opts.retry
          ? '<button type="button" class="' +
            BTN +
            '" id="dashRetry" style="margin-top:16px">' +
            esc(t("loginBtn")) +
            "</button>"
          : "") +
        "</div>",
    );
    if (opts.retry) {
      var r = document.getElementById("dashRetry");
      if (r) r.addEventListener("click", login);
    }
  }

  /* CDN de ícones da Discord (img-src já permite cdn.discordapp.com no CSP).
     Ícones animados têm hash "a_..." e servem-se como .gif. */
  function guildIconUrl(g) {
    if (!g.icon) return null;
    var ext = String(g.icon).indexOf("a_") === 0 ? "gif" : "png";
    return "https://cdn.discordapp.com/icons/" + g.id + "/" + g.icon + "." + ext + "?size=128";
  }
  function guildInitials(name) {
    var parts = String(name).trim().split(/\s+/).slice(0, 2);
    var out = "";
    for (var i = 0; i < parts.length; i++) out += parts[i].charAt(0);
    return out.toUpperCase() || "?";
  }

  function renderPicker(guilds) {
    var cards = guilds
      .map(function (g, i) {
        var url = guildIconUrl(g);
        var art = url
          ? '<img class="dash-guild__img" src="' + esc(url) + '" alt="">'
          : '<span class="dash-guild__ph" aria-hidden="true">' +
            esc(guildInitials(g.name)) +
            "</span>";
        return (
          '<button type="button" class="dash-guild" data-i="' +
          i +
          '">' +
          art +
          '<span class="dash-guild__name">' +
          esc(g.name) +
          "</span></button>"
        );
      })
      .join("");
    view(
      '<div style="' +
        CARD +
        '"><h2 style="margin:0 0 6px;font-size:1.25rem">' +
        esc(t("pick")) +
        '</h2><p style="' +
        MUTED +
        ';margin:0">' +
        esc(t("pickHint")) +
        '</p><div class="dash-guilds">' +
        cards +
        "</div></div>",
    );
    var btns = root.querySelectorAll(".dash-guild");
    function onPick(ev) {
      var g = guilds[Number(ev.currentTarget.getAttribute("data-i"))];
      if (g) loadForm(g, guilds);
    }
    // Ícone que falhe a carregar (hash antigo, CDN em baixo) vira placeholder de iniciais.
    function onImgFail(ev) {
      var img = ev.currentTarget;
      var idx = Number(img.parentNode.getAttribute("data-i"));
      var ph = document.createElement("span");
      ph.className = "dash-guild__ph";
      ph.setAttribute("aria-hidden", "true");
      ph.textContent = guildInitials((guilds[idx] || {}).name || "?");
      img.parentNode.replaceChild(ph, img);
    }
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", onPick);
      var img = btns[i].querySelector(".dash-guild__img");
      if (img) img.addEventListener("error", onImgFail);
    }
  }

  function toggleRow(key, on) {
    return (
      '<label style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line-2,#23233a)"><span>' +
      esc(t("f_" + key)) +
      '</span><input type="checkbox" data-k="' +
      key +
      '"' +
      (on ? " checked" : "") +
      ' style="width:20px;height:20px;accent-color:var(--aqua,#38e0c8)"></label>'
    );
  }
  function numRow(f, val) {
    return (
      '<label style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line-2,#23233a)"><span>' +
      esc(t("f_" + f.key)) +
      '</span><input type="number" data-k="' +
      f.key +
      '" min="' +
      f.min +
      '" max="' +
      f.max +
      '" value="' +
      esc(val) +
      '" style="width:110px;padding:9px 10px;border-radius:10px;background:var(--bg-0,#0a0a12);color:var(--text,#e9e9f2);border:1px solid var(--line-2,#23233a);font:inherit"></label>'
    );
  }

  function loadForm(guild, guilds) {
    renderMessage(t("loading"), "");
    fetch(API + "/api/dashboard/guild/" + guild.id, { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 401) {
          clearToken();
          renderLogin(t("expired"));
          return null;
        }
        if (res.status === 403) {
          renderMessage(t("forbidden"), t("noneHint"));
          return null;
        }
        if (!res.ok) {
          renderMessage(t("error"), "");
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (data && data.config) renderForm(guild, data.config, guilds);
      })
      .catch(function () {
        renderMessage(t("error"), "");
      });
  }

  function renderForm(guild, cfg, guilds) {
    var rows =
      TOGGLES.map(function (k) {
        return toggleRow(k, !!cfg[k]);
      }).join("") +
      NUMS.map(function (f) {
        return numRow(f, cfg[f.key]);
      }).join("");
    view(
      '<div style="' +
        CARD +
        '"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px"><h2 style="margin:0;font-size:1.2rem">' +
        esc(guild.name) +
        '</h2><button type="button" id="dashBack" class="btn btn--ghost btn--sm">' +
        esc(t("back")) +
        "</button></div><div id=\"dashFields\">" +
        rows +
        '</div><div style="display:flex;align-items:center;gap:14px;margin-top:18px"><button type="button" class="' +
        BTN +
        '" id="dashSave">' +
        esc(t("save")) +
        '</button><span id="dashStatus" style="' +
        MUTED +
        '"></span></div></div>',
    );
    document.getElementById("dashBack").addEventListener("click", function () {
      renderPicker(guilds);
    });
    document.getElementById("dashSave").addEventListener("click", function () {
      saveForm(guild, guilds);
    });
  }

  function collectPatch() {
    var patch = {};
    var inputs = document.querySelectorAll("#dashFields [data-k]");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var k = el.getAttribute("data-k");
      if (el.type === "checkbox") patch[k] = el.checked;
      else patch[k] = Number(el.value);
    }
    return patch;
  }

  function saveForm(guild, guilds) {
    var status = document.getElementById("dashStatus");
    var btn = document.getElementById("dashSave");
    if (btn) btn.disabled = true;
    if (status) status.textContent = t("saving");
    fetch(API + "/api/dashboard/guild/" + guild.id, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify(collectPatch()),
    })
      .then(function (res) {
        if (btn) btn.disabled = false;
        if (res.status === 401) {
          clearToken();
          renderLogin(t("expired"));
          return;
        }
        if (res.status === 403) {
          renderMessage(t("forbidden"), t("noneHint"));
          return;
        }
        if (status) status.textContent = res.ok ? t("saved") : t("saveFail");
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        if (status) status.textContent = t("saveFail");
      });
  }

  function boot() {
    var tok = token();
    if (!tok) {
      renderLogin("");
      return;
    }
    renderMessage(t("loading"), "");
    fetch(API + "/api/dashboard/guilds", { headers: authHeaders() })
      .then(function (res) {
        if (res.status === 401) {
          clearToken();
          renderLogin(t("expired"));
          return null;
        }
        if (!res.ok) {
          renderMessage(t("error"), "", { retry: true });
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        var guilds = data.guilds || [];
        if (!guilds.length) {
          renderMessage(t("none"), t("noneHint"));
          return;
        }
        renderPicker(guilds);
      })
      .catch(function () {
        renderMessage(t("error"), "", { retry: true });
      });
  }

  boot();
})();
