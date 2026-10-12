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
      styles="slide,slide,punch"
      sizes="1,1,2.4"
      holds="42,42,48"
      accentBeat={3}
      accentColor={accent}
      theme={brand}
      mode="dark"
    />
  );
};

const featuresSchema = {
  script: {
    type: "string",
    default: "Real physics. / Keyframe animation. | Runs in your browser. / Or on Windows. | Free.",
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
