import ts from 'typescript';

/**
 * Finds user-visible text that bypasses the dictionary: JSX text, text-bearing JSX attributes
 * (aria-label, placeholder, title, ...), literals/templates inside JSX expressions and toast calls, and
 * `message`/`label`/`title` properties. Used by the guard test (src/i18n/__tests__/no-hardcoded-text.test.ts).
 *
 * Opt out on a line with `// i18n-ignore: <reason>` (same line or the line above) for text that must
 * not be translated (brand names, protocol tokens, code samples).
 */
export interface Finding {
  line: number;
  kind: 'jsx-text' | 'jsx-attr' | 'jsx-expr' | 'toast' | 'prop';
  text: string;
}

const TEXT_ATTRS = new Set([
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-placeholder',
  'title',
  'alt',
  'label',
  'description',
  'hint',
  'emptyTitle',
  'emptyDescription',
  'helperText',
  'tooltip',
  'heading',
  'subtitle',
  'caption',
  'confirmLabel',
  'cancelLabel',
  'submitLabel',
  'actionLabel',
  'emptyText',
  'loadingText',
  'errorTitle',
  'summary',
  'text',
  'srLabel',
  'legend',
  'error',
  'message',
  'noResultsText',
  'searchPlaceholder',
]);
const TOAST_FNS = new Set(['success', 'error', 'info', 'warning', 'message', 'loading']);
const PROP_NAMES = new Set(['message', 'label', 'title', 'description', 'hint', 'placeholder']);

/** Words that are product/protocol terms and stay in English in every locale. */
const ALLOWED_WORDS = new Set([
  'API',
  'JSON',
  'HTML',
  'CSV',
  'URL',
  'HTTP',
  'HTTPS',
  'SSE',
  'OAuth',
  'OpenAI',
  'Anthropic',
  'Claude',
  'Google',
  'Gmail',
  'Slack',
  'WhatsApp',
  'Webhook',
  'webhook',
  'HilaTech',
  'AI',
  'ID',
  'UTC',
  'USD',
  'ILS',
  'EUR',
  'GBP',
  'SMTP',
  'Stripe',
  'PayPal',
  'Zapier',
  'Edge',
  'Chrome',
  'Safari',
  'Firefox',
  'Windows',
  'macOS',
  'iOS',
  'Android',
  'Linux',
  'JavaScript',
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'PDF',
  'TXT',
  'DOCX',
  'MD',
  'Bearer',
]);

function looksLikeText(raw: string, strict = false): boolean {
  const s = raw.replace(/&[a-z#0-9]+;/gi, ' ').trim();
  if (!s) return false;
  const words = s.match(/[A-Za-z֐-׿][A-Za-z֐-׿'’-]*/g) ?? [];
  const real = words.filter((w) => w.length >= 2 && !ALLOWED_WORDS.has(w));
  if (real.length === 0) return false;
  if (strict) return true;
  // Ignore identifiers / paths / tokens (no whitespace, contains separators or camelCase / snake_case).
  if (!/\s/.test(s) && /[_./:@#\\[\](){}=<>-]|[a-z][A-Z]/.test(s)) return false;
  // A single lowercase token (css-ish, enum value) is not copy.
  if (!/\s/.test(s) && /^[a-z0-9]+$/.test(s)) return false;
  // Pure CSS class lists.
  if (/^[a-z0-9:/\-[\]_.%!() ]+$/.test(s) && /[-:]/.test(s) && !/[A-Z]/.test(s)) return false;
  return true;
}

function collectStrings(node: ts.Node, out: { node: ts.Node; text: string }[]): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push({ node, text: node.text });
    return;
  }
  if (ts.isTemplateExpression(node)) {
    const text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('{}');
    out.push({ node, text });
    for (const span of node.templateSpans) collectStrings(span.expression, out);
    return;
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    collectStrings(node.expression, out);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectStrings(node.whenTrue, out);
    collectStrings(node.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      collectStrings(node.right, out);
      if (op !== ts.SyntaxKind.AmpersandAmpersandToken) collectStrings(node.left, out);
    } else if (op === ts.SyntaxKind.PlusToken) {
      collectStrings(node.left, out);
      collectStrings(node.right, out);
    }
  }
}

export function findHardcodedText(fileName: string, source: string): Finding[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = source.split('\n');
  const findings: Finding[] = [];
  const ignored = (line: number) =>
    /i18n-ignore/.test(lines[line - 1] ?? '') || /i18n-ignore/.test(lines[line - 2] ?? '');
  const add = (node: ts.Node, kind: Finding['kind'], text: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (!ignored(line)) findings.push({ line, kind, text: text.trim().slice(0, 80) });
  };

  const inType = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n))
        return true;
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true;
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = source.substring(node.pos, node.end);
      if (looksLikeText(text, true)) add(node, 'jsx-text', text.replace(/\s+/g, ' '));
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (TEXT_ATTRS.has(name)) {
        const init = node.initializer;
        const found: { node: ts.Node; text: string }[] = [];
        if (ts.isStringLiteral(init)) found.push({ node: init, text: init.text });
        else if (ts.isJsxExpression(init) && init.expression)
          collectStrings(init.expression, found);
        for (const f of found)
          if (looksLikeText(f.text, true)) add(f.node, 'jsx-attr', `${name}=${f.text}`);
      }
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const found: { node: ts.Node; text: string }[] = [];
      collectStrings(node.expression, found);
      for (const f of found) if (looksLikeText(f.text, true)) add(f.node, 'jsx-expr', f.text);
    } else if (ts.isCallExpression(node) && !inType(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'getErrorMessage' && node.arguments[1]) {
        const found: { node: ts.Node; text: string }[] = [];
        collectStrings(node.arguments[1], found);
        for (const f of found) if (looksLikeText(f.text, true)) add(f.node, 'toast', f.text);
      }
      if (ts.isIdentifier(callee) && /^set(Form)?(Error|Message|Notice)$/.test(callee.text)) {
        const found: { node: ts.Node; text: string }[] = [];
        if (node.arguments[0]) collectStrings(node.arguments[0], found);
        for (const f of found) if (looksLikeText(f.text, true)) add(f.node, 'toast', f.text);
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'toast' &&
        TOAST_FNS.has(callee.name.text)
      ) {
        for (const arg of node.arguments.slice(0, 1)) {
          const found: { node: ts.Node; text: string }[] = [];
          collectStrings(arg, found);
          for (const f of found) if (looksLikeText(f.text, true)) add(f.node, 'toast', f.text);
        }
      }
    } else if (ts.isPropertyAssignment(node) && !inType(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '';
      if (PROP_NAMES.has(name)) {
        const found: { node: ts.Node; text: string }[] = [];
        collectStrings(node.initializer, found);
        for (const f of found) if (looksLikeText(f.text)) add(f.node, 'prop', `${name}: ${f.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}
