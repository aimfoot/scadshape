import { regionsScad } from './codegen';
import type { SketchData } from './model';
import { findLoops } from './regions';

/** 2D-kod för en skiss (standardregionerna), eller null om den saknar slutna profiler. */
export function codegenSketch(sk: SketchData, indent = '  ') {
  return regionsScad(findLoops(sk).loops, indent);
}
