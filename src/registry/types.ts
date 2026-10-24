export type FieldSchema =
  | { type: "float"; min: number; max: number; default: number; step?: number; /** Left unset unless chosen; readers derive the real default. */ optional?: boolean }
  | { type: "int"; min: number; max: number; default: number }
  | { type: "bool"; default: boolean }
  | { type: "color"; default: string }
  | { type: "vec3"; default: [number, number, number]; min?: number; max?: number }
  | { type: "enum"; options: string[]; default: string }
  | { type: "string"; default: string; multiline?: boolean }
  | { type: "entityRef"; default: string | null };

export interface ComponentSchema {
  name: string;
  description: string;
  fields: Record<string, FieldSchema>;
  requires?: string[];
  /** Data edited by a dedicated tool (for example the animation timeline). */
  managedFields?: Record<string, "animationTracks" | "scriptParameters">;
}
