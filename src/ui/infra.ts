import { provinceOutput } from '../core/economy';
import type { GameState, ProvinceId } from '../core/types';
import type { World } from '../core/world';
import type { InfraIcon, InfraItem } from '../map/infraIcons';

/** The map's building icon for a building in a province (an oil well where it is oil). */
function iconOf(world: World, p: ProvinceId, b: string): InfraIcon {
  const r = world.resources[world.provinces[p]?.resource ?? ''];
  if (r && r.extract === b && r.id === 'oil') return 'oil';
  return b as InfraIcon;
}

/**
 * What to draw on the map: every province's buildings, and for the player's own provinces what
 * they produce and the work under way (the nearest to completion, with how many more follow).
 */
export function infraItems(s: GameState, world: World): InfraItem[] {
  const me = s.playerNation;
  const work = new Map<ProvinceId, { icon: InfraIcon; fraction: number; left: string; more: number }>();
  for (const x of (s.projects ?? []).filter((y) => y.nation === me).sort((a, b) => a.doneAt - b.doneAt)) {
    const prev = work.get(x.province);
    if (prev) { prev.more++; continue; }
    const left = Math.max(0, x.doneAt - s.clock.hours);
    work.set(x.province, {
      icon: x.kind === 'recruit' ? 'train' : x.kind === 'develop' ? 'develop' : iconOf(world, x.province, x.what),
      fraction: 1 - left / Math.max(1, x.doneAt - x.startAt),
      left: left >= 24 ? `${Math.ceil(left / 24)}d` : '<1d',
      more: 0,
    });
  }
  const out: InfraItem[] = [];
  for (const [p, ps] of Object.entries(s.provinces)) {
    const own = ps.owner === me;
    const icons = (ps.build ?? []).map((b) => iconOf(world, p, b));
    const project = own ? work.get(p) : undefined;
    const r = world.resources[world.provinces[p]?.resource ?? ''];
    const output = own && r ? `+${provinceOutput(s, world, p)} ${r.name.toLowerCase()}` : undefined;
    if (!icons.length && !project && !(own && output && ps.build?.includes(r!.extract))) continue;
    out.push({ province: p, icons, own, ...(project ? { project } : {}), ...(output ? { output } : {}) });
  }
  return out;
}
