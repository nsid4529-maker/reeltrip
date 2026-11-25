"""Rebuild the public source library using the existing verified-review index."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'extraction-worker'))
from travel_workflow.evidence_cache import reviewed_catalog
entries = reviewed_catalog([ROOT / 'extraction-worker/catalog'])
records = []
for entry in entries.values():
    source = entry['analysis']
    folder = Path(entry['analysis_path']).parent.name
    records.append({**source, 'id': folder, 'platform': 'Instagram' if 'instagram.com' in entry['source_url'] else 'TikTok'})
order = ['ella', 'sigiriya', 'kanisha', 'shreya']
records.sort(key=lambda c: order.index(c['id']))
(ROOT / 'lib/catalog.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n')
print(f'Exported {len(records)} checksum-matched, explicitly reviewed sources')
