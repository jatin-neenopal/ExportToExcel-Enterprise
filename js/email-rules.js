/*
 * Email checks in the browser, for instant feedback. The server runs the
 * same rules (backend/src/email-rules.mjs) and has the final say.
 * The two domain lists must match the server's (a backend test checks this).
 */
(function () {
  "use strict";

  var FREE_DOMAINS = [
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "yahoo.in", "ymail.com",
    "rocketmail.com", "hotmail.com", "hotmail.co.uk", "hotmail.in", "outlook.com", "outlook.in", "live.com",
    "live.in", "msn.com", "aol.com", "aim.com", "icloud.com", "me.com", "mac.com", "protonmail.com",
    "proton.me", "pm.me", "zohomail.com", "zohomail.in", "mail.com", "email.com", "gmx.com", "gmx.net",
    "gmx.de", "web.de", "yandex.com", "yandex.ru", "mail.ru", "rediffmail.com", "rediff.com", "qq.com",
    "163.com", "126.com", "hey.com", "fastmail.com", "tutanota.com", "tuta.io", "inbox.com", "seznam.cz",
    "libero.it", "orange.fr", "t-online.de", "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
    "btinternet.com"
  ];

  var DISPOSABLE_DOMAINS = [
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
    "10minutemail.net", "tempmail.com", "tempmail.net", "temp-mail.org", "temp-mail.io", "throwawaymail.com",
    "yopmail.com", "yopmail.net", "getnada.com", "nada.email", "trashmail.com", "trashmail.de",
    "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com", "mohmal.com", "emailondeck.com",
    "fakeinbox.com", "mailcatch.com", "spamgourmet.com", "tempinbox.com", "moakt.com", "burnermail.io",
    "tempr.email", "discard.email", "mailpoof.com", "inboxkitten.com", "getairmail.com", "fakemail.net",
    "tmail.ws", "emailfake.com", "spambox.us", "mytemp.email", "tmpmail.org", "tmpmail.net",
    "minuteinbox.com", "mail.tm", "mail.gw"
  ];

  // Common misspellings: suggest the provider people most likely meant.
  var POPULAR = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "aol.com",
    "protonmail.com", "rediffmail.com", "yahoo.co.in", "outlook.in", "hotmail.co.uk", "yahoo.co.uk"];
  // Misspelled endings that are never real (".con" for ".com").
  var TLD_FIX = { con: "com", cmo: "com", ocm: "com", cpm: "com", vom: "com", xom: "com", comm: "com",
    coom: "com", cim: "com", nte: "net", ner: "net", ogr: "org", rog: "org", orgg: "org" };

  var FREE = toSet(FREE_DOMAINS), DISPOSABLE = toSet(DISPOSABLE_DOMAINS);
  var LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
  var LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  var TLD_RE = /^[a-z]{2,24}$|^xn--[a-z0-9-]{1,59}$/;

  function toSet(a) { var o = {}; a.forEach(function (d) { o[d] = true; }); return o; }

  function inList(domain, set) {
    if (set[domain]) return true;
    for (var i = domain.indexOf("."); i !== -1; i = domain.indexOf(".", i + 1)) {
      if (set[domain.slice(i + 1)]) return true;
    }
    return false;
  }

  function isValidFormat(email) {
    if (typeof email !== "string" || email.length > 254) return false;
    var at = email.lastIndexOf("@");
    if (at < 1 || at !== email.indexOf("@")) return false;
    var local = email.slice(0, at), domain = email.slice(at + 1).toLowerCase();
    if (local.length > 64 || !LOCAL_RE.test(local)) return false;
    var labels = domain.split(".");
    if (labels.length < 2) return false;
    for (var i = 0; i < labels.length - 1; i++) if (!LABEL_RE.test(labels[i])) return false;
    return TLD_RE.test(labels[labels.length - 1]);
  }

  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /* The address the person most likely meant, or null. */
  function suggest(email) {
    var e = String(email || "").trim();
    var at = e.lastIndexOf("@");
    if (at < 1) return null;
    var local = e.slice(0, at), domain = e.slice(at + 1).toLowerCase();
    if (!domain || POPULAR.indexOf(domain) !== -1) return null;
    var best = null, bestD = 3;
    POPULAR.forEach(function (p) {
      var d = distance(domain, p);
      if (d > 0 && d < bestD && domain.length >= 6) { best = p; bestD = d; }
    });
    if (best) return local + "@" + best;
    var parts = domain.split("."), tld = parts[parts.length - 1];
    if (parts.length > 1 && TLD_FIX[tld]) {
      parts[parts.length - 1] = TLD_FIX[tld];
      return local + "@" + parts.join(".");
    }
    return null;
  }

  /*
   * check(email, { requireWork }) → { ok, reason, suggestion }
   *   reason: "required" | "format" | "typo" | "disposable" | "personal" | null
   *   "typo" blocks: the ending can't be right (".con"). A likely misspelling
   *   of a known provider ("gmial.com") is a hint only, unless work emails
   *   are required, where it is treated as a personal address.
   */
  function check(email, opts) {
    opts = opts || {};
    var e = String(email || "").trim().toLowerCase();
    if (!e) return { ok: false, reason: "required", suggestion: null };
    if (!isValidFormat(e)) return { ok: false, reason: "format", suggestion: null };
    var domain = e.slice(e.indexOf("@") + 1);
    var tld = domain.slice(domain.lastIndexOf(".") + 1);
    var hint = suggest(e);
    if (TLD_FIX[tld]) return { ok: false, reason: "typo", suggestion: hint };
    if (inList(domain, DISPOSABLE)) return { ok: false, reason: "disposable", suggestion: null };
    if (opts.requireWork) {
      if (inList(domain, FREE)) return { ok: false, reason: "personal", suggestion: null };
      if (hint && inList(hint.slice(hint.indexOf("@") + 1), FREE)) return { ok: false, reason: "personal", suggestion: null };
    }
    return { ok: true, reason: null, suggestion: hint };
  }

  /* Messages, written to say what's wrong and how to fix it. */
  function message(reason, opts) {
    opts = opts || {};
    return {
      required: "Enter your " + (opts.requireWork ? "work " : "") + "email address.",
      format: "Enter an email address in the correct format, like name@company.com.",
      typo: "Check the end of your email address.",
      disposable: "Temporary email addresses can't be used. Enter your " + (opts.requireWork ? "work" : "usual") + " email.",
      personal: "Enter your work email. Personal addresses like Gmail or Yahoo can't be used."
    }[reason] || "";
  }

  window.ETEEmail = {
    check: check,
    suggest: suggest,
    message: message,
    isValidFormat: isValidFormat,
    FREE_DOMAINS: FREE_DOMAINS,
    DISPOSABLE_DOMAINS: DISPOSABLE_DOMAINS
  };
})();
