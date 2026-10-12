import { Interactive, type InteractivitySchema } from "remotion";
import { AgentSteps } from "../components/snap-cn/agent-steps";
import { brand } from "../brand";

type BuildProps = {
  readonly query: string;
  readonly result: string;
};

// The scene assistant narrating its build, then leaving only the result.
const BuildInner: React.FC<BuildProps> = ({ query, result }) => {
  return (
    <AgentSteps
      query={query}
      steps={[
        { running: "Adding a ball with physics…", done: "Added a rolling ball", hold: 0.5 },
        { running: "Building the windmill…", done: "Built a windmill with spinning blades", hold: 0.5 },
        { running: "Placing the hole and flag…", done: "Placed the hole and flag", hold: 0.45 },
        { running: "Writing scripts…", done: "Wrote 2 scripts", hold: 0.45 },
        { running: "Test-running the scene…", done: "Test-ran the scene" },
      ]}
      result={result}
      glowRadius={0}
      theme={brand}
      mode="dark"
    />
  );
};

const buildSchema = {
  query: {
    type: "string",
    default: "A mini-golf hole with a spinning windmill",
    description: "Prompt pill",
  },
  result: { type: "string", default: "Scene built · 1 undoable edit", description: "Result" },
} as const satisfies InteractivitySchema;

export const BuildScene = Interactive.withSchema({
  Component: BuildInner,
  componentName: "BuildScene",
  schema: buildSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
