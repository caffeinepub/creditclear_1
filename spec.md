# CreditClear

## Current State
Venice AI key is user-provided, stored in ICP backend, loaded on mount, and saved via actor calls. The `apiKey` state is passed to analyzeReport and letter generation. Settings UI shows a dot indicator and input field for the key.

## Requested Changes (Diff)

### Add
- Hardcoded key constant: VENICE_INFERENCE_KEY_PTkGVuBBS8A88qsGYMfcp5E5KyfY3FfuQ_jQCgiQ7U

### Modify
- Replace all apiKey.trim() usages with hardcoded constant
- Remove apiKey/setApiKey useState
- Remove getApiKey/setApiKey actor calls and associated effects

### Remove
- API key input field, dot indicator, Connected/Required label from settings UI
- Guards blocking analysis/letter-gen when no key set

## Implementation Plan
1. Add HARDCODED_KEY constant near VENICE AI section
2. Replace all apiKey.trim() with HARDCODED_KEY
3. Remove useState, useEffect, and handler for apiKey
4. Remove API key settings UI block
5. Remove if (!apiKey.trim()) early-return guards
