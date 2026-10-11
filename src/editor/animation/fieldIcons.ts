import { Blend, Circle, Gem, Lightbulb, Move, MoveVertical, Palette, RotateCw, Scaling, SlidersHorizontal, Sun, SunDim, Video, WavesHorizontal } from "@lucide/svelte";

type Icon = typeof Move;

const fieldIcons: Record<string, Icon> = {
  "Transform.position": Move,
  "Transform.rotation": RotateCw,
  "Transform.scale": Scaling,
  "Material.color": Palette,
  "Material.emissive": Sun,
  "Material.emissiveIntensity": SunDim,
  "Material.metalness": Gem,
  "Material.roughness": WavesHorizontal,
  "Material.opacity": Blend,
  "Light.color": Palette,
  "Light.intensity": Lightbulb,
  "Mesh.radius": Circle,
  "Mesh.height": MoveVertical,
  "Camera.fov": Video
};

const fieldLabels: Record<string, string> = {
  "Transform.position": "Position",
  "Transform.rotation": "Rotation",
  "Transform.scale": "Scale",
  "Material.color": "Color",
  "Material.emissive": "Glow color",
  "Material.emissiveIntensity": "Glow strength",
  "Material.opacity": "Opacity",
  "Light.color": "Light color",
  "Light.intensity": "Brightness",
  "Camera.fov": "Field of view"
};

export function fieldIcon(component: string, field: string): Icon {
  return fieldIcons[`${component}.${field}`] ?? SlidersHorizontal;
}

export function fieldLabel(component: string, field: string): string {
  return fieldLabels[`${component}.${field}`] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}
