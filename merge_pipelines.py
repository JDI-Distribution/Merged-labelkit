#!/usr/bin/env python3
"""Merge kehe_label_pipeline.py and kehe_documents_pipeline.py into single file."""

import sys
from pathlib import Path

proj_dir = Path("c:\\Users\\JDI Employee\\Downloads\\merged_labelkit\\frankenstein_project\\pipelines")
label_file = proj_dir / "kehe_label_pipeline.py"
docs_file = proj_dir / "kehe_documents_pipeline.py"
out_file = proj_dir / "kehe_pipeline.py"

# Read both files
with open(label_file, 'r', encoding='utf-8') as f:
    label = f.read()

with open(docs_file, 'r', encoding='utf-8') as f:
    docs = f.read()

# Process docs: remove docstring and inter-pipeline imports
docs_lines = docs.split('\n')

# Skip lines until we find first actual code (not imports/docstrings)
i = 0
in_import_paren = False

while i < len(docs_lines):
    line = docs_lines[i].rstrip()
    stripped = line.strip()
    
    # Check for multiline import
    if '(' in stripped and ('import' in stripped or 'from' in stripped):
        in_import_paren = True
        i += 1
        continue
    
    if in_import_paren:
        if ')' in stripped:
            in_import_paren = False
        i += 1
        continue
    
    # Skip docstring
    if stripped.startswith('"""'):
        i += 1
        continue
    
    # Skip blank lines and comments
    if not stripped or stripped.startswith('#'):
        i += 1
        continue
    
    # Skip single-line imports
    if stripped.startswith('from ') or stripped.startswith('import '):
        i += 1
        continue
    
    # This is real code - found body start
    break

docs_body = '\n'.join(docs_lines[i:])

# Build final merged file: take label file as-is, append docs body
merged = label + '\n\n# ========== DOCUMENTS PIPELINE (merged) ==========\n' + docs_body

# But we need to add the kehe_dc_directory import to label's imports
# Find where to insert it (after other imports)
merged_lines = merged.split('\n')
last_import_idx = 0
for idx, line in enumerate(merged_lines):
    if line.strip().startswith('from ') or line.strip().startswith('import '):
        last_import_idx = idx

# Insert kehe_dc_directory import if not already there
if 'kehe_dc_directory' not in merged:
    merged_lines.insert(last_import_idx + 1, 'from pipelines.kehe_dc_directory import find_kehe_dc')
    merged = '\n'.join(merged_lines)

with open(out_file, 'w', encoding='utf-8') as f:
    f.write(merged)

print(f"✓ Merged {label_file.name} + {docs_file.name} → {out_file.name}")
sys.exit(0)
