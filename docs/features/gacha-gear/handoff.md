# Handoff — гача-предметы
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: все 7 готовы + прогон в headless Chrome · Дальше: проверка человеком на телефоне

## Решения по ходу
- Новые id: gloves_power/crit/haste, ring_shadow/blood, amulet_heart/ward (`GACHA_GEAR` в items.ts). Любой `*_arms` в сейве → gloves_power.
- `haste`/`leech` — кривые в STAT_CURVE; haste множит aps всех рук (heroDps тоже), leech — `Game.leech()` в damageMob и burnMob.

- Питомец = запись WEAPONS `pet_<id>` с полем `pet` (генерится из PETS в config), kind 'weapon', лежит в weapons[1] охотника (CLASSES.hunter.off). Не новый ItemKind — так сумка/копии/гача работают без правок. `petCellHtml` удалён.
- Сейв: `save.pet` → предмет в пустой слот охотника (`givePet` в save.ts). Урон/размер по качеству — PET_RARITY.
- Иконки питомцев: public/assets/ui/pet_<id>.png (вид 3/4, yaw −35), рендер icon_render.py + новый tools/blender/icon_fit.py.
- Pounce: прыжок дугой LEAP_TIME 0.4 с (pet.ts), укус при приземлении ×mult, показан жёлтым как крит. Cleave: укус по всем дерущимся мобам в `cleave` м от цели (game.ts updatePet). Анимации зверей — те же клипы, что у мобов-зверей.
- Значок стата на ячейке — только для GACHA_GEAR (`BONUS_ICON` в items.ts); у сфер убран значок типа урона. Миграция старых `shield_tower/buckler` → spiked снята, `shield` → tower.
- Гача: `poolItem` в gacha.ts — слот 1/4 каждый (перчатки/кольцо/амулет/предмет класса), класс случайный; сферы по `GACHA.orbs[tier]`. Баннер `GACHA.banner` теперь с `kind`.
- Sim: leech и pounce смоделированы, cleave нет (бои один на один). Сим совпал с main (Атаман 40:30) — крутки с мобов выключены, гача на сим не влияет.
- Проверено в node: 3000 круток — только гача-предметы, сферы по своим тирам, баннер ровно раз в ≤60; старый сейв (pet, plate_arms, hunter_arms, щит-баклер) грузится: pet_boar в слоте, перчатки → gloves_power.
- Прогон в браузере: миграция сейва, 5 круток (гарант → Кольцо Короля-лича), питомец из наковальни (масштаб по наибольшей стороне, FORGE3D.petSize), прыжок льва ×2,5, лапа медведя по 2 мобам, перчатки воина/охотника/мага разные, значки статов, карточка питомца. «Защита 0» у колец скрыта.

## Грабли и что не сработало
- Питомцы в WEAPONS попали в предзагрузку FBX (main.ts) → загрузка висла на 97% («FBXLoader: Unknown format»). Исключены вместе со сферами.
- Проверка без расширения Chrome: headless chrome.exe с --remote-debugging-port=9222 + свой CDP-клиент на WebSocket из node; в dev `window.game` (main.ts). Headless рендерит медленно: ~1 с игры за 7 с реальных.
- icon_render.py берёт рамку по вершинам без скиннинга — у зверей картинка уезжала вверх; добавлен REST-pose и обрезка/центровка в icon_fit.py.
- Звери не в `assets.sources`, а в `creatures`: `assets.has()` для них false → добавлен `hasCreature`, клон через `cloneCreature`.

## Важный контекст
- Концепт предметов — concept.md рядом.
- Мобы уже не роняют `*_arms` (перчатки) — только шлем/нагрудник/сапоги.
- Сферы — `WeaponDef.orb` с фиксированным `rarity`; щиты — `WeaponDef.guard`.
- Модели зверей: public/assets/models/wild_{direwolf,bear,lion}.glb, undead_boar.glb, orc_boar.glb (тайминги атак в config.ts:21).
