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
