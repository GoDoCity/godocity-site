/**
 * src/lib/vibeBoard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared rules for the Vibe Board (/[city]/vibe/). Imported by the page, the
 * submit Pages Function and the admin Function so the categories and length
 * limits can never drift apart. Keep in step with supabase/vibe_posts.sql.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const VIBE_CATEGORIES = [
  { value: "local-shoutout", label: "Local Shoutout", emoji: "📣" },
  { value: "good-news",      label: "Good News",      emoji: "🌞" },
  { value: "hidden-gem",     label: "Hidden Gem",     emoji: "💎" },
  { value: "kindness",       label: "Kindness Spotted", emoji: "🤝" },
];

export const VIBE_LIMITS = {
  name: 60,
  email: 254,
  messageMin: 10,
  messageMax: 600,
};

/** @param {string} value */
export function vibeCategory(value) {
  return VIBE_CATEGORIES.find((c) => c.value === value) ?? null;
}

/** Hero photo for cities without their own `vibeHeroImage` in cityConfigs.js. */
export const DEFAULT_VIBE_HERO = "/images/vibe-cafe-hero.webp";

/**
 * Public moderation contact for cities without their own `contactEmail` in
 * cityConfigs.js. Shown to readers only — submission notifications still go
 * to NOTIFY_EMAIL in functions/api/vibe-submit.js until the @godocity.com
 * mailboxes are live.
 */
export const DEFAULT_VIBE_CONTACT = "vibe@godocity.com";

/**
 * Community posting rules, worded for one city. Shown in the submit modal
 * (collapsed) and in full in the Guidelines & Moderation Policy dialog.
 * @param {string} cityName  display name, e.g. "Daytona Beach"
 */
export function vibeRules(cityName) {
  return [
    { title: "Keep it local & positive", body: `Share genuine shoutouts, local favorites, and good news in ${cityName}.` },
    { title: "Keep it kind", body: "Positive vibes only—no personal attacks, political debates, or rants." },
    { title: "Protect privacy", body: "First names or business names only—no phone numbers or home addresses." },
    { title: "No spam or campaigning", body: "Genuine shoutouts welcomed, but no commercial sales pitches or political ads." },
    { title: "Human reviewed", body: "Every post is read by a GoDo editor before going live." },
  ];
}
