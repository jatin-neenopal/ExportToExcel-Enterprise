// /*
//  * Calls to our own API (/api, same domain as these files).
//  * post() resolves { ok, status, data } and never rejects;
//  * status 0 means the request didn't get through (offline, blocked, timeout).
//  */
// (function () {
//   "use strict";

//   function post(path, body, opts) {
//     opts = opts || {};
//     var base = (window.ETE_CONFIG && window.ETE_CONFIG.apiBase) || "/api";
//     var ctrl = window.AbortController ? new AbortController() : null;
//     var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 15000) : null;
//     return fetch(base + path, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(body),
//       credentials: "omit",
//       cache: "no-store",
//       keepalive: !!opts.keepalive,
//       signal: ctrl ? ctrl.signal : undefined
//     }).then(function (res) {
//       return res.json().catch(function () { return {}; }).then(function (data) {
//         return { ok: res.ok, status: res.status, data: data || {} };
//       });
//     }, function () {
//       return { ok: false, status: 0, data: { error: "network" } };
//     }).then(function (r) {
//       if (timer) clearTimeout(timer);
//       return r;
//     });
//   }

//   window.ETEApi = { post: post };
// })();

// ==========================================

/*
 * Calls to our own API (/api, same domain as these files).
 * post() resolves { ok, status, data } and never rejects;
 * status 0 means the request didn't get through (offline, blocked, timeout).
 */
(function () {
  "use strict";

  function sameSite(base) {
    try { return new URL(base, window.location.href).origin === window.location.origin; } catch (e) { return true; }
  }

  function post(path, body, opts) {
    opts = opts || {};
    var base = (window.ETE_CONFIG && window.ETE_CONFIG.apiBase) || "/api";
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 15000) : null;
    return fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      // keepalive only for our own domain: browsers may refuse it across sites.
      keepalive: !!opts.keepalive && sameSite(base),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data || {} };
      });
    }, function (err) {
      // The browser hides the exact reason from the page; it is shown in the
      // console (F12) next to this line. Open diagnose.html to test each link.
      if (window.console) console.error("[Export to Excel] Could not reach " + base + path +
        " (" + (err && err.name) + "). Open diagnose.html on this site to find the cause.");
      return { ok: false, status: 0, data: { error: "network" } };
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    });
  }

  window.ETEApi = { post: post };
})();
