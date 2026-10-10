import type { ComponentSchema } from "../types";

export const animatorSchema: ComponentSchema = {
  name: "Animator",
  description: "Timeline animation settings; tracks are edited in the timeline.",
  requires: ["Transform"],
  fields: {
    loop: { type: "bool", default: true },
    duration: { type: "float", min: 0.1, max: 600, default: 5 }
  },
  managedFields: { tracks: "animationTracks" }
};
