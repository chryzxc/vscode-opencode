# Structured Output Schema Simplification Analysis

## Current Schema Problems

### 1. Extreme Complexity
- **680+ lines** vs SDK examples of ~30 lines
- **10 different response types** with complex interdependencies
- **Deeply nested structures** (5+ levels of nesting)
- **Conditional validation** using `allOf` with `if/then` logic

### 2. Model Compliance Issues
The glm-4.7 model is failing to comply with the current schema:
```json
"structured": {
  "responseType": ""  // Empty string - should be "message", "question", etc.
}
```

This suggests the schema is too complex for the model to process correctly.

### 3. SDK Best Practice Violations
From the SDK documentation:
> "保持 Schema 简洁 — 复杂的嵌套 Schema 可能会让模型更难正确填充"
> (Keep schemas simple — complex nested schemas can make it harder for models to fill correctly)

Current schema violates multiple best practices:
- ❌ Not simple
- ❌ Complex nested structures  
- ❌ Overly verbose descriptions
- ❌ Complex conditional validation
- ❌ `retryCount: 1` vs SDK default of `2`

## Simplified Schema Approach

### Key Changes

#### 1. Reduced Response Types (10 → 4)
**Removed types:**
- `subagents` - Can be merged into `progress_update`
- `todo_update` - Can use `message` type
- `system` - Internal use only
- `data` - Can use `message` type  
- `error` - Can use `message` type with error info

**Kept types:**
- `message` - Normal text responses
- `implementation_plan` - Multi-step plans
- `question` - User interactions
- `progress_update` - Execution steps

#### 2. Removed Conditional Validation
**Before:**
```typescript
allOf: [
  {
    if: {
      properties: {
        responseType: { const: "implementation_plan" }
      }
    },
    then: {
      not: {
        anyOf: [{ required: ["data"] }, { required: ["error"] }]
      }
    }
  }
]
```

**After:** Removed entirely - let runtime validation handle complex rules

#### 3. Flattened Nested Structures
**Before:** 5+ levels of nesting with extensive optional fields
**After:** Maximum 2-3 levels with clear required fields

#### 4. Increased Retry Count
```typescript
retryCount: 2  // Was: 1, SDK default: 2
```

#### 5. Simplified Descriptions
**Before:** Multi-paragraph descriptions with extensive examples
**After:** Single clear sentences per field

## Comparison: Schema Size

| Metric | Current | Simplified | Reduction |
|--------|---------|------------|-----------|
| Lines of code | 680 | 120 | 82% fewer |
| Response types | 10 | 4 | 60% fewer |
| Nesting levels | 5+ | 2-3 | 50% fewer |
| Description length | Multi-paragraph | Single sentence | 70% shorter |
| Conditional validation | Yes | No | 100% removed |

## Migration Strategy

### Phase 1: Testing (Recommended)
1. Create feature flag to switch between schemas
2. Test simplified schema with compliant providers (Anthropic, OpenAI)
3. Monitor validation success rates
4. Compare output quality

### Phase 2: Gradual Rollout
1. Start with non-critical sessions
2. Monitor for any regressions
3. Gather feedback on response quality
4. Adjust schema as needed

### Phase 3: Full Migration
1. Switch all sessions to simplified schema
2. Remove old schema code
3. Update any dependent validation logic

## Expected Benefits

### 1. Improved Model Compliance
- Simpler schema = easier for models to understand
- Higher success rate for structured output validation
- Fewer `responseType: ""` errors

### 2. Better Performance
- Smaller schema = faster validation
- Reduced retry attempts
- Lower token usage in prompts

### 3. Easier Maintenance
- Clearer structure for developers
- Simpler debugging when issues occur
- Easier to extend with new types

### 4. SDK Alignment
- Follows documented best practices
- Uses recommended `retryCount: 2`
- Matches SDK example patterns

## Potential Drawbacks

### 1. Lost Functionality
Some specialized response types are removed:
- **subagents** - Detailed subagent management
- **todo_update** - Structured todo lists
- **data** - Custom data cards
- **error** - Dedicated error responses

**Mitigation:** These can be handled via `message` type with structured content

### 2. Runtime Validation
Some complex validation rules move from schema to runtime:
- Mutual exclusivity checks
- Complex conditional logic
- Cross-field validation

**Mitigation:** Existing runtime validation in `structuredOutputValidator.ts` can handle this

## Recommendation

**Adopt the simplified schema** for the following reasons:

1. **Current schema is causing model compliance failures** - This is the primary issue
2. **SDK documentation explicitly recommends simple schemas** - We should follow best practices
3. **Most functionality can be preserved** - Core use cases (plans, questions, progress) are maintained
4. **Easier to extend later** - Can add back specialized types if needed

**Next Steps:**
1. Test simplified schema with current providers
2. Monitor validation success rates
3. Gather feedback on output quality
4. Migrate if results are positive
