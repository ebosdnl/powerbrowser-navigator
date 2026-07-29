import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { build } from "esbuild";
import { outputFile, sourceLayout } from "./source-layout.mjs";

const checkOnly = process.argv.includes("--check");
const normalizeLineEndings = (source) => source.replace(/\r\n?/g, "\n");
const metadata = normalizeLineEndings(
  await readFile("src/metadata.user.js", "utf8"),
);
const css = normalizeLineEndings(
  await readFile("src/styles/power-browser.css", "utf8"),
);
const coreBuild = await build({
  entryPoints: ["src/core/index.js"],
  bundle: true,
  format: "iife",
  globalName: "PowerBrowserCore",
  platform: "browser",
  target: ["es2020"],
  write: false,
  minify: false,
  footer: {
    js: "globalThis.PowerBrowserCore = PowerBrowserCore;",
  },
});
const parts = await Promise.all(
  sourceLayout.map(async (file) => {
    try {
      return normalizeLineEndings(await readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read build input ${file}`, { cause: error });
    }
  }),
);
const escapedCss = JSON.stringify(css);
const bundle = normalizeLineEndings(
  [
    metadata,
    "\n",
    coreBuild.outputFiles[0].text,
    "\nGM_addStyle(",
    escapedCss,
    ");\n",
    ...parts,
  ].join(""),
);

if (checkOnly) {
  const current = await readFile(outputFile, "utf8");
  if (current !== bundle) {
    throw new Error(
      `${outputFile} is out of date. Run "npm run build" and commit the result.`,
    );
  }
  console.log(`${outputFile} is up to date.`);
} else {
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, bundle);
  console.log(`Built ${outputFile} from ${sourceLayout.length} source files.`);
}
