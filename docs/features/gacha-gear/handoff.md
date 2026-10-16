# Handoff — гача-предметы
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 1 готов · Дальше: шаг 2 (питомец-предмет)

## Решения по ходу
- Новые id: gloves_power/crit/haste, ring_shadow/blood, amulet_heart/ward (`GACHA_GEAR` в items.ts). Любой `*_arms` в сейве → gloves_power.
- `haste`/`leech` — кривые в STAT_CURVE; haste множит aps всех рук (heroDps тоже), leech — `Game.leech()` в damageMob и burnMob.

## Грабли и что не сработало

## Важный контекст
- Концепт предметов — concept.md рядом.
- Мобы уже не роняют `*_arms` (перчатки) — только шлем/нагрудник/сапоги.
- Питомец сейчас не предмет: `save.pet` (id из PETS), `petDef` в game.ts:1006, ячейка `petCellHtml` в items.ts.
- Сферы — `WeaponDef.orb` с фиксированным `rarity`; щиты — `WeaponDef.guard`; в `CLASSES.warrior.off` сейчас только shield_spiked.
- Модели зверей: public/assets/models/wild_{direwolf,bear,lion}.glb, undead_boar.glb, orc_boar.glb (тайминги атак в config.ts:21).
