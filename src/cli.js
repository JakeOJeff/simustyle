import { readFile } from "node:fs/promises";
import { parseSceneRequest } from "./openai.js";

function usage() {
  return `Usage: npm run parse -- "<scene request>" [--scene path/to/scene.json]

Environment:
  OPENAI_API_KEY   Required API key (never stored by this project)
  OPENAI_MODEL     Optional model override (default: gpt-4.1-mini)
  OPENAI_BASE_URL  Optional API base URL override

Example:
  npm run parse -- "A colorful tower of blocks with a wrecking ball"`;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }

  const promptParts = [];
  let scene = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--scene") {
      const path = args[i + 1];
      if (!path) throw new Error("--scene requires a JSON file path.");
      scene = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(scene)) throw new Error("The scene file must contain a JSON array.");
      i += 1;
    } else if (args[i].startsWith("--")) {
      throw new Error(`Unknown option: ${args[i]}\n\n${usage()}`);
    } else {
      promptParts.push(args[i]);
    }
  }

  const result = await parseSceneRequest({ prompt: promptParts.join(" "), scene });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`Parse failed: ${error.message}`);
  if (error.validationErrors) console.error(JSON.stringify(error.validationErrors, null, 2));
  process.exitCode = 1;
});
