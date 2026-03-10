/** @type {import('tailwindcss').Config} */
export default {
  // Required for shadcn dark-mode class strategy
  darkMode: ["class"],

  // Content paths scanned by shadcn CLI when adding components
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],

  // Colors, border radius, and fonts are configured via @theme inline
  // in src/styles/globals.css — the native Tailwind v4 approach.
  plugins: [],
};
