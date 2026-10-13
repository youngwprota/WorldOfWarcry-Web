# Handoff — новые типы оружия (кинжалы, жнец)
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 1 готов (модели) · Дальше: шаг 2 — модели в загрузку, хват, WeaponDef/COMBOS, иконки

## Решения по ходу
- Модели в FBX (не GLB): тот же путь, что у Bitgem (loadAll + атлас proto_human_RTS_color по имени).
- Палитра: UV на градиентные колонки атласа (u — колонка, v — тень); таблица PALETTE в weapons.py.

## Грабли и что не сработало
- Системный Blender 4.0 без numpy → FBX-экспорт падает. Скачать wheel numpy 1.26.4 cp312 в scratchpad, PYTHONPATH + --python-use-system-env.
- В атласе красный — колонка u=0.594 (нижняя половина), не 0.719 (там бледно-голубой).

## Важный контекст
- Оружейные FBX Bitgem в см, текстура через TEXTURE_OF в assets.ts; хват в rig.ts WEAPON_GRIPS.
- Blender на этой машине: /usr/bin/blender (в forge_props.py путь Windows — не тот).
