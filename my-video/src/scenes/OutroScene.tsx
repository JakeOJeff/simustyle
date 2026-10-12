import { Interactive, type InteractivitySchema } from "remotion";
import { WordmarkCut } from "@/components/snap-cn/wordmark-cut";
import { brand } from "../brand";

type OutroProps = {
  readonly word: string;
};

// A fast pan across the wordmark, cut short before it settles on the dot.
const OutroInner: React.FC<OutroProps> = ({ word }) => {
  return <WordmarkCut word={word} dotFrom="#7c6cf0" dotTo="#c4b8ff" theme={brand} mode="dark" />;
};

const outroSchema = {
  word: { type: "string", default: "simustyle.", description: "Wordmark" },
} as const satisfies InteractivitySchema;

export const OutroScene = Interactive.withSchema({
  Component: OutroInner,
  componentName: "OutroScene",
  schema: outroSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
