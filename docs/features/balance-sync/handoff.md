# Handoff — баланс-тулза догоняет игру
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 1 готов · Дальше: шаг 2 — Spot с zone, ходьба через ворота, открытие по unlocks

## Решения по ходу
- Шаг 1: zoneDef/foeOf в simcore без кэша (applySet меняет MOBS); случайные точки — emptyIn(zone, layoutRng) по MAP_BOX, не копия World.spread.
- dummyDps берёт обычный профиль зоны (zoneResist), а не резисты босса — подбор оружия под мобов локации.
- Ответы пользователя: бот идёт в дальние земли (не таблица готовности); боссы китов — общая модель + напарник.

## Грабли и что не сработало
- Сим 6 прогонов ≈ 18 с. До шага 1: Атаман 35:18, Смерть 43:28 (4/6); после: 31:43 / 42:16 (6/6).

## Важный контекст
- Сим: src/simcore.ts (buildUnits ~стр. 130, fight ~225, бот ~480–790), карта src/balancemap.ts, страница src/balancepage.ts.
- Игра: числа моба — Game.addMob/zoneDef (src/game.ts ~335–375), расстановка — World.buildOuterLands и *Mobs (src/world.ts 1308–2010).
- Ворота: island.ts GATES (from/to), LAND_BOSSES, LAND_TRAILS. Боссы: unlocks в MOBS.*.boss (config.ts ~610–841).
