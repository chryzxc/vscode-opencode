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

const replacements = [];

function visit(node) {
  if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
    const name = node.name.text;
    if (methodMapping[name]) {
      replacements.push({
        start: node.getStart(),
        end: node.getEnd(),
        text: `this.${methodMapping[name]}.${name}`,
        type: 'ref'
      });
    }
  }
  
  if (ts.isClassDeclaration(node) && node.name && node.name.text === 'ChatViewProvider') {
    node.members.forEach(member => {
      if (ts.isMethodDeclaration(member) && member.name) {
        const name = member.name.text;
        if (methodMapping[name]) {
          replacements.push({
             start: member.getFullStart(),
             end: member.getEnd(),
             text: '',
             type: 'del'
          });
        }
      }
    });
  }
  
  ts.forEachChild(node, visit);
}

visit(sourceFile);

// Filter out overlapping inner replacements
const validReplacements = [];
for (const rep of replacements) {
    let isInsideDeleted = false;
    for (const del of replacements) {
        if (del.type === 'del' && rep.type === 'ref') {
            if (rep.start >= del.start && rep.end <= del.end) {
                isInsideDeleted = true;
                break;
            }
        }
    }
    if (!isInsideDeleted) {
        validReplacements.push(rep);
    }
}

validReplacements.sort((a, b) => b.start - a.start);

// Deduplicate EXACT same ones (shouldn't happen with valid ones)
const uniqueReplacements = [];
for (let i = 0; i < validReplacements.length; i++) {
  if (i === 0 || validReplacements[i].start !== uniqueReplacements[uniqueReplacements.length - 1].start) {
    uniqueReplacements.push(validReplacements[i]);
  }
}

for (const rep of uniqueReplacements) {
  content = content.slice(0, rep.start) + rep.text + content.slice(rep.end);
}

fs.writeFileSync(file, content);
console.log('Refactor complete. Applied ' + uniqueReplacements.length + ' operations.');
