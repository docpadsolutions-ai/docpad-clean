import type { Config } from "tailwindcss";

/** IPD Inpatient Encounter (Figma) — use with `dark:` utilities only where noted. */
const config = {
  theme: {
    extend: {
      colors: {
        tscolors: {
          soap: {
            subjective: "#3B82F6",
            objective: "#10B981",
            assessment: "#8B5CF6",
          },
          surface: {
            DEFAULT: "#0F1117",
            card: "#1A1D27",
            elevated: "#22263A",
          },
        },
      },
    },
  },
} satisfies Config;

export default config;
