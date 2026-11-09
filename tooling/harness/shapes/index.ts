import { CONFIG_FILE, type ShapeName } from "../config.ts";
import { nextModules } from "./next-modules.ts";
import type { Shape } from "./shape.ts";

const SHAPES: Partial<Record<ShapeName, Shape>> = { "next-modules": nextModules };

export function shapeOf(name: ShapeName): Shape {
  const shape = SHAPES[name];
  if (shape === undefined) throw new Error(`${CONFIG_FILE}: shape "${name}" is not implemented yet`);
  return shape;
}
