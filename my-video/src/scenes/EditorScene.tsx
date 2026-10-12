import { Interactive, staticFile, type InteractivitySchema } from "remotion";
import { CaptureReveal } from "@/components/snap-cn/capture-reveal";
import { brand } from "../brand";

type EditorProps = {
  readonly headline: string;
  readonly capturing: string;
  readonly copied: string;
};

// The real editor screenshot drops away to reveal the headline.
const EditorInner: React.FC<EditorProps> = ({ headline, capturing, copied }) => {
  return (
    <CaptureReveal
      src={staticFile("editor.png")}
      headline={headline}
      capturing={capturing}
      copied={copied}
      theme={brand}
      mode="dark"
    />
  );
};

const editorSchema = {
  headline: { type: "string", default: "ship it | anywhere.", description: "Headline; | breaks the line" },
  capturing: { type: "string", default: "Exporting scene...", description: "Toast while counting" },
  copied: { type: "string", default: "Exported to GLB, HTML & WebM.", description: "Toast when done" },
} as const satisfies InteractivitySchema;

export const EditorScene = Interactive.withSchema({
  Component: EditorInner,
  componentName: "EditorScene",
  schema: editorSchema,
  wrapInSequence: true,
  layout: "absolute-fill",
});
