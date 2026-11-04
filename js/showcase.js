/*
 * Showcase popup (opened by the extension with displayDialogAsync).
 * Also works when opened directly in a browser, for previewing.
 *
 * In Tableau Cloud/Server this popup doesn't share browser storage with the
 * extension, so the extension sends the session and the "don't open
 * automatically" choice in, and the popup sends them back when it closes.
 */
(function () {
  "use strict";

  var I = window.ETEIdentity;
  var S = window.ETEShowcase;

  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("showcase");
    var params = new URLSearchParams(window.location.search);
    var meta = { context: params.get("context") || "", tableauVersion: "" };
    var inTableau = false;
    var rendered = false;

    function close() {
      if (inTableau) {
        try {
          tableau.extensions.ui.closeDialog(JSON.stringify({
            session: I.getSession(),       // null if they signed out here
            optOut: S.isOptedOut()
          }));
          return;
        } catch (e) { /* fall through */ }
      }
      window.close();
    }

    function render() {
      if (rendered) return;
      rendered = true;
      S.render(root, { mode: "dialog", meta: meta, onClose: close });
    }

    document.addEventListener("keydown", function (e) {
      // Esc closes the popup, but not while typing in the contact form.
      if (e.key === "Escape" && !(e.target && e.target.closest && e.target.closest(".cf"))) close();
    });

    if (window.tableau && tableau.extensions && tableau.extensions.initializeDialogAsync) {
      // Wait for the extension's message before drawing, so the signed-in
      // line and the checkbox are right from the start.
      tableau.extensions.initializeDialogAsync().then(function (payload) {
        inTableau = true;
        try {
          var p = JSON.parse(payload || "{}");
          if (p.context) meta.context = p.context;
          if (p.tableauVersion) meta.tableauVersion = p.tableauVersion;
          if ("session" in p) I.adopt(p.session);
          if (typeof p.optOut === "boolean") S.setOptOut(p.optOut);
        } catch (e) { /* ignore */ }
        render();
      }, render);
      setTimeout(render, 2000); // opened outside Tableau: show it anyway
    } else {
      render();
    }
  });
})();
