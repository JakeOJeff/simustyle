import { Interactive, type InteractivitySchema } from "remotion";
import { AgentSteps } from "../components/snap-cn/agent-steps";
import { brand, dmMono, dmSans, editor } from "../brand";

type BuildProps = {
  readonly query: string;
  readonly result: string;
};

// The scene agent at work. The log lines are the agent's own progress messages
// (src/ai/agent.ts and App.svelte), set like the Assistant's loading line.
const BuildInner: React.FC<BuildProps> = ({ query, result }) => {
  return (
    <AgentSteps
      query={query}
      steps={[
        { running: "Building the first pass…", done: "Built the first pass", hold: 0.6 },
        { running: "Reviewing the first build and its Console output…", done: "Reviewed the Console output", hold: 0.6 },
        { running: "Checking scripts before apply…", done: "Checked scripts before apply", hold: 0.5 },
        { running: "Building and checking the second pass…", done: "Built the second pass" },
      ]}
      result={result}
      glowRadius={0}
      paperColor={editor.page}
      pillColor={editor.field}
      inkColor={editor.text}
      stepColor={editor.progress}
      accentColor={editor.accent}
      fontFamily={dmSans}
      stepFontFamily={dmMono}
      theme={brand}
      mode="dark"
    />
  );
};

const buildSchema = {
  query: {
    type: "string",
    default: "Build a small mini-golf hole I can play, with a windmill that spins forever",
    description: "Prompt pill",
  },
  result: { type: "string", default: "Built a playable mini-golf hole · Undo this change", description: "Result" },
} as const satisfies InteractivitySchema;

export const BuildScene = Interactive.withSchema({
  Component: BuildInner,
  componentName: "BuildScene",
  schema: buildSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
