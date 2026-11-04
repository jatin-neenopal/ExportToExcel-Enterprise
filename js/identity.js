/*
 * Sign-in with an emailed access code.
 *
 * 1. requestCode(email)  → the API emails a 6-digit code
 * 2. verifyCode(email, code) → the API returns a session token
 * 3. The token is kept in this browser (localStorage), so the person isn't
 *    asked again on this browser until it expires or they sign out.
 *
 * The browser never sees or stores the code itself, and the API stores only
 * a hash of the token.
 */
(function () {
  "use strict";

  var CFG = window.ETE_CONFIG.signIn;
  var KEY = "ete.session";
  var OLD_KEYS = ["ete.user.email", "ete.user.pending"]; // from the earlier unverified version

  function read() {
    try {
      var s = JSON.parse(window.localStorage.getItem(KEY) || "null");
      return s && typeof s.token === "string" && typeof s.expiresAt === "number" ? s : null;
    } catch (e) { return null; }
  }
  function write(s) { try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function clear() { try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  OLD_KEYS.forEach(function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } });

  function session() {
    var s = read();
    if (s && s.expiresAt <= Date.now()) { clear(); return null; }
    return s;
  }

  function isValidEmail(v) {
    v = String(v || "").trim();
    return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  var post = window.ETEApi.post;

  function requestCode(email) {
    return post("/auth/start", { email: String(email).trim() });
  }

  function verifyCode(email, code, meta) {
    meta = meta || {};
    return post("/auth/verify", {
      email: String(email).trim(),
      code: String(code).replace(/\s/g, ""),
      context: meta.context || "",
      tableauVersion: meta.tableauVersion || ""
    }).then(function (r) {
      if (r.ok && r.data.token) {
        write({ token: r.data.token, email: r.data.email, expiresAt: r.data.expiresAt });
      }
      return r;
    });
  }

  /* On load: confirm the saved session with the API (also records "last
     seen"). Only a clear "invalid" answer signs the person out; if the API
     can't be reached, the saved session is kept so export keeps working. */
  function checkSession(meta) {
    var s = session();
    if (!s) return Promise.resolve(false);
    meta = meta || {};
    return post("/session", { token: s.token, context: meta.context || "", tableauVersion: meta.tableauVersion || "" })
      .then(function (r) {
        if (r.status === 401) { clear(); return false; }
        return true;
      });
  }

  /* Usage counters for the sales team: "export" and "contact". Best effort. */
  function track(type) {
    var s = session();
    if (!s) return;
    post("/event", { token: s.token, type: type }, { keepalive: true, timeoutMs: 8000 });
  }

  function signOut() {
    var s = session();
    clear();
    if (s) post("/signout", { token: s.token }, { keepalive: true, timeoutMs: 8000 });
  }

  window.ETEIdentity = {
    isValidEmail: isValidEmail,
    isSignedIn: function () { return !CFG.required || !!session(); },
    getEmail: function () { var s = session(); return s ? s.email : null; },
    getToken: function () { var s = session(); return s ? s.token : null; },
    requestCode: requestCode,
    verifyCode: verifyCode,
    checkSession: checkSession,
    track: track,
    signOut: signOut
  };
})();
