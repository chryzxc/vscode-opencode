const fs = require('fs');
const ts = require('typescript');

const methodMapping = {
  'processHistoryMessages': 'historyProcessor',
  'isAssistantHistoryMessage': 'historyProcessor',
  'isRenderableHistoryMessage': 'historyProcessor',
  'extractHistoryMessageId': 'historyProcessor',
  'historyMessageCreatedAt': 'historyProcessor',
  'historyMessageFingerprint': 'historyProcessor',

  'isLikelyToolCallTranscript': 'structuredOutputProcessor',
  'normalizeErrorCandidate': 'structuredOutputProcessor',
  'normalizeSubagentStatus': 'structuredOutputProcessor',
  'mergeSubagentEntries': 'structuredOutputProcessor',
  'hydrateSubagentsFromPayload': 'structuredOutputProcessor',
  'resolveSubagentPayloadSessionId': 'structuredOutputProcessor',
  'findLatestSubagentParentMessageIdForSession': 'structuredOutputProcessor',
  'extractMessageBodyText': 'structuredOutputProcessor',
  'extractStructuredOutput': 'structuredOutputProcessor',
  'applyStructuredOutputToMessage': 'structuredOutputProcessor',

  'shouldVerboseStreamDebug': 'diagnosticsLogger',

  'syncCLIAgents': 'modelAndAgentManager'
};

const file = 'src/providers/ChatViewProvider.ts';
let content = fs.readFileSync(file, 'utf8');

const sourceFile = ts.createSourceFile('test.ts', content, ts.ScriptTarget.Latest, true);

function transformer(context) {
  return (rootNode) => {
    function visit(node) {
      if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const name = node.name.text;
          if (methodMapping[name]) {
             return ts.factory.createPropertyAccessExpression(
               ts.factory.createPropertyAccessExpression(
                 ts.factory.createThis(),
                 methodMapping[name]
               ),
               name
             );
          }
      }

      if (ts.isClassDeclaration(node) && node.name && node.name.text === 'ChatViewProvider') {
          const newMembers = [];
          for (const member of node.members) {
              let keep = true;
              if (ts.isMethodDeclaration(member) && member.name) {
                  const name = member.name.text;
                  if (methodMapping[name]) {
                      keep = false;
                  }
              }
              if (keep) {
                  newMembers.push(ts.visitEachChild(member, visit, context));
              }
          }
          return ts.factory.updateClassDeclaration(
              node,
              node.modifiers,
              node.name,
              node.typeParameters,
              node.heritageClauses,
              newMembers
          );
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(rootNode, visit);
  };
}

const result = ts.transform(sourceFile, [transformer]);
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const modifiedCode = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], sourceFile);

fs.writeFileSync(file, modifiedCode);
console.log('AST transformation applied.');
