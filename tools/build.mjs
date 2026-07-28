import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { outputFile, sourceLayout } from "./source-layout.mjs";

const checkOnly = process.argv.includes("--check");
const parts = await Promise.all(
  sourceLayout.map(async ([file]) => {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      throw new Error(`Unable to read build input ${file}`, { cause: error });
    }
  })
);
const bundle = parts.join("");

if (checkOnly) {
  const current = await readFile(outputFile, "utf8");
  if (current !== bundle) {
    throw new Error(
      `${outputFile} is out of date. Run "npm run build" and commit the result.`
    );
  }
  console.log(`${outputFile} is up to date.`);
} else {
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, bundle);
  console.log(`Built ${outputFile} from ${sourceLayout.length} source files.`);
}
