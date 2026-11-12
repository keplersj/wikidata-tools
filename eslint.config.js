import tseslint from "typescript-eslint";

const noClockOrNetwork = [
  { name: "Date", message: "The engine takes the run date as an input; it never reads a clock." },
  { name: "fetch", message: "The engine makes no network calls." },
  { name: "XMLHttpRequest", message: "The engine makes no network calls." },
  { name: "window", message: "No DOM in the engine." },
  { name: "document", message: "No DOM in the engine." },
  { name: "navigator", message: "No DOM in the engine." },
  { name: "process", message: "No Node globals in the engine." },
];

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.stryker-tmp/**", "**/reports/**", "**/.wrangler/**", "**/coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Output must be deterministic." },
      ],
    },
  },
  {
    // Engine purity, enforced mechanically.
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...noClockOrNetwork],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: "Use cmp(): localeCompare makes output locale-dependent.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString']",
          message: "Output must not depend on locale.",
        },
      ],
    },
  },
);
