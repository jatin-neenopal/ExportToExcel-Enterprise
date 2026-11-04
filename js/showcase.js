/*
 * Showcase popup (opened by the extension with displayDialogAsync).
 * Also works when opened directly in a browser, for previewing.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("showcase");
    var params = new URLSearchParams(window.location.search);
    var meta = { context: params.get("context") || "", tableauVersion: "" };
    var inTableau = false;

    function close() {
      if (inTableau) {
        try { tableau.extensions.ui.closeDialog("closed"); return; } catch (e) { /* fall through */ }
      }
      window.close();
    }

    window.ETEShowcase.render(root, { mode: "dialog", meta: meta, onClose: close });

    document.addEventListener("keydown", function (e) {
      // Esc closes the popup, but not while typing in the contact form.
      if (e.key === "Escape" && !(e.target && e.target.closest && e.target.closest(".cf"))) close();
    });

    if (window.tableau && tableau.extensions && tableau.extensions.initializeDialogAsync) {
      tableau.extensions.initializeDialogAsync().then(function (payload) {
        inTableau = true;
        try {
          var p = JSON.parse(payload || "{}");
          if (p.context) meta.context = p.context;
          if (p.tableauVersion) meta.tableauVersion = p.tableauVersion;
        } catch (e) { /* ignore */ }
      }, function () { /* preview outside Tableau */ });
    }
  });
})();
