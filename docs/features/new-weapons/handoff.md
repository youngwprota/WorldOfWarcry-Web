# Handoff — новые типы оружия (кинжалы, жнец)
Дописывать после каждого шага. Это переживает автокомпакт.

## Сейчас
Шаг: 3 готов (стаки кинжалов) · Дальше: шаг 4 — стягивание жнеца

## Решения по ходу
- Модели в FBX (не GLB): тот же путь, что у Bitgem (loadAll + атлас proto_human_RTS_color по имени).
- Палитра: UV на градиентные колонки атласа (u — колонка, v — тень); таблица PALETTE в weapons.py.

- Новые оружия сами попадают в гачу (gacha.ts берёт случайный ключ WEAPONS) — это уже источник.
- resistIcons теперь по типам урона (раньше по оружию — дубли иконок на slash).
- Стаки: Mob.stacks/stackAt/setStacks, бейдж .stk «×N» под HP; сброс в updateMobBars (decay текущего оружия, без кинжалов — сразу).
## Грабли и что не сработало
- Системный Blender 4.0 без numpy → FBX-экспорт падает. Скачать wheel numpy 1.26.4 cp312 в scratchpad, PYTHONPATH + --python-use-system-env.
- В атласе красный — колонка u=0.594 (нижняя половина), не 0.719 (там бледно-голубой).

## Важный контекст
- Проверка хвата: viewer.html?solo=12 (кинжал) / 13 (жнец); headless google-chrome --use-angle=swiftshader --screenshot.
- Оружейные FBX Bitgem в см, текстура через TEXTURE_OF в assets.ts; хват в rig.ts WEAPON_GRIPS.
- Blender на этой машине: /usr/bin/blender (в forge_props.py путь Windows — не тот).
