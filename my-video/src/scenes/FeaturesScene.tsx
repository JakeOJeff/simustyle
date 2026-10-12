import { Interactive, type InteractivitySchema } from "remotion";
import { PunchLines } from "../components/snap-cn/punch-lines";
import { accent, brand } from "../brand";

type FeaturesProps = {
  readonly script: string;
};

const FeaturesInner: React.FC<FeaturesProps> = ({ script }) => {
  return (
    <PunchLines
      script={script}
      styles="slide"
      sizes="1"
      holds="44,44,52"
      accentBeat={2}
      accentColor={accent}
      theme={brand}
      mode="dark"
    />
  );
};

const featuresSchema = {
  script: {
    type: "string",
    default: "A 3D sandbox / with real physics. | AI agents / that build with you. | A script language / AI can fix.",
    description: "Cards split by |, lines by /",
  },
} as const satisfies InteractivitySchema;

export const FeaturesScene = Interactive.withSchema({
  Component: FeaturesInner,
  componentName: "FeaturesScene",
  schema: featuresSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
