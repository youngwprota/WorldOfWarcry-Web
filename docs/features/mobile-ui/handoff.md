# Handoff — Фикс UI на телефонах
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 7 готов, build ок · Дальше: проверка на реальном телефоне (iOS Safari/Android Chrome)

## Решения по ходу
- Масштабируются #hud, #pro-hud, #modal, .ad-overlay (размер 100%/--ui, scale от 0 0) и #dialogue (от низа). #labels и #debug — нет.
- edgeArrow и pro-arrow делят экранные px на ui.scale; #bigmap берёт hud.clientWidth (уже виртуальные px) — правка не нужна.
- После масштаба осталось одно: ряд талантов (4 узла) вылезал из шторки на 36px — grid minmax(0,1fr) + перенос имени узла.
- Оверлей #rotate: media landscape + max-height 500px + pointer: coarse (на десктопе не виден; в стенде проверен принудительно).
- UI_BASE = {w: 400, h: 720} (config.ts). Масштаб считает UI.fit() (ui.ts), вызывается из resize() в main.ts; ui.scale читают стрелки.

## Грабли и что не сработало
- @keyframes dlg-in анимирует transform и затирает scale у #dialogue — в keyframes добавлен scale(var(--ui)).
- Vite при правке CSS/TS перезагружает и страницу-стенд с iframe (document.write) — стенд пересоздавать.

## Важный контекст
- Диагностика (шаг 1, iframe-стенд на localhost): 412×860 — всё ок. 390×664 — HUD ок. 360×640/740 — #goal налезает на
  #stats, в окне героя ряд статов обрезан справа («2.3»), «ИНВЕНТАРЬ» залезает под ✕, окно героя тесное по высоте.
  Ландшафт 740×360 — колонка 9:16 шириной ~200px, всё в куче. Вывод: UI ломается при ширине < ~400 → базовая
  ширина UI_BASE.w = 400.
- Ветку fix/mobile-ui создал агент от main по просьбе пользователя («сделай в отдельной ветке»).
- В HUD лежат элементы, которые позиционируются в экранных px: #edge-arrow (ui.ts edgeArrow), .pro-arrow
  (prologue.ts updateLabels), #bigmap (mapview.ts, hud.clientWidth). При scale на #hud их координаты делить на s.
- #dialogue (ui.ts ~367) и .ad-overlay (ui.ts ~301) добавляются прямо в #app, не в #hud.
