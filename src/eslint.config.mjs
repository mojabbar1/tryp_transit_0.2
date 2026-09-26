import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // Same file scope as the preset, which registers the react-hooks plugin only for these files
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // New in eslint-config-next 16 (React Compiler hook rules). It flags three existing
      // setState-in-effect patterns; fixing them changes behavior, which P0B forbids.
      // Kept visible as a warning; restore "error" once they're fixed (P0B follow-up).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
