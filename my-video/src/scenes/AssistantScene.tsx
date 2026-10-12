import { Interactive, type InteractivitySchema } from "remotion";
import { PromptSend } from "../components/snap-cn/prompt-send";
import { brand, dmSans, editor } from "../brand";

type AssistantProps = {
  readonly text: string;
};

// lucide ArrowUp, the icon on the editor's Send button.
const ArrowUp: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
  </svg>
);

// The editor's Assistant composer (src/editor/AIPanel.svelte): its placeholder, its three
// suggestions and its send button, writing a brief and sending it.
const AssistantInner: React.FC<AssistantProps> = ({ text }) => {
  return (
    <PromptSend
      text={text}
      placeholder="What should change?"
      chips={["Add a tower of colorful blocks", "Drop 20 balls from above", "Make it night with one lamp"]}
      sendIcon={<ArrowUp size={15} />}
      radius={9}
      fontFamily={dmSans}
      accentColor={editor.accentFill}
      theme={brand}
      mode="dark"
      speed={1.2}
    />
  );
};

const assistantSchema = {
  text: {
    type: "string",
    default: "Build a small mini-golf hole I can play, with a windmill that spins forever",
    description: "Prompt typed into the Assistant",
  },
} as const satisfies InteractivitySchema;

export const AssistantScene = Interactive.withSchema({
  Component: AssistantInner,
  componentName: "AssistantScene",
  schema: assistantSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
