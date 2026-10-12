import { Interactive, type InteractivitySchema } from "remotion";
import { PromptZoom } from "@/components/snap-cn/prompt-zoom";
import { brand } from "../brand";

type PromptProps = {
  readonly greeting: string;
  readonly text: string;
};

const PromptInner: React.FC<PromptProps> = ({ greeting, text }) => {
  return (
    <PromptZoom
      greeting={greeting}
      placeholder="Describe a scene…"
      text={text}
      chips={["Marble run", "Platformer", "Physics toy"]}
      model="SimuStyle AI"
      effort="Scene"
      theme={brand}
      mode="dark"
    />
  );
};

const promptSchema = {
  greeting: { type: "string", default: "What should we build?", description: "Greeting" },
  text: {
    type: "string",
    default: "A mini-golf hole with a spinning windmill",
    description: "Typed prompt",
  },
} as const satisfies InteractivitySchema;

export const PromptScene = Interactive.withSchema({
  Component: PromptInner,
  componentName: "PromptScene",
  schema: promptSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
