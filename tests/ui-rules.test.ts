import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(?:ts|tsx|js|jsx|html)$/.test(entry.name) ? [path] : [];
  });
}

it("audits UI source for banned legacy and unsafe DOM APIs", () => {
  const clientRoot = resolve(process.cwd(), "client");
  const paths = [...sourceFiles(resolve(clientRoot, "src")), resolve(clientRoot, "index.html")];
  const rules: Array<[string, RegExp]> = [
    ["var declarations", /\bvar\b/],
    ["raw innerHTML usage", /\binnerHTML\b/],
    ["inline event handlers", /\bon[a-z][a-z0-9_-]*\s*=/i],
    ["deprecated keyCode", /\bkeyCode\b/],
    ["document.write", /\bdocument\s*\.\s*write\s*\(/],
    ["eval", /\beval\s*\(/],
    ["Function constructor", /\bFunction\s*\(/]
  ];
  const violations = paths.flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return rules
      .filter(([, pattern]) => pattern.test(source))
      .map(([name]) => `${path}: ${name}`);
  });
  const tsconfig = JSON.parse(readFileSync(resolve(process.cwd(), "tsconfig.json"), "utf8")) as {
    compilerOptions?: { strict?: boolean };
  };

  expect(tsconfig.compilerOptions?.strict, "strict TypeScript catches implicit undeclared names").toBe(true);
  expect(violations).toEqual([]);
});
