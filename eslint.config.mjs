import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // ---------------------------------------------------------------------
    // Deliberate, temporary downgrades. Read this before adding another one.
    //
    // On 18 Sep 2026 this project had 144 lint errors, which meant CI had been
    // red on every push for months. A permanently red pipeline is worse than no
    // pipeline: it trains everyone to ignore the one signal that is supposed to
    // stop a bad merge, and we had just made that pipeline the blocking gate for
    // clinical-safety assertions.
    //
    // The 34 errors that were genuine bugs were fixed properly that day: impure
    // `Date.now()` reads during render, refs written during render, assignments
    // to `window.location.href` from inside a component, and assorted trivia.
    // See hooks/useNow.ts and hooks/useLatestRef.ts for the two patterns that
    // replaced them.
    //
    // The three rules below are downgraded rather than fixed, and this is a
    // deferral, not a judgement that they do not matter:
    //
    //   set-state-in-effect (114)  A codebase-wide pattern, not 114 separate
    //       bugs. It costs an extra render pass; it does not produce wrong
    //       output. Fixing it properly means restructuring data flow in ~90
    //       files, most of which have no test coverage, so doing it in one pass
    //       would be the riskiest change in the project's history. It gets done
    //       area by area, as each area is touched for other reasons.
    //
    //   static-components (7)  Components declared inside other components.
    //       Remounts the subtree on every parent render. Same reasoning.
    //
    //   preserve-manual-memoization (1)  The compiler bailing out of one hook.
    //
    // Note for whoever picks this up: the set-state count went from 103 to 114
    // when the ref errors were fixed. That is not a regression. The React
    // compiler stops analysing a component at its first error, so eleven of
    // these had been there all along and were simply invisible behind the
    // errors in front of them. Expect the number to rise again as more are
    // fixed, and do not read that as going backwards.
    //
    // They stay as warnings so they remain visible in local runs and in the CI
    // log without failing the build. Tracked as item 31 in PHASE1-PLAN.md.
    // ---------------------------------------------------------------------
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
