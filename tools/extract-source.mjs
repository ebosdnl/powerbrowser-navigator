import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { outputFile, sourceLayout } from "./source-layout.mjs";

const source = await readFile(outputFile, "utf8");
const lines = source.match(/.*(?:\r\n|\n|\r|$)/g).filter(Boolean);

if (lines.length !== sourceLayout.at(-1)[2]) {
  throw new Error(
    `Expected ${sourceLayout.at(-1)[2]} lines in ${outputFile}, found ${lines.length}. ` +
      "Update tools/source-layout.mjs before extracting a changed bundle."
  );
}

for (const [file, firstLine, lastLine] of sourceLayout) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, lines.slice(firstLine - 1, lastLine).join(""));
  console.log(`Extracted ${file} (${firstLine}-${lastLine})`);
}
