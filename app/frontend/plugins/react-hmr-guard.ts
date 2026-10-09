import ts from 'typescript';
import { normalizePath, type ModuleNode, type Plugin } from 'vite';

// Compare component identities, excluding bodies, props and type annotations so
// ordinary edits still use React Fast Refresh and preserve component state.
function identity(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return identity(node.expression);
  }
  if (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  ) {
    return `function:${node.name?.text ?? ''}`;
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const bases = node.heritageClauses?.flatMap(clause =>
      clause.types.map(type => identity(type.expression))
    );
    return `class:${node.name?.text ?? ''}:${bases?.join(',') ?? ''}`;
  }
  if (ts.isPropertyAccessExpression(node))
    return `${identity(node.expression)}.${node.name.text}`;
  if (ts.isCallExpression(node)) {
    return `${identity(node.expression)}(${node.arguments.map(identity).join(',')})`;
  }
  if (ts.isObjectLiteralExpression(node)) {
    return `{${node.properties
      .map(property => {
        if (ts.isPropertyAssignment(property))
          return `${property.name.getText()}:${identity(property.initializer)}`;
        if (ts.isShorthandPropertyAssignment(property))
          return property.name.text;
        if (ts.isSpreadAssignment(property))
          return `...${identity(property.expression)}`;
        return property.name?.getText() ?? '';
      })
      .sort()
      .join(',')}}`;
  }
  return ts.SyntaxKind[node.kind];
}

function componentSignature(code: string, file: string): string {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const entries: string[] = [];

  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement)
    ) {
      const exported = statement.modifiers?.some(
        modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
      );
      const defaultExport = statement.modifiers?.some(
        modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword
      );
      if (defaultExport || /^[A-Z]/.test(statement.name?.text ?? '')) {
        entries.push(
          `${defaultExport ? 'default' : exported ? 'export' : 'local'}:${identity(statement)}`
        );
      }
    } else if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some(
        modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
      );
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          /^[A-Z]/.test(declaration.name.text) &&
          declaration.initializer
        ) {
          entries.push(
            `${exported ? 'export' : 'local'}:${declaration.name.text}:${identity(declaration.initializer)}`
          );
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      entries.push(`default:${identity(statement.expression)}`);
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause;
      const names =
        clause && ts.isNamedExports(clause)
          ? clause.elements
              .filter(element => !element.isTypeOnly)
              .map(
                element =>
                  `${element.propertyName?.text ?? element.name.text}:${element.name.text}`
              )
              .sort()
              .join(',')
          : (clause?.getText() ?? '*');
      if (names)
        entries.push(
          `exports:${statement.moduleSpecifier?.getText() ?? ''}:${names}`
        );
    }
  }

  return JSON.stringify(entries.sort());
}

export function reactHmrGuard(): Plugin {
  const signatures = new Map<string, string>();
  const isSource = (id: string) =>
    /\.[cm]?[jt]sx?$/.test(id) &&
    !id.includes('/node_modules/') &&
    !id.includes('\0');

  return {
    name: 'react-hmr-guard',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id, options) {
      const file = normalizePath(id);
      if (!options?.ssr && isSource(file) && !signatures.has(file)) {
        signatures.set(file, componentSignature(code, file));
      }
    },
    async handleHotUpdate({ file, read, modules, server, timestamp }) {
      const key = normalizePath(file);
      const previous = signatures.get(key);
      if (previous === undefined || modules.length === 0) return;

      const next = componentSignature(await read(), key);
      signatures.set(key, next);
      if (previous === next) return;

      // A renamed/replaced component can remain a self-accepting refresh
      // boundary even though React still renders its previous family.
      const invalidated = new Set<ModuleNode>();
      for (const module of modules) {
        server.moduleGraph.invalidateModule(
          module,
          invalidated,
          timestamp,
          true
        );
      }
      server.ws.send({ type: 'full-reload', path: '*' });
      return [];
    },
    watchChange(id, { event }) {
      if (event === 'delete') signatures.delete(normalizePath(id));
    },
  };
}
