/*
 * Extension zone logic for the Enterprise teaser.
 * - Small zone: Export button + "Enterprise" button. Both shrink with the
 *   zone and finally collapse to the export icon alone.
 * - Large zone: the showcase is shown in place, under the Export button.
 * - First export asks the person to sign in with an emailed access code
 *   (sign-in popup), then exports. Later exports go straight through.
 * The export itself is handled by build_table_copy.js, untouched.
 */
(function () {
  "use strict";

  var CFG = window.ETE_CONFIG;
  var S = window.ETEShowcase;
  var I = window.ETEIdentity;

  var compact, inlineHost, exportBtn, entBtn, label;
  var inlineBuilt = false;
  var mode = null;
  var tableauReady = false;
  var env = { context: "", tableauVersion: "" };
  var dialogOpen = false;

  /* Shrink stages for the small layout, tried in order. Each stage scales
     the font down to its minimum before the next stage hides something.
     [hide Enterprise label, hide Export label, hide Enterprise button, min font px] */
  var STAGES = [
    [false, false, false, 11],
    [true,  false, false, 10],
    [true,  true,  false, 10],
    [true,  true,  true,  4]
  ];
  var MAX_FONT = 24;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    compact = document.getElementById("compact");
    inlineHost = document.getElementById("inline");
    exportBtn = document.getElementById("export_button");
    entBtn = document.getElementById("enterprise_button");
    label = exportBtn.querySelector(".btn-label");

    gateExportBehindSignIn();
    watchBusyState();
    layout();

    var t;
    var onResize = function () { clearTimeout(t); t = setTimeout(layout, 60); };
    window.addEventListener("resize", onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(document.body);

    entBtn.addEventListener("click", function () { openShowcase(); });

    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        if (!exportBtn.disabled) exportBtn.click();
      }
    });

    waitForTableau().then(function (e) {
      tableauReady = true;
      env.context = e && e.context ? e.context : "";
      env.tableauVersion = e && e.tableauVersion ? e.tableauVersion : "";
      I.checkSession(env); // confirms the saved sign-in, records "last seen"
      maybeAutoOpen();
    }, function () {
      // Not running inside Tableau (e.g. opened directly in a browser).
    });
  }

  /* ── Layout ─────────────────────────────────────────────────────────── */
  function layout() {
    var w = document.body.clientWidth;
    var h = document.body.clientHeight;
    var big = w >= CFG.inlineMinSize.width && h >= CFG.inlineMinSize.height;
    var next = big && !S.isOptedOut() ? "inline" : "compact";

    if (next !== mode) {
      mode = next;
      if (mode === "inline") showInline(); else showCompact();
    }
    if (mode === "compact") fitCompact();
  }

  /* Biggest font (≤ zone height allows) at which the buttons fit the width.
     Like the free version: everything scales together, then labels drop
     away, ending with just the export icon. */
  function fitCompact() {
    var W = compact.clientWidth;
    var H = compact.clientHeight;
    if (!W || !H) return;
    var maxFs = Math.min(MAX_FONT, H / 2.3);

    for (var i = 0; i < STAGES.length; i++) {
      var st = STAGES[i];
      var last = i === STAGES.length - 1;
      if (!last && maxFs < st[3]) continue; // zone too short for this stage's text
      applyStage(st);
      var fs = maxFs;
      for (;;) {
        compact.style.fontSize = fs + "px";
        if (compact.scrollWidth <= W + 0.5) return;
        if (fs <= st[3]) break;
        fs = Math.max(st[3], fs - 0.5);
      }
    }
    // Nothing fits: smallest stage, smallest font.
    compact.style.fontSize = STAGES[STAGES.length - 1][3] + "px";
  }

  function applyStage(st) {
    compact.classList.toggle("hide-ent-label", st[0]);
    compact.classList.toggle("hide-exp-label", st[1]);
    compact.classList.toggle("hide-ent", st[2]);
  }

  function showCompact() {
    compact.insertBefore(exportBtn, compact.firstChild);
    compact.hidden = false;
    inlineHost.hidden = true;
    var v = inlineHost.querySelector("video");
    if (v) v.pause();
  }

  function showInline() {
    if (!inlineBuilt) {
      var bar = document.createElement("div");
      bar.className = "zone-toolbar";
      bar.innerHTML = '<span class="edition">Free edition</span>';
      S.render(inlineHost, {
        mode: "inline",
        meta: env, // filled in once Tableau is ready
        toolbar: bar,
        onHide: function () { S.setOptOut(true); layout(); }
      });
      inlineBuilt = true;
    }
    var bar2 = inlineHost.querySelector(".zone-toolbar");
    bar2.insertBefore(exportBtn, bar2.firstChild);
    compact.hidden = true;
    inlineHost.hidden = false;
    var v = inlineHost.querySelector("video");
    if (v && v.paused && !inlineHost.querySelector(".sc-play:not([hidden])")) {
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    }
  }

  /* ── Sign-in gate ───────────────────────────────────────────────────────
     Capture-phase listener on the document runs before the export logic's
     click handler on the button, so the export can wait for sign-in. */
  function gateExportBehindSignIn() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest("#export_button")) return;
      if (I.isSignedIn()) { I.track("export"); return; }
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      openSignIn();
    }, true);
  }

  function openSignIn() {
    if (!tableauReady || !tableau.extensions.ui) {
      window.open(pageUrl("signin.html"), "_blank"); // preview outside Tableau
      return;
    }
    if (dialogOpen) return;
    dialogOpen = true;
    var size = CFG.signIn.dialog;
    tableau.extensions.ui
      .displayDialogAsync(pageUrl("signin.html"), JSON.stringify(env), { width: size.width, height: size.height })
      .then(after, function (err) { logDialogError(err); after(); });

    function after() {
      dialogOpen = false;
      if (I.isSignedIn()) exportBtn.click(); // continue straight to the export
    }
  }

  /* ── Export button busy state ───────────────────────────────────────────
     build_table_copy.js disables the button while exporting; mirror that. */
  function watchBusyState() {
    var apply = function () {
      var busy = exportBtn.disabled;
      exportBtn.classList.toggle("is-busy", busy);
      exportBtn.setAttribute("aria-busy", busy ? "true" : "false");
      label.textContent = busy ? "Preparing…" : "Export All to Excel";
      if (mode === "compact") fitCompact();
    };
    new MutationObserver(apply).observe(exportBtn, { attributes: true, attributeFilter: ["disabled"] });
    apply();
  }

  /* ── Tableau ────────────────────────────────────────────────────────────
     build_table_copy.js calls initializeAsync(); wait until that is done
     instead of initializing twice. */
  function waitForTableau() {
    return new Promise(function (resolve, reject) {
      if (!window.tableau || !tableau.extensions) { reject(); return; }
      var start = Date.now();
      (function poll() {
        var e = null;
        try { e = tableau.extensions.environment; } catch (x) { e = null; }
        if (e) { resolve(e); return; }
        if (Date.now() - start > 30000) { reject(); return; }
        setTimeout(poll, 150);
      })();
    });
  }

  function maybeAutoOpen() {
    if (mode !== "compact" || !S.autoOpenDue()) return;
    setTimeout(function () {
      if (mode !== "compact" || dialogOpen) return;
      S.markAutoOpened();
      openShowcase();
    }, CFG.autoOpen.delayMs);
  }

  function pageUrl(page) {
    var u = new URL(page, window.location.href);
    if (env.context) u.searchParams.set("context", env.context);
    return u.toString();
  }

  function logDialogError(err) {
    var closedByUser = window.tableau && tableau.ErrorCodes &&
      err && err.errorCode === tableau.ErrorCodes.DialogClosedByUser;
    if (!closedByUser) console.warn("[Enterprise teaser] Popup error:", err);
  }

  function openShowcase() {
    if (!tableauReady || !tableau.extensions.ui) {
      window.open(pageUrl("showcase.html"), "_blank");
      return;
    }
    if (dialogOpen) return;
    dialogOpen = true;
    tableau.extensions.ui
      .displayDialogAsync(pageUrl("showcase.html"), JSON.stringify(env), {
        width: CFG.dialog.width,
        height: CFG.dialog.height
      })
      .then(done, function (err) { logDialogError(err); done(); });

    function done() {
      dialogOpen = false;
      layout(); // the popup may have changed the "open automatically" setting
    }
  }
})();
