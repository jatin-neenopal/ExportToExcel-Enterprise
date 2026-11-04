/*
 * Export to Excel Enterprise: settings.
 * Plain data only; change links, video or wording here without touching code.
 */
window.ETE_CONFIG = {
  enterpriseName: "Export to Excel Enterprise",

  /* The API is served from the same domain as these files (CloudFront
     routes /api/* to it), so this path never needs to change. */
  apiBase: "https://definition-category-founded-switch.trycloudflare.com/api",

  privacyUrl: "https://www.neenopal.com/privacy-policy",

  /* Sign-in with an emailed access code. */
  signIn: {
    required: true,
    // false = any real email can sign in; true = work emails only.
    // Must match the RequireWorkEmailForSignIn setting on AWS.
    requireWorkEmail: false,
    codeLength: 6,
    dialog: { width: 460, height: 460 }
  },

  /* "Contact us about Enterprise": a form inside the extension. Requests are
     saved in our database (and emailed to sales if that is set up on AWS). */
  contact: {
    title: "Talk to us about Enterprise",
    lead: "Tell us a little about your team and we'll reply by email.",
    teamSizes: ["1-10", "11-50", "51-200", "201-1000", "1000+"],
    messagePlaceholder: "For example: how many dashboards you export, and how often",
    note: "By submitting, you agree that NeenOpal may contact you about your request."
  },

  /* Showcase video. Plays muted and loops. WebM first: Tableau Desktop's
     built-in browser may not play MP4 (H.264). When you replace the video,
     use new file names (v2, v3...) so browsers don't show a cached copy. */
  video: {
    webm: "assets/showcase-v1.webm",
    mp4: "assets/showcase-v1.mp4",
    poster: "assets/showcase-v1-poster.jpg"
  },

  /* In small zones the showcase opens in a Tableau popup on its own,
     at most once per cooldown period per browser. */
  autoOpen: { enabled: true, cooldownDays: 7, delayMs: 1200 },
  dialog: { width: 860, height: 640 },

  /* Zones at least this big show the showcase inside the zone. */
  inlineMinSize: { width: 640, height: 420 },

  intro:
    "Enterprise turns whole workbooks into finished Excel files. Charts stay " +
    "charts, every dashboard gets its own sheet, and the formatting matches " +
    "what you see in Tableau. You're using the free edition, which exports " +
    "the dashboard you're on.",

  formulaText: "Everything in the free edition, plus native charts, every dashboard and full formatting",

  /* Free vs Enterprise. true = included, false = not included, text = shown as written. */
  comparison: [
    { feature: "Export the sheets on this dashboard", free: true, enterprise: true },
    { feature: "Every dashboard in one workbook, one sheet each", free: false, enterprise: true },
    { feature: "Charts exported as native, editable Excel charts", free: false, enterprise: true },
    { feature: "Tableau colors, fonts, titles and layout", free: "Basic", enterprise: "Full" },
    { feature: "Hosted on your own server, with an SLA", free: false, enterprise: true }
  ]
};
