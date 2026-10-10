import type { ComponentSchema } from "../types";

export const scriptSchema: ComponentSchema = {
  name: "Script",
  description: "A restricted scene script that runs during simulation.",
  requires: ["Transform"],
  fields: {
    source: { type: "string", default: "", multiline: true }
  }
};
