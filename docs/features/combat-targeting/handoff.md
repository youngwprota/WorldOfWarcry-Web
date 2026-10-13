# Handoff — Автоатака: цель не залипает вне удара
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 1 готов (inStrike + STRIKE_PAD) · Дальше: шаг 2 — выбор цели

## Решения по ходу

## Грабли и что не сработало
- Репо под GitButler: `git branch --show-current` = gitbutler/workspace, ветка фичи создана
  `but branch new fix/combat-targeting`. Хук SessionStart ищет план по git-ветке и этот план не
  подхватит — после компакта читать docs/features/combat-targeting/ вручную. Коммитить через
  `but commit` в ветку fix/combat-targeting, не через git commit.

## Важный контекст
- Код: game.ts ~593–629 (выбор цели, замах), inShape ~671, heroStrike ~684, hitProp ~1175.
