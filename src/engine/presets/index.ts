import { Preset } from './types';
import { mangoSalvaje } from './mangoSalvaje';
import { escarcha } from './escarcha';
import { alpenglow } from './alpenglow';
import { circuit } from './circuit';
import { abyss } from './abyss';
import { girih } from './girih';
import { deco } from './deco';
import { orrery } from './orrery';
import { seigaiha } from './seigaiha';
import { metropolis } from './metropolis';
import { horizon } from './horizon';
import { roadster } from './roadster';
import { nordic } from './nordic';
import { celtic } from './celtic';
import { honeycomb } from './honeycomb';
import { saguaro } from './saguaro';
import { owls } from './owls';
import { balloons } from './balloons';
import { lighthouse } from './lighthouse';
import { clockwork } from './clockwork';
import { eclipse } from './eclipse';

export * from './types';

export const PRESETS: Preset[] = [
  mangoSalvaje,
  escarcha,
  alpenglow,
  horizon,
  abyss,
  seigaiha,
  girih,
  deco,
  orrery,
  circuit,
  metropolis,
  roadster,
  // --- second batch, pending review ---
  nordic,
  celtic,
  honeycomb,
  saguaro,
  owls,
  balloons,
  lighthouse,
  clockwork,
  eclipse,
];

export const PRESETS_BY_ID: Record<string, Preset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p])
);

export function getPreset(id: string): Preset {
  return PRESETS_BY_ID[id] ?? PRESETS[0];
}
