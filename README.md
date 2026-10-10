# SimuStyle Scene Agent

SimuStyle turns a plain-language request into JSON operations for a 3D simulation scene. It supports creating, updating, and deleting scene objects, uses the OpenAI Responses API for generation, and rejects output that fails local scene validation.

The project is an API and command-line demo. It does not include a simulator, renderer, or visual editor. Scene operations are returned for a host simulation to apply.

## Requirements

- Node.js 20 or newer
- An OpenAI API key with access to the selected model
- No npm packages are required

## Configure

Set the API key in the current shell. The key is read from the environment and is never saved by this app.

PowerShell:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-4.1-mini" # optional
```

Bash:

```bash
export OPENAI_API_KEY="your-key"
export OPENAI_MODEL="gpt-4.1-mini" # optional
```

`OPENAI_BASE_URL` can override the default API root for compatible endpoints. Do not commit API keys.

## Run the CLI

```sh
npm run parse -- "A colorful tower of blocks that a wrecking ball swings into"
```

The CLI prints one JSON object containing a summary and operations. To include the current scene, pass a JSON file containing an array of objects:

```sh
npm run parse -- "Make the top block blue" --scene scene.json
```

Example `scene.json`:

```json
[
  {
    "id": "block_top",
    "name": "Top block",
    "parent": null,
    "components": { "Mesh": { "shape": "box" } }
  }
]
```

## Run the HTTP API

```sh
npm start
```

The default port is `3000`; set `PORT` to change it.

Health check:

```sh
curl http://localhost:3000/health
```

Parse a request:

```sh
curl -X POST http://localhost:3000/api/parse \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A colorful tower of blocks that a wrecking ball swings into"}'
```

`POST /api/parse` accepts `prompt` (required), `scene` (optional array), `componentSchemas` (optional runtime field registry), and `scriptLanguage` (optional script-language description). Runtime component field definitions use a small JSON Schema subset: `type`, `enum`, `pattern`, numeric bounds, array item/length rules, and object properties/required fields. The built-in registry is a demo fixture based on the components shown in the supplied scene example; send the editor's actual registry when integrating with a host application.

The API returns `400` for invalid input, `422` when generated scene operations still fail validation after one correction attempt, `502` for upstream model failures, and `503` when `OPENAI_API_KEY` is missing. The validator checks operation shape, IDs and parents, supported fields and values, and the 500 rigid-body limit. Script source is checked as text only; it does not compile the restricted script language or apply operations to a running simulator.

## Check the source

```sh
npm run check
```

## API and schema references

- OpenAI [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- OpenAI [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)

## Project status

- Implemented: CLI parsing, HTTP parsing endpoint, health endpoint, configurable prompt/schema, local JSON operation validation.
- Not verified here: a live OpenAI request, because no API key is configured in the workspace.
- Limitations: no simulator integration or script compiler; the default schema is a demo fixture and should be replaced by the host editor's runtime registry.

See [AI_USAGE.md](AI_USAGE.md), [CHANGELOG.md](CHANGELOG.md), and [SUBMISSION.md](SUBMISSION.md) for the event build record and demo details.
