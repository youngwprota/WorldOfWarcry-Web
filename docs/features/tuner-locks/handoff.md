# Handoff — фиксация статов в автобалансере
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 1 готов · Дальше: шаг 2 (TUNE_KNOBS, fixed в tuner.ts)

## Решения по ходу
- Шаг 1: writeTuned(src, sets, manual?) — manual не передан → метки TUNE_MANUAL из файла сохраняются (CLI --write ничего не передаёт); передан → это полный список ручных. Тело POST /__tune-write теперь { sets, manual? }.

## Грабли и что не сработало
- npx tsx нет (висит на установке) — проверять модули через `npx esbuild file.ts --format=esm --outfile=<scratchpad>/x.mjs` + node.

## Важный контекст
- Ветку feat/tuner-locks создал агент по просьбе пользователя (от main после merge balance-tuner).
- Предыдущая фича: docs/features/balance-tuner/ (handoff там — как устроен тюнер, воркеры, запись через vite-плагин).
