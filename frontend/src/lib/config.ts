/**
 * template.config.ts - central brand and feature configuration.
 *
 * All brand strings, colors, and feature flags live here.
 * Override any value via environment variables (see .env.example).
 *
 * To rebrand: update VITE_APP_NAME, VITE_APP_URL, VITE_SUPPORT_EMAIL,
 * and swap the logo files in /public.
 */

export const config = {
  appName: import.meta.env.VITE_APP_NAME ?? "FieldStack",
  appUrl: import.meta.env.VITE_APP_URL ?? "http://localhost:5173",
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL ?? "support@example.com",

  brand: {
    // HSL values used in index.css CSS variables
    primaryColor: import.meta.env.VITE_BRAND_PRIMARY_COLOR ?? "220 70% 50%",
    gradientStart: import.meta.env.VITE_BRAND_GRADIENT_START ?? "220 70% 50%",
    gradientEnd: import.meta.env.VITE_BRAND_GRADIENT_END ?? "200 80% 50%",
  },

  features: {
    googleAuth: true,
    emailAuth: true,
    billing: true,
    adminPanel: true,
  },
} as const;
