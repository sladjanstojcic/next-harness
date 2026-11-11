import { CONFIG_FILE, type ShapeName } from "../config.ts";
import { makerkitApp } from "./makerkit-app.ts";
import { makerkitFeature } from "./makerkit-feature.ts";
import { nextModules } from "./next-modules.ts";
import { packageShape } from "./package.ts";
import type { Shape } from "./shape.ts";
import { supabase } from "./supabase.ts";

const SHAPES: Partial<Record<ShapeName, Shape>> = {
  "next-modules": nextModules,
  package: packageShape,
  "makerkit-app": makerkitApp,
  "makerkit-feature": makerkitFeature,
  supabase,
};

export function shapeOf(name: ShapeName): Shape {
  const shape = SHAPES[name];
  if (shape === undefined) throw new Error(`${CONFIG_FILE}: shape "${name}" is not implemented yet`);
  return shape;
}
