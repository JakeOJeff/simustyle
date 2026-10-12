import { Interactive, type InteractivitySchema } from "remotion";
import { TerminalSimulator } from "../components/snap-cn/terminal-simulator";
import { brand } from "../brand";

type ParseProps = {
  readonly intro: string;
};

// AI Parse: loose wording goes in, valid SimuStyle script comes out.
const ParseInner: React.FC<ParseProps> = ({ intro }) => {
  return (
    <TerminalSimulator
      intro={intro}
      command={{ managers: ["Player.simu"], text: "✦ Parse" }}
      lines={[
        { text: "wiat 2 secs", type: "command", delay: 0 },
        { text: "→ wait 2 seconds", type: "success", delay: 3 },
        { text: "make me jump kinda high", type: "command", delay: 5 },
        { text: "→ push me up 5", type: "success", delay: 3 },
        { text: "✓ 8 of 8 lines valid", type: "success", delay: 6 },
      ]}
      fontSize={17}
      charsPerFrame={3}
      speed={1.2}
      theme={brand}
      mode="dark"
    />
  );
};

const parseSchema = {
  intro: {
    type: "string",
    default: "*type it* how you'd *say it.*",
    description: "Intro; *asterisks* get the accent",
  },
} as const satisfies InteractivitySchema;

export const ParseScene = Interactive.withSchema({
  Component: ParseInner,
  componentName: "ParseScene",
  schema: parseSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
