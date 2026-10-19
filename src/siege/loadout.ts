import { WEAPONS } from '../config';
import { CLASS_SET, makeItem, type ArmorSlot, type Item } from '../items';
import { CLASSES, CLASS_IDS, kitOf, type HeroClass } from '../party';
import type { SaveData } from '../save';

const GREEN = 1;
const SET_SLOTS: ArmorSlot[] = ['head', 'chest', 'legs'];

const green = (def: string) => makeItem('weapon', def, GREEN, 1);

function greenGear(c: HeroClass): Partial<Record<ArmorSlot, Item>> {
  return Object.fromEntries(SET_SLOTS.map((s) => [s, makeItem('armor', `${CLASS_SET[c]}_${s}`, GREEN, 1)]));
}

/**
 * The siege's own save: a copy of the main one with every class (locked ones too) in its green set and a bag of green weapons.
 * The siege Game never persists it (Game.persist is a no-op in a mode), the main save is untouched.
 */
export function siegeSave(main: SaveData): SaveData {
  const s = structuredClone(main);
  const open = CLASS_IDS;
  const cls = open.includes(main.cls ?? 'warrior') ? main.cls ?? 'warrior' : 'warrior';

  const hands = {} as Record<HeroClass, [Item | null, Item | null]>;
  const bag: Item[] = [];
  for (const c of open) {
    const kit = CLASSES[c].kit!;
    hands[c] = [green(kit.hand), kit.left ? green(kit.left) : null];
    for (const def of [...CLASSES[c].weapons, ...CLASSES[c].off]) {
      if (def !== kit.hand && def !== kit.left && WEAPONS[def]) bag.push(green(def));
    }
  }

  s.classes = [...CLASS_IDS]; // the siege opens every class, locked ones too (Game.classOpen reads it)
  s.cls = cls;
  s.kit = s.gearOf = kitOf(cls);
  s.weapons = hands[cls];
  s.equip = greenGear(cls);
  s.kits = {};
  s.gear = {};
  for (const c of open) {
    if (c === cls) continue;
    s.kits[c] = hands[c];
    s.gear[c] = greenGear(c);
  }
  s.bag = bag;
  s.pulls = 0;
  s.spawners = {};
  s.bosses = {};
  s.gates = [];
  delete s.gatesOpen;
  delete s.bagUnlimited;
  delete s.fog;
  return s;
}
