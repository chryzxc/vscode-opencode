const fs = require('fs');
const ts = require('typescript');

const methodToModule = {
  // DiagnosticsLogger
  'logStreamEventDiagnostics': 'diagnosticsLogger',
  'summarizeRenderMessageForDebug': 'diagnosticsLogger',
  'logHistoryRenderDiagnostics': 'diagnosticsLogger',
  'logPromptResponseDiagnostics': 'diagnosticsLogger',
  'sanitizeDebugPayload': 'diagnosticsLogger',
  'buildRawResponseDebugText': 'diagnosticsLogger',
  'getDebugFilePath': 'diagnosticsLogger',
  'getRenderParityDebugFilePath': 'diagnosticsLogger',
  'appendRenderParityDebugLog': 'diagnosticsLogger',
  'persistAiDebugSnapshot': 'diagnosticsLogger',
  'logPromptRequestPayload': 'diagnosticsLogger',
  'logPromptResponsePayload': 'diagnosticsLogger',

  // SubagentPersistence
  'getSubagentSnapshotStorageKey': 'subagentPersistence',
  'normalizeSubagentPayload': 'subagentPersistence',
  'mergeSubagentPayloads': 'subagentPersistence',
  'loadPersistedSubagentSnapshot': 'subagentPersistence',
  'savePersistedSubagentSnapshot': 'subagentPersistence',
  'clearPersistedSubagentSnapshot': 'subagentPersistence',
  'persistSubagentLiveState': 'subagentPersistence',
  'buildSubagentPayloadFromMessage': 'subagentPersistence',
  'persistSubagentUpdateSnapshot': 'subagentPersistence',
  'syncSubagentSnapshotForSession': 'subagentPersistence',

  // StructuredOutputProcessor
  'normalizeStructuredOutput': 'structuredOutputProcessor',
  'createFallbackMessage': 'structuredOutputProcessor',
  'extractMessageBodyText': 'structuredOutputProcessor',
  'extractStructuredOutput': 'structuredOutputProcessor',
  'applyStructuredOutputToMessage': 'structuredOutputProcessor',
  'enrichStreamEvent': 'structuredOutputProcessor',
  'enrichMessageWithPlan': 'structuredOutputProcessor',
  'getStructuredOutputFormat': 'structuredOutputProcessor',
  'shouldUseStructuredOutput': 'structuredOutputProcessor',
  'getStructuredOutputModelKey': 'structuredOutputProcessor',
  'getSelectedStructuredOutputModelKey': 'structuredOutputProcessor',
  'isLikelyToolCallTranscript': 'structuredOutputProcessor',
  'normalizeErrorCandidate': 'structuredOutputProcessor',
  'isGenericErrorMessage': 'structuredOutputProcessor',
  'isStructuredOutputTransportError': 'structuredOutputProcessor',
  'isStructuredOutputFailureMessage': 'structuredOutputProcessor',
  'isLikelyInteractiveAwaitTimeoutError': 'structuredOutputProcessor',
  'hasBlockingInteractiveInStreamPayload': 'structuredOutputProcessor',
  'collectErrorMessageCandidates': 'structuredOutputProcessor',
  'extractErrorMessage': 'structuredOutputProcessor',
  'collectNormalizedErrorMessages': 'structuredOutputProcessor',
  'extractDetailedErrorMessage': 'structuredOutputProcessor',
  'isReasoningPartLike': 'structuredOutputProcessor',
  'isRenderableTextPart': 'structuredOutputProcessor',
  'isInteractiveResponseType': 'structuredOutputProcessor',
  'formatQuestionPromptForAssistant': 'structuredOutputProcessor',
  'deriveQuestionPromptFromInteractivePayload': 'structuredOutputProcessor',
  'isLowValueInteractiveBodyText': 'structuredOutputProcessor',
  'isClarificationQuestionnaire': 'structuredOutputProcessor',
  'extractMessageId': 'structuredOutputProcessor',
  'recordStructuredValidationFailure': 'structuredOutputProcessor',
  'hasStructuredSubagentSignal': 'structuredOutputProcessor',
  'normalizeSubagentStatus': 'structuredOutputProcessor',
  'mergeSubagentEntries': 'structuredOutputProcessor',
  'hydrateSubagentsFromPayload': 'structuredOutputProcessor',
  'resolveSubagentPayloadSessionId': 'structuredOutputProcessor',
  'findLatestSubagentParentMessageIdForSession': 'structuredOutputProcessor',

  // PlanManager
  'isPlanProceedMessageText': 'planManager',
  'normalizePlanProceedUserMessage': 'planManager',
  'isGenericPlanTitle': 'planManager',
  'derivePlanTitleFromFilePath': 'planManager',
  'resolvePlanTitle': 'planManager',
  'persistPlan': 'planManager',
  'normalizePlanFileReference': 'planManager',
  'isLikelyPlanMarkdownFile': 'planManager',
  'getPlanFileCandidateScore': 'planManager',
  'prioritizePlanFileCandidates': 'planManager',
  'collectPlanFileCandidatesFromStructuredPlan': 'planManager',
  'resolvePlanFileCandidates': 'planManager',
  'readPlanFileFromDisk': 'planManager',
  'extractMarkdownFileReferences': 'planManager',
  'discoverLikelyPlanFileCandidates': 'planManager',
  'handleViewPlan': 'planManager',

  // CompactionManager
  'getCompactionViewStateStorageKey': 'compactionManager',
  'normalizeCompactionBaselineStats': 'compactionManager',
  'normalizeCompactionViewState': 'compactionManager',
  'loadPersistedCompactionViewState': 'compactionManager',
  'savePersistedCompactionViewState': 'compactionManager',
  'clearPersistedCompactionViewState': 'compactionManager',
  'postCompactionViewState': 'compactionManager',
  'sendPersistedCompactionViewState': 'compactionManager',
  'resolveSessionCompactionDividerState': 'compactionManager',
  'postCompactionStatus': 'compactionManager',
  'persistAndPublishCompactionViewState': 'compactionManager',
  'handleSetCompactionViewState': 'compactionManager',
  'resolveCompactionSessionId': 'compactionManager',
  'getSelectedModelContextLimit': 'compactionManager',
  'maybeAutoCompact': 'compactionManager',
  'handleCompactSession': 'compactionManager',
  'forwardCompactionStatusFromStreamEvent': 'compactionManager',

  // HistoryProcessor
  'getMessageOverrideStorageKey': 'historyProcessor',
  'loadSessionMessageOverrides': 'historyProcessor',
  'persistSessionMessageOverride': 'historyProcessor',
  'applySessionMessageOverrides': 'historyProcessor',
  'clearSessionMessageOverrides': 'historyProcessor',
  'processHistoryMessages': 'historyProcessor',
  'mergeAdjacentAssistantActivityMessages': 'historyProcessor',
  'mergeConsecutiveAssistantBursts': 'historyProcessor',
  'coalesceAssistantBurst': 'historyProcessor',
  'mergeMessageParts': 'historyProcessor',
  'historyPartFingerprint': 'historyProcessor',
  'isAssistantHistoryMessage': 'historyProcessor',
  'isActivityOnlyAssistantMessage': 'historyProcessor',
  'hasRenderableHistoryPayload': 'historyProcessor',
  'isInternalSystemReminderMessage': 'historyProcessor',
  'isRenderableHistoryMessage': 'historyProcessor',
  'dedupeMirrorHistoryMessages': 'historyProcessor',
  'areMirrorHistoryMessages': 'historyProcessor',
  'extractHistoryMessageId': 'historyProcessor',
  'historyMessageCreatedAt': 'historyProcessor',
  'historyMessageFingerprint': 'historyProcessor',
  'historyMessageRichnessScore': 'historyProcessor',
  'pickRicherHistoryMessage': 'historyProcessor',
  'pickCanonicalHistoryMessageId': 'historyProcessor',
  'isSyntheticLocalMessageId': 'historyProcessor',
  'getLatestAssistantHistoryMarker': 'historyProcessor',
  'hasAssistantHistoryAdvanced': 'historyProcessor',

  // ModelAndAgentManager
  'resolvePromptVariant': 'modelAndAgentManager',
  'migrateSessionSettings': 'modelAndAgentManager',
  'reconcileSelectedModelSelection': 'modelAndAgentManager',
  'resolveDefaultModel': 'modelAndAgentManager',
  'handleGetModels': 'modelAndAgentManager',
  'getSelectedModelFallbackList': 'modelAndAgentManager',
  'handleGetCommands': 'modelAndAgentManager',
  'loadCommandCatalog': 'modelAndAgentManager',
  'normalizeSlashCommand': 'modelAndAgentManager',
  'handleGetAgents': 'modelAndAgentManager',
  'getSessionSettingsMap': 'modelAndAgentManager',
  'getSessionSettings': 'modelAndAgentManager',
  'persistSessionSettings': 'modelAndAgentManager',
  'applySessionSettings': 'modelAndAgentManager',

  // QueueManager
  'getSessionQueue': 'queueManager',
  'setSessionQueue': 'queueManager',
  'createQueuedPrompt': 'queueManager',
  'resolveQueueSessionId': 'queueManager',
  'enqueuePrompt': 'queueManager',
  'takeQueuedPrompt': 'queueManager',
  'dispatchInteractiveResponse': 'queueManager',
  'schedulePromptDispatch': 'queueManager',
  'handleDispatchQueuedItem': 'queueManager',
  'handleRemoveFromQueue': 'queueManager',
  'handleClearQueue': 'queueManager',
  'handleExecuteQueue': 'queueManager',
  'maybeAutoDrainQueue': 'queueManager',
  'sendQueueUpdate': 'queueManager',

  // SessionHandler
  'handleGetSessions': 'sessionHandler',
  'sendProcessingSessionsUpdate': 'sessionHandler',
  'handleLoadSession': 'sessionHandler',
  'handleDeleteSession': 'sessionHandler',
  'handleRenameSession': 'sessionHandler',
};

const file = 'src/providers/ChatViewProvider.ts';
let content = fs.readFileSync(file, 'utf8');

const sourceFile = ts.createSourceFile('test.ts', content, ts.ScriptTarget.Latest, true);

const replacements = [];

function visit(node) {
  if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
    const name = node.name.text;
    if (methodToModule[name]) {
      replacements.push({
        start: node.getStart(),
        end: node.getEnd(),
        text: `this.${methodToModule[name]}.${name}`,
        type: 'ref'
      });
    }
  }
  
  if (ts.isClassDeclaration(node) && node.name && node.name.text === 'ChatViewProvider') {
    node.members.forEach(member => {
      if (ts.isMethodDeclaration(member) && member.name) {
        const name = member.name.text;
        if (methodToModule[name]) {
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
console.log(`Refactor complete. Original size: ${sourceFile.end}. Replacements: ${uniqueReplacements.length}`);
