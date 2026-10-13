#!/usr/bin/env python3
"""Сжимает вывод tsc / Vite / Node до уникальных ошибок, чтобы не забивать контекст агента.

Использование:
  <команда> 2>&1 | python3 tools/log_filter.py
  python3 tools/log_filter.py path/to/log.txt [--max 15] [--warnings]

Код выхода: 0 — ошибок нет, 1 — есть ошибки.
"""
import argparse
import re
import sys
from collections import OrderedDict

ERROR_PATTERNS = [
    r"error TS\d{4}",                      # tsc
    r"\[vite\].*\berror\b",
    r"\[plugin:[^\]]+\]",                  # ошибки плагинов Vite
    r"\bBuild failed\b",
    r"^\s*(\w+)?Error\b",                  # Error:, TypeError:, SyntaxError: …
    r"\b\w+Error:",
    r"Uncaught\b",
    r"npm ERR!|npm error",
    r"Transform failed",
]
WARNING_PATTERNS = [r"^\s*\(!\)", r"\bwarning\b", r"\[vite\].*\bwarn"]
NOISE = [r"^\s*at ", r"^\s*$", r"node:internal", r"^\s*\d+\s*\|", r"^\s*\|?\s*\^+\s*$"]


def normalize(line: str) -> str:
    line = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()   # ANSI-цвета
    line = re.sub(r"0x[0-9a-fA-F]+", "0x…", line)          # адреса
    line = re.sub(r"\?v=[0-9a-f]+", "", line)              # хэши Vite в путях
    return line[:300]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?")
    ap.add_argument("--max", type=int, default=15)
    ap.add_argument("--warnings", action="store_true")
    a = ap.parse_args()

    src = open(a.file, encoding="utf-8", errors="replace") if a.file else sys.stdin
    pats = ERROR_PATTERNS + (WARNING_PATTERNS if a.warnings else [])
    found: "OrderedDict[str, int]" = OrderedDict()
    errors: set = set()
    total_lines = 0
    for raw in src:
        total_lines += 1
        line = re.sub(r"\x1b\[[0-9;]*m", "", raw)
        if any(re.search(n, line) for n in NOISE):
            continue
        is_err = any(re.search(p, line, flags=re.IGNORECASE) for p in ERROR_PATTERNS)
        if is_err or any(re.search(p, line, flags=re.IGNORECASE) for p in pats):
            key = normalize(line)
            found[key] = found.get(key, 0) + 1
            if is_err:
                errors.add(key)

    if not found:
        print(f"Ошибок не найдено (строк во входе: {total_lines}).")
        sys.exit(0)

    print(f"Уникальных проблем: {len(found)} (ошибок: {len(errors)}), строк во входе: {total_lines}.")
    for i, (k, n) in enumerate(found.items()):
        if i >= a.max:
            print(f"… и ещё {len(found) - a.max}. Чини сначала первую — остальные часто её следствие.")
            break
        print(f"{'x' + str(n) + ' ' if n > 1 else ''}{k}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
