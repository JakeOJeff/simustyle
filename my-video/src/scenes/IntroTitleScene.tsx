import { Interactive, type InteractivitySchema } from "remotion";
import { FontShuffle } from "../components/snap-cn/font-shuffle";
import { accent, brand } from "../brand";

type IntroTitleProps = {
  readonly lead: string;
  readonly subject: string;
};

// "Introducing SimuStyle": decodes from scrambled glyphs, then the name tries on typefaces.
const IntroTitleInner: React.FC<IntroTitleProps> = ({ lead, subject }) => {
  return <FontShuffle lead={lead} subject={subject} accent={accent} theme={brand} mode="dark" />;
};

const introTitleSchema = {
  lead: { type: "string", default: "Introducing", description: "Fixed half, set in the serif" },
  subject: { type: "string", default: "SimuStyle", description: "The half that shuffles typefaces" },
} as const satisfies InteractivitySchema;

export const IntroTitleScene = Interactive.withSchema({
  Component: IntroTitleInner,
  componentName: "IntroTitleScene",
  schema: introTitleSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
