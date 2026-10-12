import { Interactive, type InteractivitySchema } from "remotion";
import { WordWheel } from "../components/snap-cn/word-wheel";
import { brand, dmSans } from "../brand";

type HookProps = {
  readonly headline: string;
  readonly words: string;
};

// The reel starts on the first word and stops on the last one, so the punchline goes last.
const HookInner: React.FC<HookProps> = ({ headline, words }) => {
  const rows = words.split(",").filter((w) => w.trim()).length;
  return <WordWheel headline={headline} words={words} spin={rows - 1} fontFamily={dmSans} theme={brand} mode="dark" />;
};

const hookSchema = {
  headline: { type: "string", default: "Script in", description: "Fixed lead-in" },
  words: {
    type: "string",
    default: "C++, JavaScript, C#, GDScript, Lua, Python, Rust, English.",
    description: "Reel words, comma separated; it stops on the last",
  },
} as const satisfies InteractivitySchema;

export const HookScene = Interactive.withSchema({
  Component: HookInner,
  componentName: "HookScene",
  schema: hookSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
