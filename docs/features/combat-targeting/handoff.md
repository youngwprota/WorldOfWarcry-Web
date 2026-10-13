# Handoff — Автоатака: цель не залипает вне удара
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 4 из 4 готов, автотест в headless Chrome пройден · Дальше: проверка человеком на телефоне

## Решения по ходу
- Новую цель берём только в зоне удара (раньше в range+0.4); старая держится для разворота до прежнего радиуса. Сброс цели по !hittable вместо !alive.

## Грабли и что не сработало
- Репо под GitButler: `git branch --show-current` = gitbutler/workspace, ветка фичи создана
  `but branch new fix/combat-targeting`. Хук SessionStart ищет план по git-ветке и этот план не
  подхватит — после компакта читать docs/features/combat-targeting/ вручную. Коммитить через
  `but commit` в ветку fix/combat-targeting, не через git commit.

## Важный контекст
- Код: game.ts ~593–629 (выбор цели, замах), inShape ~671, heroStrike ~684, hitProp ~1175.
- Автотест: headless google-chrome + CDP-скрипт (scratchpad), `__game().offscreen = true` — иначе swiftshader 2 fps; ждать по `g.time`, не по реальному времени. Сейв в профиле помнит разбитые пропсы между перезагрузками.
