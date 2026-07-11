'use strict';

const RESTRICTED_MEMBERS = new Set(['aggregate', 'bulkWrite']);
const SCOPED_BASE_CLASSES = new Set(['ScopedRepository', 'OwnerScopedRepository']);

/** Walks up the AST to see if `node` sits inside a ScopedRepository/OwnerScopedRepository subclass. */
function isWithinScopedRepositoryClass(node) {
  let current = node;
  while (current) {
    if (current.type === 'ClassDeclaration' || current.type === 'ClassExpression') {
      const superClass = current.superClass;
      const superName =
        superClass && superClass.type === 'Identifier'
          ? superClass.name
          : superClass && superClass.type === 'MemberExpression' && superClass.property.type === 'Identifier'
            ? superClass.property.name
            : undefined;
      if (superName && SCOPED_BASE_CLASSES.has(superName)) return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Bans .aggregate()/.bulkWrite() calls and raw .collection access outside
 * ScopedRepository/OwnerScopedRepository subclasses (ADR-0001 CI guard 1).
 * The backstop plugin (libs/data/src/backstop.plugin.ts) is the runtime
 * fail-closed counterpart to this static guard.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow .aggregate()/.bulkWrite()/.collection outside ScopedRepository/OwnerScopedRepository subclasses (ADR-0001).',
    },
    schema: [],
    messages: {
      restrictedMember:
        '"{{member}}" bypasses tenant scoping — only call it inside a ScopedRepository/OwnerScopedRepository subclass (ADR-0001).',
      restrictedCollection:
        'Raw ".collection" access bypasses the scoped-repository layer entirely — forbidden outside libs/data (ADR-0001).',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.property.type !== 'Identifier') return;
        const name = node.property.name;

        if (name === 'collection') {
          if (!isWithinScopedRepositoryClass(node)) {
            context.report({ node, messageId: 'restrictedCollection' });
          }
          return;
        }

        if (RESTRICTED_MEMBERS.has(name)) {
          const isCall = node.parent && node.parent.type === 'CallExpression' && node.parent.callee === node;
          if (isCall && !isWithinScopedRepositoryClass(node)) {
            context.report({ node, messageId: 'restrictedMember', data: { member: name } });
          }
        }
      },
    };
  },
};
