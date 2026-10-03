"""Safe arithmetic for client-defined derived report columns (e.g. Zari's
"Organic Sales" = total_sales - purchase_value) in the Excel report.

A hand-written tokenizer + recursive-descent parser -- never eval(). Mirrors
web/src/lib/formulaEval.ts: + - * / and parentheses, numbers, and variable
names only. A missing (None) value propagates to None; division by zero is
None, not an error or infinity; an unknown variable name raises FormulaError.
"""

import re

TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(.))")


class FormulaError(Exception):
    pass


def _tokenize(formula: str) -> list[tuple[str, str]]:
    tokens = []
    pos = 0
    while pos < len(formula):
        m = TOKEN.match(formula, pos)
        if not m or m.end() == pos:
            break
        pos = m.end()
        number, name, other = m.groups()
        if number is not None:
            tokens.append(("num", number))
        elif name is not None:
            tokens.append(("name", name))
        elif other.strip():
            if other not in "+-*/()":
                raise FormulaError(f"Unexpected character '{other}'")
            tokens.append(("op", other))
    return tokens


class _Parser:
    def __init__(self, tokens, variables):
        self.tokens = tokens
        self.i = 0
        self.vars = variables

    def _peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else None

    def _take(self):
        tok = self._peek()
        self.i += 1
        return tok

    def parse(self):
        value = self._expr()
        if self._peek() is not None:
            raise FormulaError("Unexpected trailing input")
        return value

    def _expr(self):
        left = self._term()
        while self._peek() in (("op", "+"), ("op", "-")):
            op = self._take()[1]
            right = self._term()
            left = None if left is None or right is None else (left + right if op == "+" else left - right)
        return left

    def _term(self):
        left = self._unary()
        while self._peek() in (("op", "*"), ("op", "/")):
            op = self._take()[1]
            right = self._unary()
            if left is None or right is None:
                left = None
            elif op == "*":
                left = left * right
            else:
                left = None if right == 0 else left / right
        return left

    def _unary(self):
        if self._peek() == ("op", "-"):
            self._take()
            value = self._unary()
            return None if value is None else -value
        return self._atom()

    def _atom(self):
        tok = self._take()
        if tok is None:
            raise FormulaError("Unexpected end of formula")
        kind, text = tok
        if kind == "num":
            return float(text)
        if kind == "name":
            if text not in self.vars:
                raise FormulaError(f"Unknown field '{text}'")
            value = self.vars[text]
            return None if value is None else float(value)
        if text == "(":
            value = self._expr()
            if self._take() != ("op", ")"):
                raise FormulaError("Missing closing parenthesis")
            return value
        raise FormulaError(f"Unexpected '{text}'")


def evaluate_formula(formula: str, variables: dict) -> float | None:
    return _Parser(_tokenize(formula), variables).parse()
