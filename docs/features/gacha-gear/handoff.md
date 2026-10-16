# Handoff — гача-предметы
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 3 готов · Дальше: шаг 4 (щиты в пул, значок стата на ячейках)

## Решения по ходу
- Новые id: gloves_power/crit/haste, ring_shadow/blood, amulet_heart/ward (`GACHA_GEAR` в items.ts). Любой `*_arms` в сейве → gloves_power.
- `haste`/`leech` — кривые в STAT_CURVE; haste множит aps всех рук (heroDps тоже), leech — `Game.leech()` в damageMob и burnMob.

- Питомец = запись WEAPONS `pet_<id>` с полем `pet` (генерится из PETS в config), kind 'weapon', лежит в weapons[1] охотника (CLASSES.hunter.off). Не новый ItemKind — так сумка/копии/гача работают без правок. `petCellHtml` удалён.
- Сейв: `save.pet` → предмет в пустой слот охотника (`givePet` в save.ts). Урон/размер по качеству — PET_RARITY.
- Иконки питомцев пока SVG вепря (алиасы `pet_*` в art.ts) — заменить в шаге 6.
- Pounce: прыжок дугой LEAP_TIME 0.4 с (pet.ts), укус при приземлении ×mult, показан жёлтым как крит. Cleave: укус по всем дерущимся мобам в `cleave` м от цели (game.ts updatePet). Анимации зверей — те же клипы, что у мобов-зверей.

## Грабли и что не сработало

## Важный контекст
- Концепт предметов — concept.md рядом.
- Мобы уже не роняют `*_arms` (перчатки) — только шлем/нагрудник/сапоги.
- Питомец сейчас не предмет: `save.pet` (id из PETS), `petDef` в game.ts:1006, ячейка `petCellHtml` в items.ts.
- Сферы — `WeaponDef.orb` с фиксированным `rarity`; щиты — `WeaponDef.guard`; в `CLASSES.warrior.off` сейчас только shield_spiked.
- Модели зверей: public/assets/models/wild_{direwolf,bear,lion}.glb, undead_boar.glb, orc_boar.glb (тайминги атак в config.ts:21).
