import json
from graphify.build import build_from_json
from graphify.export import to_json
from pathlib import Path

extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text(encoding="utf-8-sig"))
G = build_from_json(extraction)
to_json(G, {}, 'graphify-out/graph.json', force=True)
print('Graph JSON saved')
