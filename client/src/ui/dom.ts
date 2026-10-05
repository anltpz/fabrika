import { ITEMS, countItem, itemName } from '@fabrika/shared';
import type { Inventory } from '@fabrika/shared';
import { itemIcon } from '../icons';

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : String(c));
  }
  return el;
}

export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

export function icon(item: string, size?: number): HTMLImageElement {
  const img = h('img', { src: itemIcon(item), alt: itemName(item), title: itemName(item), draggable: 'false' });
  if (size) { img.style.width = size + 'px'; img.style.height = size + 'px'; }
  return img;
}

export function chip(item: string, n: number | string, cls = ''): HTMLElement {
  return h('span', { class: 'chip ' + cls, title: itemName(item) }, icon(item), `${n}`, h('span', { class: 'muted' }, ' ' + shortName(item)));
}

export function costChips(cost: Record<string, number>, inv?: Inventory, mult = 1): HTMLElement {
  const wrap = h('div', { class: 'cost-list' });
  for (const [item, n] of Object.entries(cost)) {
    const need = n * mult;
    const have = inv ? countItem(inv, item) : need;
    wrap.append(chip(item, inv ? `${have}/${need}` : need, inv ? (have >= need ? 'ok' : 'lack') : ''));
  }
  return wrap;
}

export function flowChips(items: Record<string, number>, perMin?: number): HTMLElement {
  const wrap = h('span', { class: 'cost-list' });
  for (const [item, n] of Object.entries(items)) {
    const label = perMin ? `${n} (${fmt(n * perMin)}/dk)` : `${n}`;
    wrap.append(chip(item, label));
  }
  return wrap;
}

export function shortName(item: string): string {
  return ITEMS[item]?.name ?? item;
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
