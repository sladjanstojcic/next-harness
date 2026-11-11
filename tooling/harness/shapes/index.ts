import { CONFIG_FILE, type ShapeName, type SourceRoot } from "../config.ts";
import { makerkitApp } from "./makerkit-app.ts";
import { makerkitFeature } from "./makerkit-feature.ts";
import { nextModules, nextModulesAtRoot } from "./next-modules.ts";
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

/** A next-modules workspace whose source root is its own top gets that shape's root layout. */
export function shapeOf(name: ShapeName, sourceRoot: SourceRoot = "src/"): Shape {
  const shape = name === "next-modules" && sourceRoot === "" ? nextModulesAtRoot : SHAPES[name];
  if (shape === undefined) throw new Error(`${CONFIG_FILE}: shape "${name}" is not implemented yet`);
  return shape;
}
