import type { ScenarioDef } from '../../core/scenario';
import { bronze } from './bronze';
import { modern } from './modern';
import { renaissance } from './renaissance';
import { romeFall } from './romeFall';
import { romeRise } from './romeRise';
import { usa } from './usa';
import { ww1 } from './ww1';
import { ww2 } from './ww2';

/** All playable scenarios, in era order. */
export const scenarios: ScenarioDef[] = [bronze, romeRise, romeFall, renaissance, ww1, ww2, modern, usa];

export const getScenario = (id: string) => scenarios.find((s) => s.id === id);
