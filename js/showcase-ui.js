/*
 * Shared showcase UI: used by showcase.html (Tableau popup) and by
 * index.html when the zone is big enough to show it inline.
 * Runs in the browser; the only network calls go to our own /api: sign-in,
 * usage counters, and the "Contact us" form, which is filled in right here.
 */
(function () {
  "use strict";

  var CFG = window.ETE_CONFIG;
  var KEYS = { optOut: "ete.showcase.optOut", lastAuto: "ete.showcase.lastAutoOpen" };

  /* ── Storage (localStorage can be blocked: never let that break export) ── */
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    remove: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function isOptedOut() { return store.get(KEYS.optOut) === "1"; }
  function setOptOut(on) { on ? store.set(KEYS.optOut, "1") : store.remove(KEYS.optOut); }

  function autoOpenDue() {
    if (!CFG.autoOpen.enabled || isOptedOut()) return false;
    var last = parseInt(store.get(KEYS.lastAuto) || "0", 10);
    return Date.now() - last > CFG.autoOpen.cooldownDays * 864e5;
  }
  function markAutoOpened() { store.set(KEYS.lastAuto, String(Date.now())); }

  /* ── Icons (inline SVG: emoji render inconsistently in Tableau Desktop) ── */
  var ICON = {
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    done: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mail: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 5.5l7 5.5 7-5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function valueCell(v) {
    if (v === true) return '<span class="sc-yes" aria-label="Included">' + ICON.check + "</span>";
    if (v === false) return '<span class="sc-no" aria-label="Not included">–</span>';
    return '<span class="sc-text">' + esc(v) + "</span>";
  }

  /* Free vs Enterprise, drawn as a spreadsheet with the Enterprise column selected. */
  function comparisonHtml() {
    var rows = CFG.comparison;
    var h = '<div class="sc-grid" role="table" aria-label="Free and Enterprise compared">';
    h += '<div class="sc-hd sc-corner" aria-hidden="true"></div>' +
         '<div class="sc-hd" aria-hidden="true">A</div>' +
         '<div class="sc-hd" aria-hidden="true">B</div>' +
         '<div class="sc-hd sc-hd-sel" aria-hidden="true">C</div>';
    h += '<div class="sc-rn" aria-hidden="true">1</div>' +
         '<div class="sc-c sc-th" role="columnheader">Feature</div>' +
         '<div class="sc-c sc-th sc-mid" role="columnheader">Free</div>' +
         '<div class="sc-c sc-th sc-mid sc-ent" role="columnheader">Enterprise</div>';
    rows.forEach(function (r, i) {
      h += '<div class="sc-rn" aria-hidden="true">' + (i + 2) + "</div>" +
           '<div class="sc-c" role="cell">' + esc(r.feature) + "</div>" +
           '<div class="sc-c sc-mid" role="cell">' + valueCell(r.free) + "</div>" +
           '<div class="sc-c sc-mid sc-ent" role="cell">' + valueCell(r.enterprise) + "</div>";
    });
    h += '<div class="sc-sel" aria-hidden="true"></div>';
    h += "</div>";
    return h;
  }

  /* The "Contact us" form, shown in place of the comparison. */
  var MAX_MESSAGE = 2000;

  function contactFormHtml() {
    var C = CFG.contact;
    var sizes = C.teamSizes.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
    return (
      '<form class="cf" novalidate aria-labelledby="cf-title">' +
        '<div class="cf-head">' +
          '<h2 class="cf-title" id="cf-title">' + esc(C.title) + "</h2>" +
          '<button type="button" class="sc-link-btn cf-back" data-act="back">' + ICON.back + "<span>Back</span></button>" +
        "</div>" +
        '<p class="cf-lead">' + esc(C.lead) + "</p>" +
        '<div class="cf-grid">' +
          field("name", "Full name", true, '<input class="cf-input" id="cf-name" name="name" type="text" autocomplete="name" maxlength="100" spellcheck="false">') +
          field("email", "Work email", true, '<input class="cf-input" id="cf-email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" spellcheck="false" autocapitalize="off">') +
          field("company", "Company", true, '<input class="cf-input" id="cf-company" name="company" type="text" autocomplete="organization" maxlength="120">') +
          field("jobTitle", "Job title", false, '<input class="cf-input" id="cf-jobTitle" name="jobTitle" type="text" autocomplete="organization-title" maxlength="100">') +
          field("teamSize", "Team size", false, '<select class="cf-input" id="cf-teamSize" name="teamSize"><option value="">Select</option>' + sizes + "</select>") +
          '<div class="cf-field cf-wide" data-field="message">' +
            '<label class="cf-label" for="cf-message">How can we help? <span class="cf-opt">(optional)</span></label>' +
            '<textarea class="cf-input cf-text" id="cf-message" name="message" rows="3" maxlength="' + MAX_MESSAGE + '" aria-describedby="cf-message-count" placeholder="' + esc(C.messagePlaceholder) + '"></textarea>' +
            '<span class="cf-count" id="cf-message-count" aria-live="polite">0 / ' + MAX_MESSAGE + "</span>" +
          "</div>" +
          // Hidden from people; bots that fill every field reveal themselves.
          '<div class="cf-trap" aria-hidden="true"><label>Website <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>' +
        "</div>" +
        '<p class="cf-form-error" role="alert" hidden></p>' +
        '<div class="cf-submit-row">' +
          '<button type="submit" class="sc-primary cf-submit">Submit</button>' +
          '<span class="cf-note">' + esc(C.note) + ' <button type="button" class="si-inline-link" data-act="privacy">Privacy policy</button></span>' +
        "</div>" +
      "</form>" +
      '<div class="cf-done" hidden tabindex="-1">' +
        '<span class="cf-done-icon">' + ICON.done + "</span>" +
        '<h2 class="cf-title">Thank you</h2>' +
        '<p class="cf-lead cf-done-msg"></p>' +
        '<button type="button" class="sc-link-btn" data-act="back">Back to the overview</button>' +
      "</div>"
    );
  }

  function field(name, label, required, control) {
    // Each field: label, control, an error line (and for email, a suggestion line).
    var ids = "cf-" + name + "-err" + (name === "email" ? " cf-email-hint" : "");
    control = control.replace(' id="cf-' + name + '"', ' id="cf-' + name + '" aria-describedby="' + ids + '"' + (required ? ' aria-required="true"' : ""));
    return '<div class="cf-field" data-field="' + name + '">' +
      '<label class="cf-label" for="cf-' + name + '">' + esc(label) + (required ? "" : ' <span class="cf-opt">(optional)</span>') + "</label>" +
      control +
      '<p class="cf-err" id="cf-' + name + '-err" hidden></p>' +
      (name === "email" ? '<p class="cf-hint" id="cf-email-hint" hidden></p>' : "") +
    "</div>";
  }

  /*
   * render(root, opts)
   *   opts.mode      "dialog" | "inline"
   *   opts.meta      { context, tableauVersion } from Tableau (read when the form is sent)
   *   opts.onClose   dialog close button
   *   opts.onHide    inline "Hide" button
   *   opts.toolbar   HTML element placed above the formula bar (inline mode)
   */
  function render(root, opts) {
    var v = CFG.video;
    var dialog = opts.mode === "dialog";
    root.classList.add("sc", "sc-" + opts.mode);
    root.innerHTML =
      '<div class="sc-bar">' +
        '<span class="sc-namebox">Enterprise</span>' +
        '<span class="sc-fx" aria-hidden="true">fx</span>' +
        '<span class="sc-formula">' + esc(CFG.formulaText) + "</span>" +
        (dialog
          ? '<button type="button" class="sc-icon-btn" data-act="close" aria-label="Close">' + ICON.close + "</button>"
          : '<button type="button" class="sc-link-btn" data-act="hide">Hide</button>') +
      "</div>" +
      '<div class="sc-body">' +
        '<div class="sc-media">' +
          '<div class="sc-video">' +
            '<video muted loop playsinline preload="auto" poster="' + esc(v.poster) + '" aria-label="Export to Excel Enterprise overview video, no sound">' +
              '<source src="' + esc(v.webm) + '" type="video/webm">' +
              '<source src="' + esc(v.mp4) + '" type="video/mp4">' +
            "</video>" +
            '<button type="button" class="sc-play" data-act="play" aria-label="Play overview video" hidden>' + ICON.play + "</button>" +
          "</div>" +
          "<h1 class=\"sc-title\">" + esc(CFG.enterpriseName) + "</h1>" +
          '<p class="sc-intro">' + esc(CFG.intro) + "</p>" +
        "</div>" +
        '<div class="sc-panel">' +
          '<div class="sc-compare">' + comparisonHtml() + "</div>" +
          '<div class="sc-contact" hidden>' + contactFormHtml() + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="sc-actions">' +
        '<div class="sc-cta">' +
          '<button type="button" class="sc-primary" data-act="contact">' + ICON.mail + "<span>Contact us about Enterprise</span></button>" +
          '<span class="sc-note">A short form, right here.</span>' +
        "</div>" +
        '<div class="sc-side">' +
          '<span class="sc-user" hidden></span>' +
          (dialog
            ? '<label class="sc-optout"><input type="checkbox" data-act="optout"> Don\'t open this automatically</label>'
            : "") +
        "</div>" +
      "</div>";

    if (opts.toolbar) root.insertBefore(opts.toolbar, root.firstChild);

    setupVideo(root);
    renderUser(root);
    setupContactForm(root, opts);

    var optBox = root.querySelector('[data-act="optout"]');
    if (optBox) {
      optBox.checked = isOptedOut();
      optBox.addEventListener("change", function () { setOptOut(optBox.checked); });
    }

    root.addEventListener("click", function (e) {
      var el = e.target.closest("[data-act]");
      if (!el) return;
      var act = el.getAttribute("data-act");
      if (act === "close" && opts.onClose) opts.onClose();
      if (act === "hide" && opts.onHide) opts.onHide();
      if (act === "contact") {
        showContact(root, true);
        if (window.ETEIdentity) window.ETEIdentity.track("contact");
      }
      if (act === "back") showContact(root, false);
      if (act === "privacy") { try { window.open(CFG.privacyUrl, "_blank"); } catch (x) { /* ignore */ } }
      if (act === "signout" && window.ETEIdentity) { window.ETEIdentity.signOut(); renderUser(root); }
    });
  }

  /* "Signed in as …" with a way to switch email (shared computers). */
  function renderUser(root) {
    var el = root.querySelector(".sc-user");
    var email = window.ETEIdentity ? window.ETEIdentity.getEmail() : null;
    if (!email) { el.hidden = true; el.innerHTML = ""; return; }
    el.innerHTML = "Signed in as <strong>" + esc(email) + "</strong>" +
      '<button type="button" class="sc-link-btn" data-act="signout">Sign out</button>';
    el.hidden = false;
  }

  /* Muted autoplay. If the browser refuses (or the user prefers reduced
     motion), show the poster with a play button instead. Clicking the
     video toggles pause/play. */
  function setupVideo(root) {
    var video = root.querySelector("video");
    var playBtn = root.querySelector(".sc-play");
    video.muted = true;
    video.defaultMuted = true;

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function showPlay(on) { playBtn.hidden = !on; }
    function tryPlay() {
      var p = video.play();
      if (p && p.catch) p.catch(function () { showPlay(true); });
    }

    video.addEventListener("playing", function () { showPlay(false); });
    video.addEventListener("pause", function () { showPlay(true); });
    video.addEventListener("click", function () { video.paused ? tryPlay() : video.pause(); });
    playBtn.addEventListener("click", tryPlay);

    if (reduce) showPlay(true); else tryPlay();
  }

  /* ── Contact form ────────────────────────────────────────────────────── */
  function showContact(root, on) {
    root.querySelector(".sc-compare").hidden = on;
    root.querySelector(".sc-contact").hidden = !on;
    root.querySelector(".sc-cta").hidden = on;
    if (on) {
      var form = root.querySelector(".cf");
      var done = root.querySelector(".cf-done");
      if (!done.hidden) { done.hidden = true; form.hidden = false; form.reset(); }
      var email = form.querySelector("#cf-email");
      var known = window.ETEIdentity && window.ETEIdentity.getEmail();
      if (known && !email.value) email.value = known;
      var panel = root.querySelector(".sc-contact");
      if (panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
      var first = form.querySelector("#cf-name");
      setTimeout(function () { first.focus(); }, 0);
    }
  }

  /* ── Contact form validation ──────────────────────────────────────────
     Checked when a field is left (once something was typed) and again on
     Submit. Each problem is shown under its field; the first one gets focus. */
  var NAME_MSG = {
    name: { required: "Enter your full name.", too_short: "Enter your full name." },
    company: { required: "Enter your company name.", too_short: "Enter your company's full name." }
  };

  function nameProblem(value) {
    if (!value) return "required";
    if (value.length < 2 || !/[A-Za-z\u00C0-\uFFFF]/.test(value)) return "too_short";
    return null;
  }

  function setupContactForm(root, opts) {
    var form = root.querySelector(".cf");
    var done = root.querySelector(".cf-done");
    var formError = form.querySelector(".cf-form-error");
    var submit = form.querySelector(".cf-submit");
    var email = form.elements.email;
    var hint = form.querySelector("#cf-email-hint");
    var message = form.elements.message;
    var count = form.querySelector("#cf-message-count");
    var touched = {};
    var busy = false;

    function value(n) { return (form.elements[n] && form.elements[n].value || "").trim(); }

    function setFieldError(n, msg) {
      var f = form.querySelector('[data-field="' + n + '"]');
      var err = form.querySelector("#cf-" + n + "-err");
      f.classList.toggle("is-invalid", !!msg);
      form.elements[n].setAttribute("aria-invalid", msg ? "true" : "false");
      err.textContent = msg || "";
      err.hidden = !msg;
    }

    function showHint(suggestion) {
      if (!suggestion) { hint.hidden = true; hint.innerHTML = ""; return; }
      hint.innerHTML = 'Did you mean: <button type="button" class="si-inline-link cf-suggest" data-act="use-suggestion">' +
        esc(suggestion) + "</button>";
      hint.hidden = false;
    }

    /* Returns the error message for a field, or "" when it's fine. */
    function validate(n) {
      if (n === "name" || n === "company") {
        var p = nameProblem(value(n));
        return p ? NAME_MSG[n][p] : "";
      }
      if (n === "email") {
        var r = window.ETEEmail.check(value("email"), { requireWork: true });
        showHint(r.suggestion);
        return r.ok ? "" : window.ETEEmail.message(r.reason, { requireWork: true });
      }
      return "";
    }

    ["name", "email", "company"].forEach(function (n) {
      var el = form.elements[n];
      el.addEventListener("blur", function () {
        if (value(n)) touched[n] = true;
        if (touched[n]) setFieldError(n, validate(n));
      });
      el.addEventListener("input", function () {
        // Once shown, an error updates as they type and clears when fixed.
        if (touched[n]) setFieldError(n, validate(n));
        else if (n === "email") showHint(null);
      });
    });

    hint.addEventListener("click", function (e) {
      if (!e.target.closest('[data-act="use-suggestion"]')) return;
      email.value = e.target.textContent;
      touched.email = true;
      setFieldError("email", validate("email"));
      email.focus();
    });

    message.addEventListener("input", function () {
      count.textContent = message.value.length + " / " + MAX_MESSAGE;
      count.classList.toggle("is-near", message.value.length > MAX_MESSAGE * 0.9);
    });

    function showFormError(msg) { formError.textContent = msg || ""; formError.hidden = !msg; }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      showFormError("");

      var firstBad = null;
      ["name", "email", "company"].forEach(function (n) {
        touched[n] = true;
        var msg = validate(n);
        setFieldError(n, msg);
        if (msg && !firstBad) firstBad = n;
      });
      if (firstBad) { form.elements[firstBad].focus(); return; }

      var meta = opts.meta || {};
      var data = {
        name: value("name"), email: value("email"), company: value("company"),
        jobTitle: value("jobTitle"), teamSize: value("teamSize"), message: value("message"),
        website: value("website"),
        context: meta.context || "", tableauVersion: meta.tableauVersion || "",
        token: (window.ETEIdentity && window.ETEIdentity.getToken()) || undefined
      };

      busy = true;
      submit.disabled = true;
      submit.textContent = "Submitting…";
      window.ETEApi.post("/contact", data).then(function (r) {
        busy = false;
        submit.disabled = false;
        submit.textContent = "Submit";
        if (r.ok) {
          root.querySelector(".cf-done-msg").textContent =
            "We've received your request and will reply to " + data.email + ".";
          form.hidden = true;
          done.hidden = false;
          done.focus();
          return;
        }
        if (r.status === 400 && r.data.reasons) {
          // The server found a problem the browser didn't: show it on the field.
          var first = null;
          Object.keys(r.data.reasons).forEach(function (n) {
            var reason = r.data.reasons[n];
            var msg = n === "email" ? window.ETEEmail.message(reason === "too_short" ? "format" : reason, { requireWork: true })
              : (NAME_MSG[n] && NAME_MSG[n][reason]) || "Check this field.";
            if (form.elements[n]) { setFieldError(n, msg); if (!first) first = n; }
          });
          if (first) form.elements[first].focus();
        } else if (r.status === 429) {
          showFormError("We've already received several requests from you. Please try again later.");
        } else if (r.status === 0) {
          showFormError("We couldn't reach our server. Check your connection and try again.");
        } else {
          showFormError("Something went wrong on our side. Please try again.");
        }
      });
    });

    // Reset everything when the form is opened again later.
    form.addEventListener("reset", function () {
      touched = {};
      ["name", "email", "company"].forEach(function (n) { setFieldError(n, ""); });
      showHint(null);
      showFormError("");
      setTimeout(function () { count.textContent = "0 / " + MAX_MESSAGE; }, 0);
    });
  }

  window.ETEShowcase = {
    render: render,
    autoOpenDue: autoOpenDue,
    markAutoOpened: markAutoOpened,
    isOptedOut: isOptedOut,
    setOptOut: setOptOut
  };
})();
