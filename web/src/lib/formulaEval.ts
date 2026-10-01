// A small, safe arithmetic expression evaluator for client-defined derived
// report columns (e.g. "purchase_value / amount_spent" for a blended ROAS
// that isn't one of our built-in metrics). Deliberately NOT `eval()`/`new
// Function()` -- those would execute arbitrary JS from a formula string an
// admin typed into a form, which is a real code-injection surface even
// though only admins can reach it. This only understands numbers,
// whitelisted variable names, + - * / and parentheses -- nothing else is
// representable, so there's nothing unsafe it could do.

type Token = { type: "num"; value: number } | { type: "ident"; value: string } | { type: "op"; value: string };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[0-9.]/.test(formula[j])) j++;
      tokens.push({ type: "num", value: Number(formula.slice(i, j)) });
      i = j;
    } else if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[a-zA-Z0-9_]/.test(formula[j])) j++;
      tokens.push({ type: "ident", value: formula.slice(i, j) });
      i = j;
    } else if ("+-*/()".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
    } else {
      throw new Error(`Unexpected character "${ch}" in formula`);
    }
  }
  return tokens;
}

// Recursive descent: expr := term (('+' | '-') term)*
//                     term := atom (('*' | '/') atom)*
//                     atom := number | identifier | '(' expr ')' | '-' atom
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error("Unexpected end of formula");
    this.pos++;
    return t;
  }

  parse(variables: Record<string, number | null>): number | null {
    const result = this.expr(variables);
    if (this.pos !== this.tokens.length) throw new Error("Unexpected trailing input in formula");
    return result;
  }

  private expr(vars: Record<string, number | null>): number | null {
    let value = this.term(vars);
    while (this.peek()?.type === "op" && (this.peek() as Token & { type: "op" }).value === "+" || this.peek()?.type === "op" && (this.peek() as Token & { type: "op" }).value === "-") {
      const op = this.next() as Token & { type: "op" };
      const rhs = this.term(vars);
      if (value === null || rhs === null) {
        value = null;
      } else {
        value = op.value === "+" ? value + rhs : value - rhs;
      }
    }
    return value;
  }

  private term(vars: Record<string, number | null>): number | null {
    let value = this.atom(vars);
    while (this.peek()?.type === "op" && ((this.peek() as Token & { type: "op" }).value === "*" || (this.peek() as Token & { type: "op" }).value === "/")) {
      const op = this.next() as Token & { type: "op" };
      const rhs = this.atom(vars);
      if (value === null || rhs === null) {
        value = null;
      } else if (op.value === "*") {
        value = value * rhs;
      } else {
        value = rhs === 0 ? null : value / rhs; // division by zero -> "no data", not Infinity/NaN
      }
    }
    return value;
  }

  private atom(vars: Record<string, number | null>): number | null {
    const t = this.next();
    if (t.type === "num") return t.value;
    if (t.type === "ident") {
      if (!(t.value in vars)) throw new Error(`Unknown field "${t.value}" in formula`);
      return vars[t.value];
    }
    if (t.type === "op" && t.value === "(") {
      const value = this.expr(vars);
      const close = this.next();
      if (close.type !== "op" || close.value !== ")") throw new Error('Expected ")"');
      return value;
    }
    if (t.type === "op" && t.value === "-") {
      const value = this.atom(vars);
      return value === null ? null : -value;
    }
    throw new Error("Invalid formula");
  }
}

// Returns null (not throwing) for a formula referencing a field with no
// data that day -- same "no data vs. genuinely zero" distinction used
// throughout this project's reports (see docs/reporting.md). Throws only
// for a genuinely malformed formula (caught by the caller, e.g. to show
// an error in the admin editor).
export function evaluateFormula(formula: string, variables: Record<string, number | null>): number | null {
  const tokens = tokenize(formula);
  return new Parser(tokens).parse(variables);
}

// Validates a formula against a known set of allowed variable names,
// without needing real data -- used by the admin UI to catch a typo'd
// field name or syntax error immediately, before it's saved.
export function validateFormula(formula: string, allowedFields: string[]): string | null {
  try {
    const dummyVars = Object.fromEntries(allowedFields.map((f) => [f, 1]));
    evaluateFormula(formula, dummyVars);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid formula";
  }
}
