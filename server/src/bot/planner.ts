/**
 * Tarif ağacı yardımcıları: bir eşyanın nasıl üretileceği, hammadde ihtiyacı ve iş yükü tahmini.
 */
import { ITEMS, RECIPE_LIST, handCraftTime, isUnlocked } from '@fabrika/shared';
import type { RecipeDef } from '@fabrika/shared';

/** Elle toplanan veya çıkarılan hammaddeler */
export const ORES = new Set(['ore_iron', 'ore_copper', 'limestone', 'coal', 'sulfur', 'quartz', 'bauxite']);
export const TREE_ITEMS = new Set(['leaves', 'wood']);

export function isRaw(item: string): boolean {
  return ORES.has(item) || TREE_ITEMS.has(item) || !!ITEMS[item]?.fluid;
}

/** Bu eşyayı üreten, açılmış tarifler (biyokütle için odun tercih edilir) */
export function recipesFor(item: string, completed: number): RecipeDef[] {
  return RECIPE_LIST.filter((r) => r.outputs[item] && isUnlocked(r.unlock, completed)).sort((a, b) => {
    if (item === 'biomass') return a.id === 'biomass_wood' ? -1 : 1;
    return 0;
  });
}

/** Elle üretilebilen ilk tarif */
export function handRecipe(item: string, completed: number): RecipeDef | undefined {
  return recipesFor(item, completed).find((r) => r.hand);
}

/** Makinede üretilebilen ilk tarif */
export function machineRecipe(item: string, completed: number): RecipeDef | undefined {
  return recipesFor(item, completed)[0];
}

/** Bir eşyanın n adedi için gereken hammaddeler ve elle üretim süresi (oyun saniyesi) */
export function rawNeeds(item: string, n: number, completed: number, out: Record<string, number> = {}, depth = 0): { raws: Record<string, number>; handSeconds: number; machineOnly: boolean } {
  let handSeconds = 0;
  let machineOnly = false;
  if (isRaw(item) || depth > 8) {
    out[item] = (out[item] ?? 0) + n;
    return { raws: out, handSeconds: ORES.has(item) ? n * 0.6 : 0, machineOnly: false };
  }
  const r = handRecipe(item, completed) ?? machineRecipe(item, completed);
  if (!r) { out[item] = (out[item] ?? 0) + n; return { raws: out, handSeconds: 0, machineOnly: true }; }
  if (!r.hand) machineOnly = true;
  const crafts = Math.ceil(n / r.outputs[item]);
  handSeconds += crafts * handCraftTime(r);
  for (const [k, v] of Object.entries(r.inputs)) {
    const sub = rawNeeds(k, crafts * v, completed, out, depth + 1);
    handSeconds += sub.handSeconds;
    machineOnly ||= sub.machineOnly;
  }
  return { raws: out, handSeconds, machineOnly };
}
