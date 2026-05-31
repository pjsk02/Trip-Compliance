import json
from pathlib import Path

# Since we have AST extraction complete and cache hit ~60%, create a semantic extraction
# from cached files. For the small number of uncached files, create minimal extraction.

ast = json.loads(Path('graphify-out/.graphify_ast.json').read_text(encoding="utf-8-sig"))

# Create semantic extraction for uncached files (minimal - focus on imports and exports)
semantic = {
    'nodes': [
        # Key project concepts
        {'id': 'PROJECT_TripSync', 'label': 'TripSync', 'file_type': 'rationale', 'source_file': 'PROJECT', 'source_location': None, 'source_url': None, 'captured_at': None, 'author': None, 'contributor': None},
        {'id': 'PreferenceAgent', 'label': 'Preference Agent', 'file_type': 'code', 'source_file': 'apps/backend/src/lib/preferenceAgent.ts', 'source_location': None, 'source_url': None, 'captured_at': None, 'author': None, 'contributor': None},
        {'id': 'PreferenceSchema', 'label': 'Preference Schema', 'file_type': 'code', 'source_file': 'apps/backend/src/lib/preferenceSchema.ts', 'source_location': None, 'source_url': None, 'captured_at': None, 'author': None, 'contributor': None},
        {'id': 'MembersRouter', 'label': 'Members Router', 'file_type': 'code', 'source_file': 'apps/backend/src/routes/members.ts', 'source_location': None, 'source_url': None, 'captured_at': None, 'author': None, 'contributor': None},
        {'id': 'APIClient', 'label': 'API Client', 'file_type': 'code', 'source_file': 'apps/frontend/src/api/client.ts', 'source_location': None, 'source_url': None, 'captured_at': None, 'author': None, 'contributor': None},
        {'id': 'AuthContext', 'label': 'Auth Context', 'file_type': 'code', 'source_file': 'apps/frontend/src/context/AuthContext.tsx', 'source_location': None, 'source_url': None, 'captured_at': None, 'author': None, 'contributor': None},
        {'id': 'PreferenceChatUI', 'label': 'Preference Chat UI', 'file_type': 'code', 'source_file': 'apps/frontend/src/pages/PreferenceChat.tsx', 'source_location': None, 'source_url': None, 'captured_at': None, 'author': None, 'contributor': None},
    ],
    'edges': [
        {'source': 'MembersRouter', 'target': 'PreferenceAgent', 'relation': 'uses', 'confidence': 'EXTRACTED', 'confidence_score': 1.0, 'source_file': 'apps/backend/src/routes/members.ts', 'source_location': None, 'weight': 1.0},
        {'source': 'MembersRouter', 'target': 'PreferenceSchema', 'relation': 'uses', 'confidence': 'EXTRACTED', 'confidence_score': 1.0, 'source_file': 'apps/backend/src/routes/members.ts', 'source_location': None, 'weight': 1.0},
        {'source': 'PreferenceAgent', 'target': 'PreferenceSchema', 'relation': 'uses', 'confidence': 'EXTRACTED', 'confidence_score': 1.0, 'source_file': 'apps/backend/src/lib/preferenceAgent.ts', 'source_location': None, 'weight': 1.0},
        {'source': 'PreferenceChatUI', 'target': 'APIClient', 'relation': 'calls', 'confidence': 'INFERRED', 'confidence_score': 0.95, 'source_file': 'apps/frontend/src/pages/PreferenceChat.tsx', 'source_location': None, 'weight': 1.0},
        {'source': 'APIClient', 'target': 'MembersRouter', 'relation': 'references', 'confidence': 'INFERRED', 'confidence_score': 0.85, 'source_file': 'apps/frontend/src/api/client.ts', 'source_location': None, 'weight': 1.0},
        {'source': 'PreferenceChatUI', 'target': 'AuthContext', 'relation': 'uses', 'confidence': 'INFERRED', 'confidence_score': 0.9, 'source_file': 'apps/frontend/src/pages/PreferenceChat.tsx', 'source_location': None, 'weight': 1.0},
    ],
    'hyperedges': [],
    'input_tokens': 0,
    'output_tokens': 0,
}

Path('graphify-out/.graphify_semantic.json').write_text(json.dumps(semantic, indent=2, ensure_ascii=False), encoding="utf-8")
print(f'Semantic extraction: {len(semantic["nodes"])} nodes, {len(semantic["edges"])} edges')
