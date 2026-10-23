// All feature types (except sketch) collected: add a new type here and in the Feature union.

import { code, type CodeFeature } from './code';
import { container, type ContainerFeature } from './container';
import { extrude, type ExtrudeFeature } from './extrude';
import { hole, type HoleFeature } from './hole';
import { mesh, type MeshFeature } from './mesh';
import { snap, type SnapFeature } from './snap';
import { surface, type SurfaceFeature } from './surface';
import { revolve, type RevolveFeature } from './revolve';
import { text, type TextFeature } from './text';
import { thread, type ThreadFeature } from './thread';
import type { FeatureKind } from './common';

export type SolidFeature = ExtrudeFeature | RevolveFeature | HoleFeature | ThreadFeature | ContainerFeature | TextFeature | CodeFeature | MeshFeature | SnapFeature | SurfaceFeature;

export const KINDS: { [T in SolidFeature['type']]: FeatureKind<Extract<SolidFeature, { type: T }>> } = {
  extrude,
  revolve,
  hole,
  thread,
  container,
  text,
  code,
  mesh,
  snap,
  surface,
};

/** The type's description (loosely typed for generic code such as the panel and the tree). */
export const kindOf = (f: SolidFeature) => KINDS[f.type] as unknown as FeatureKind<SolidFeature>;

export type { SurfaceFeature, SnapFeature, MeshFeature, CodeFeature, ContainerFeature, TextFeature, ExtrudeFeature, HoleFeature, RevolveFeature, ThreadFeature };
export * from './common';
