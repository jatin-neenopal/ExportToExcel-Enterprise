/*
 * Sign-in popup: email → access code → signed in.
 * Opened by the extension when Export is clicked and this browser isn't
 * signed in. On success it closes and the extension starts the export.
 */
(function () {
  "use strict";

  var CFG = window.ETE_CONFIG.signIn;
  var I = window.ETEIdentity;

  var WORK = !!CFG.requireWorkEmail;
  var E = window.ETEEmail;

  var MESSAGES = {
    invalid_email: E.message("format", { requireWork: WORK }),
    disposable_email: E.message("disposable", { requireWork: WORK }),
    personal_email: E.message("personal", { requireWork: true }),
    email_failed: "We couldn't send the email. Check the address and try again.",
    invalid_code_format: "Enter the 6-digit code from the email.",
    code_expired: "This code has expired or was already used. Send a new code.",
    too_many_attempts: "Too many wrong tries. Send a new code.",
    network: "Can't reach the sign-in service. Check your connection and try again.",
    fallback: "Something went wrong. Please try again."
  };

  function messageFor(r) {
    var d = r.data || {};
    if (r.status === 0) return MESSAGES.network;
    if (d.error === "wrong_code") {
      return "That code isn't right. " + d.attemptsLeft + (d.attemptsLeft === 1 ? " try" : " tries") + " left.";
    }
    if (d.error === "resend_too_soon") return "Please wait " + d.retryAfter + " seconds before asking for another code.";
    if (d.error === "rate_limited") {
      var mins = Math.max(1, Math.ceil((d.retryAfter || 60) / 60));
      return "Too many requests. Try again in " + mins + (mins === 1 ? " minute." : " minutes.");
    }
    return MESSAGES[d.error] || MESSAGES.fallback;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var $ = function (id) { return document.getElementById(id); };
    var stepEmail = $("step-email"), stepCode = $("step-code"), stepDone = $("step-done");
    var email = $("email"), code = $("code"), hint = $("email-hint");
    var emailTouched = false;

    if (WORK) {
      $("email-label").textContent = "Work email";
      $("email-lead").textContent = "Enter your work email and we'll send you a 6-digit access code.";
    }

    function showHint(suggestion) {
      if (!suggestion) { hint.hidden = true; hint.innerHTML = ""; return; }
      hint.innerHTML = 'Did you mean: <button type="button" class="si-inline-link cf-suggest" id="use-suggestion"></button>';
      hint.querySelector("button").textContent = suggestion;
      hint.hidden = false;
    }

    /* "" when the address is fine, else the message to show under the field. */
    function emailProblem() {
      var r = E.check(email.value, { requireWork: WORK });
      showHint(r.suggestion);
      return r.ok ? "" : E.message(r.reason, { requireWork: WORK });
    }

    email.addEventListener("blur", function () {
      if (email.value.trim()) emailTouched = true;
      if (emailTouched) setError("email-err", emailProblem());
    });
    hint.addEventListener("click", function (e) {
      if (e.target.id !== "use-suggestion") return;
      email.value = e.target.textContent;
      emailTouched = true;
      setError("email-err", emailProblem());
      email.focus();
    });
    var send = $("send"), verify = $("verify"), resend = $("resend"), resendWait = $("resend-wait");
    var inTableau = false;
    var meta = {};
    var currentEmail = "";
    var busy = false;
    var waitTimer = null;

    function close(result) {
      if (inTableau) {
        try { tableau.extensions.ui.closeDialog(result || "cancel"); return; } catch (e) { /* fall through */ }
      }
      window.close();
    }

    function setError(id, msg) {
      var el = $(id);
      el.textContent = msg || "";
      el.hidden = !msg;
      var input = id === "email-err" ? email : code;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    }

    function setBusy(btn, on, label) {
      busy = on;
      btn.disabled = on;
      if (label) btn.textContent = label;
    }

    function show(step) {
      stepEmail.hidden = step !== "email";
      stepCode.hidden = step !== "code";
      stepDone.hidden = step !== "done";
      if (step === "email") email.focus();
      if (step === "code") code.focus();
    }

    function startResendWait(seconds) {
      clearInterval(waitTimer);
      var left = seconds;
      resend.hidden = true;
      resendWait.hidden = false;
      resendWait.textContent = "send a new code in " + left + "s";
      waitTimer = setInterval(function () {
        left -= 1;
        if (left <= 0) {
          clearInterval(waitTimer);
          resend.hidden = false;
          resendWait.hidden = true;
        } else {
          resendWait.textContent = "send a new code in " + left + "s";
        }
      }, 1000);
    }

    function requestCode(fromResend) {
      var value = email.value.trim();
      emailTouched = true;
      var problem = emailProblem();
      if (problem) {
        setError("email-err", problem);
        if (fromResend) { setError("code-err", problem); } else { email.focus(); }
        return;
      }
      setError("email-err", "");
      setError("code-err", "");
      var btn = fromResend ? resend : send;
      var original = btn.textContent;
      setBusy(btn, true, fromResend ? "sending…" : "Sending code…");
      I.requestCode(value).then(function (r) {
        setBusy(btn, false, original);
        if (r.ok) {
          currentEmail = value;
          $("sent-to").textContent = value;
          code.value = "";
          show("code");
          startResendWait(r.data.resendAfter || 30);
          if (fromResend) setError("code-err", "");
          return;
        }
        if (fromResend) {
          setError("code-err", messageFor(r));
          if (r.data && r.data.error === "resend_too_soon") startResendWait(r.data.retryAfter);
        } else if (r.data && r.data.error === "resend_too_soon") {
          // A code was sent moments ago: go straight to entering it.
          currentEmail = value;
          $("sent-to").textContent = value;
          show("code");
          startResendWait(r.data.retryAfter);
        } else {
          setError("email-err", messageFor(r));
        }
      });
    }

    function verifyCode() {
      if (busy) return;
      var value = code.value.replace(/\D/g, "");
      if (value.length !== (CFG.codeLength || 6)) {
        setError("code-err", MESSAGES.invalid_code_format);
        code.focus();
        return;
      }
      setError("code-err", "");
      setBusy(verify, true, "Verifying…");
      I.verifyCode(currentEmail, value, meta).then(function (r) {
        if (r.ok) {
          verify.textContent = "Signed in";
          if (inTableau) {
            close(JSON.stringify({ email: r.data.email }));
          } else {
            $("done-msg").textContent = "Signed in as " + r.data.email + ". You can close this window.";
            show("done");
          }
          return;
        }
        setBusy(verify, false, "Verify and export");
        setError("code-err", messageFor(r));
        code.select();
      });
    }

    stepEmail.addEventListener("submit", function (e) { e.preventDefault(); if (!busy) requestCode(false); });
    stepCode.addEventListener("submit", function (e) { e.preventDefault(); verifyCode(); });
    resend.addEventListener("click", function () { if (!busy) requestCode(true); });
    $("change").addEventListener("click", function () {
      clearInterval(waitTimer);
      setError("code-err", "");
      show("email");
      email.select();
    });

    email.addEventListener("input", function () {
      if (emailTouched) setError("email-err", emailProblem());
      else showHint(null);
    });
    code.addEventListener("input", function () {
      setError("code-err", "");
      var digits = code.value.replace(/\D/g, "").slice(0, CFG.codeLength || 6);
      if (code.value !== digits) code.value = digits;
      if (digits.length === (CFG.codeLength || 6)) verifyCode(); // submit when complete
    });

    $("close").addEventListener("click", function () { close("cancel"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close("cancel"); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-privacy]"), function (b) {
      b.addEventListener("click", function () { try { window.open(window.ETE_CONFIG.privacyUrl, "_blank"); } catch (e) { /* ignore */ } });
    });

    show("email");

    if (window.tableau && tableau.extensions && tableau.extensions.initializeDialogAsync) {
      tableau.extensions.initializeDialogAsync().then(function (payload) {
        inTableau = true;
        try { meta = JSON.parse(payload || "{}"); } catch (e) { meta = {}; }
      }, function () { /* opened directly in a browser */ });
    }
  });
})();
