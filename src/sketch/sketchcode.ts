import { regionsScad } from './codegen';
import type { SketchData } from './model';
import { findLoops } from './regions';

/** 2D code for a sketch (the default regions), or null if it has no closed profiles. */
export function codegenSketch(sk: SketchData, indent = '  ') {
  return regionsScad(findLoops(sk).loops, indent);
}
