import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import esbuild from "esbuild";

const outDir = path.resolve("dist/ui");
const outFile = path.join(outDir, "client.bundle.js");
const metaFile = path.join(outDir, "client.bundle.meta.json");

const result = await esbuild.build({
  entryPoints: ["src/ui/client/main.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  metafile: true,
  sourcemap: false,
  outfile: "client.bundle.js",
  logLevel: "silent",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

const outputFiles = result.outputFiles ?? [];
if (outputFiles.length !== 1) {
  throw new Error(`expected exactly one JavaScript output, received ${outputFiles.length}`);
}

const jsOutputs = Object.entries(result.metafile.outputs).filter(([, output]) => output.entryPoint);
if (jsOutputs.length !== 1) {
  throw new Error(`expected exactly one bundled entry output, received ${jsOutputs.length}`);
}

const [, metaOutput] = jsOutputs[0];
if (metaOutput.imports.length > 0) {
  throw new Error(`bundle has external imports: ${metaOutput.imports.join(", ")}`);
}

await mkdir(outDir, { recursive: true });
await writeFile(outFile, outputFiles[0].text);
await writeFile(metaFile, JSON.stringify(result.metafile));
