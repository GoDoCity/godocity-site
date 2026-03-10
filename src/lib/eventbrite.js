/**
 * src/lib/eventbrite.js
 *
 * Utility constants for the events feed.
 * Eventbrite API integration has been removed — events are sourced from
 * static markdown files in src/content/events/ and the submit-event form.
 */

/** Hardcoded fallback images keyed by internal category name. */
export const CATEGORY_FALLBACK = {
  "Music & Nightlife":    "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=75",
  "Food & Drink":         "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=75",
  "Arts & Culture":       "https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=800&q=75",
  "Markets & Fairs":      "https://images.unsplash.com/photo-1488459716781-0a04a8a37e6e?w=800&q=75",
  "Racing & Motorsports": "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800&q=75",
  "Outdoors & Sports":    "https://images.unsplash.com/photo-1530549387789-4c161668b269?w=800&q=75",
  "default":              "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=75",
};
