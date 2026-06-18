from pathlib import Path

base_path = Path(r"c:\Users\JDI Employee\Downloads\merged_labelkit\frankenstein_project\pipelines")

# Read both files
with open(base_path / "kehe_label_pipeline.py", "r", encoding="utf-8") as f:
    file1_content = f.read()

with open(base_path / "kehe_documents_pipeline.py", "r", encoding="utf-8") as f:
    file2_content = f.read()

# Parse file1
lines1 = file1_content.split("\n")
doc1_end = 0
if lines1[0].strip().startswith('"""'):
    for i in range(1, len(lines1)):
        if '"""' in lines1[i]:
            doc1_end = i + 1
            break

# Collect imports from file1 as complete lines
imports1 = []
code_start1 = doc1_end
for i in range(doc1_end, len(lines1)):
    line = lines1[i]
    if line.strip() == "" or line.strip().startswith("#"):
        continue
    if line.startswith("import ") or line.startswith("from "):
        imports1.append(line)
    else:
        code_start1 = i
        break

# Parse file2
lines2 = file2_content.split("\n")
doc2_end = 0
if lines2[0].strip().startswith('"""'):
    for i in range(1, len(lines2)):
        if '"""' in lines2[i]:
            doc2_end = i + 1
            break

# Collect imports from file2 (skip the kehe_label_pipeline import)
imports2 = []
code_start2 = doc2_end
skip_multiline = False
for i in range(doc2_end, len(lines2)):
    line = lines2[i]
    if line.strip() == "" or line.strip().startswith("#"):
        continue
    
    # Skip multi-line import from kehe_label_pipeline
    if "from pipelines.kehe_label_pipeline import (" in line:
        skip_multiline = True
        continue
    
    if skip_multiline:
        if ")" in line:
            skip_multiline = False
        continue
    
    if line.startswith("import ") or line.startswith("from "):
        imports2.append(line)
    elif line.strip():
        code_start2 = i
        break

# Deduplicate imports
import_dict = {}
for imp in imports1 + imports2:
    imp = imp.strip()
    if imp and not imp.startswith("#"):
        # Use the import statement itself as key, skip __future__ duplicates
        if "from __future__" in imp:
            if "from __future__" not in import_dict:
                import_dict["from __future__"] = imp
        else:
            import_dict[imp] = imp

# Sort imports
regular_imports = sorted([i for i in import_dict.values() if i.startswith("import ")])
from_imports = sorted([i for i in import_dict.values() if i.startswith("from ") and not i.startswith("from __future__")])
future_imports = [i for i in import_dict.values() if i.startswith("from __future__")]

# Build merged file
merged = '''"""
KeHE Pipeline
-----------
Combined pipeline for both:
1. KeHE GS1-128 label generation (SSCC-18 labels)
2. KeHE document generation (Pallet Placards & Master Packing Lists)

This unified module combines the workflows from:
- kehe_label_pipeline.py: GS1-128 label generation from EDI 856 ASN XML
- kehe_documents_pipeline.py: Document generation (placards, packing lists)
"""
'''

# Add imports
if future_imports:
    for imp in future_imports:
        merged += imp + "\n"
    merged += "\n"

for imp in regular_imports:
    merged += imp + "\n"

for imp in from_imports:
    merged += imp + "\n"

merged += "\n"

# Add code from file1
file1_code_start = code_start1
while file1_code_start < len(lines1) and lines1[file1_code_start].strip() == "":
    file1_code_start += 1

file1_code = "\n".join(lines1[file1_code_start:])

# Add code from file2
file2_code_start = code_start2
while file2_code_start < len(lines2) and lines2[file2_code_start].strip() == "":
    file2_code_start += 1

file2_code = "\n".join(lines2[file2_code_start:])

# Combine
merged += file1_code + "\n\n\n" + file2_code

# Write
output_path = base_path / "kehe_pipeline.py"
with open(output_path, "w", encoding="utf-8") as f:
    f.write(merged)

print("Merged successfully")
print(f"Imports: {len(regular_imports)} import, {len(from_imports)} from")
