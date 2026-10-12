# Handoff — Крутой UI в стиле Butcher Hero
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 2 готов · Дальше: шаг 3 (HUD)

## Решения по ходу
- Шрифт: @fontsource/rubik 600/700/900 импортируется в main.ts. Обводка текста — переменные --stroke / --stroke-s (text-shadow), а не -webkit-text-stroke: тот съедает тонкие буквы.
- Кнопки .btn: цвет через --c1/--c2, варианты primary/red/purple/green/blue. Отдельная красная .xbtn для ✕. fmtK() лежит в icons.ts.
- Иконки: icon(id, color, size, cls) в icons.ts. ARMOR_SLOTS.icon теперь id иконки ('head'…), а не эмодзи. cellHtml() и itemIconId() лежат в items.ts (items импортирует icons, обратного импорта нет). Цвет редкости ячейки задают классы .r0–.r3.

## Грабли и что не сработало

## Важный контекст
- Референсы: 4 скрина Butcher Hero от пользователя (инвентарь-шторка, магазин, карточка предмета, игровой HUD). Сами файлы временные, все нужные детали записаны в plan.md → «Решения».
- Сейчас UI: разметка HUD в index.html, логика в src/ui.ts, окна героя и сумки в src/inventory.ts (HeroPreview = 3D-кукла), стили в src/style.css. `#hp` и `#bossbar` уже скрыты, HP рисуется над головами.
- RARITY (config.ts): 0 серый #c9c9c9, 1 синий #4ea3ff, 2 фиолетовый #b35cff, 3 оранжевый #ffa31a.
