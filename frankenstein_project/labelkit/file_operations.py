"""Upload handling and Michaels multi-PDF output utilities."""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import pymupdf as fitz
from fastapi import HTTPException, UploadFile

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_MICHAELS_OUTPUT_PAGES = 1000


async def save_upload_file(upload: UploadFile, destination: Path) -> None:
    total_bytes = 0
    with destination.open("wb") as f:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_BYTES:
                await upload.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"{upload.filename or 'Upload'} exceeds the 50 MB limit.")
            f.write(chunk)
    await upload.close()


def combine_shipping_pdfs(pdf_paths: List[Path], combined_path: Path) -> Path:
    if len(pdf_paths) == 1:
        return pdf_paths[0]

    merged = fitz.open()
    try:
        for pdf_path in pdf_paths:
            src = fitz.open(pdf_path)
            try:
                merged.insert_pdf(src)
            finally:
                src.close()
        merged.save(combined_path)
    finally:
        merged.close()
    return combined_path


def split_michaels_output_by_shipping_pdf(
    combined_output_path: Path,
    shipping_pdf_paths: List[Path],
    report: Dict[str, Any],
    temp_dir: Path,
    shipping_pdf_names: Optional[List[str]] = None,
) -> tuple[Path, List[str], Path]:
    """Create separate downloads plus a combined preview with PDF boundary pages."""
    rows = list(report.get("rows") or [])
    source_output = fitz.open(combined_output_path)
    output_dir = temp_dir / "separate_michaels_outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    generated_groups: List[List[tuple[Path, str]]] = []
    used_names: Dict[str, int] = {}
    first_label_page = 1
    display_names = (
        list(shipping_pdf_names)
        if shipping_pdf_names and len(shipping_pdf_names) == len(shipping_pdf_paths)
        else [path.name for path in shipping_pdf_paths]
    )

    try:
        for shipping_path in shipping_pdf_paths:
            shipping_doc = fitz.open(shipping_path)
            try:
                shipping_page_count = shipping_doc.page_count
            finally:
                shipping_doc.close()

            last_label_page = first_label_page + shipping_page_count - 1
            source_rows = [
                row
                for row in rows
                if first_label_page <= int(row.get("label_page") or 0) <= last_label_page
            ]
            source_rows.sort(key=lambda row: int(row.get("output_start_page") or 0))
            if len(source_rows) != shipping_page_count or any(
                not row.get("output_start_page") or not row.get("output_end_page")
                for row in source_rows
            ):
                raise RuntimeError(
                    f"Could not preserve output boundaries for {shipping_path.name}."
                )

            base_stem = sanitize_filename(shipping_path.stem).strip(" ._") or "shipping_labels"
            occurrence = used_names.get(base_stem.lower(), 0) + 1
            used_names[base_stem.lower()] = occurrence
            suffix = f"_{occurrence}" if occurrence > 1 else ""
            base_name = f"{base_stem}{suffix}_michaels_output"
            split_parts: List[tuple[Path, str]] = []
            split_doc = fitz.open()
            part_index = 1

            def save_shipping_part(*, numbered: bool) -> None:
                nonlocal split_doc, part_index
                if split_doc.page_count < 1:
                    return
                output_name = (
                    f"{base_name}_part_{part_index:03d}.pdf"
                    if numbered
                    else f"{base_name}.pdf"
                )
                output_path = output_dir / output_name
                split_doc.save(output_path, garbage=4, deflate=True)
                split_parts.append((output_path, output_name))
                split_doc.close()
                split_doc = fitz.open()
                part_index += 1

            try:
                for row in source_rows:
                    page_start = int(row["output_start_page"]) - 1
                    page_end = int(row["output_end_page"]) - 1
                    while page_start <= page_end:
                        if split_doc.page_count == MAX_MICHAELS_OUTPUT_PAGES:
                            save_shipping_part(numbered=True)
                        capacity = MAX_MICHAELS_OUTPUT_PAGES - split_doc.page_count
                        chunk_end = min(page_end, page_start + capacity - 1)
                        split_doc.insert_pdf(source_output, from_page=page_start, to_page=chunk_end)
                        page_start = chunk_end + 1
                numbered = len(split_parts) > 0 or split_doc.page_count > MAX_MICHAELS_OUTPUT_PAGES
                if numbered:
                    save_shipping_part(numbered=True)
                else:
                    save_shipping_part(numbered=False)
            finally:
                split_doc.close()

            generated_groups.append(split_parts)
            first_label_page = last_label_page + 1
    finally:
        source_output.close()

    zip_path = temp_dir / "michaels_separate_outputs.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for group in generated_groups:
            for output_path, output_name in group:
                archive.write(output_path, arcname=output_name)

    preview_path = temp_dir / "michaels_combined_preview_with_breaks.pdf"
    preview_doc = fitz.open()
    try:
        for index, group in enumerate(generated_groups):
            for output_path, _output_name in group:
                output_doc = fitz.open(output_path)
                try:
                    preview_doc.insert_pdf(output_doc)
                finally:
                    output_doc.close()

            if index < len(generated_groups) - 1:
                append_michaels_pdf_boundary_page(
                    preview_doc,
                    ending_pdf_name=display_names[index],
                    starting_pdf_name=display_names[index + 1],
                    ending_pdf_number=index + 1,
                    starting_pdf_number=index + 2,
                    total_pdfs=len(generated_groups),
                )
        preview_doc.save(preview_path, garbage=4, deflate=True)
    finally:
        preview_doc.close()

    return (
        zip_path,
        [output_name for group in generated_groups for _output_path, output_name in group],
        preview_path,
    )


def split_michaels_output_by_page_limit(
    combined_output_path: Path,
    report: Dict[str, Any],
    temp_dir: Path,
    base_filename: str = "michaels_output",
    max_pages: int = MAX_MICHAELS_OUTPUT_PAGES,
) -> tuple[Path, List[str]]:
    """Split generated output by complete label bundles into bounded PDFs in a ZIP."""
    source = fitz.open(combined_output_path)
    output_dir = temp_dir / "michaels_page_limited_outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = sorted(
        (row for row in report.get("rows") or [] if row.get("output_start_page") and row.get("output_end_page")),
        key=lambda row: int(row["output_start_page"]),
    )
    groups: List[List[tuple[int, int]]] = []
    current_group: List[tuple[int, int]] = []
    current_pages = 0
    for row in rows:
        bundle_start = int(row["output_start_page"])
        bundle_end = int(row["output_end_page"])
        bundle_pages = bundle_end - bundle_start + 1
        if bundle_pages < 1:
            source.close()
            raise RuntimeError("Michaels output report contains an invalid page range.")
        while bundle_start <= bundle_end:
            remaining_capacity = max_pages - current_pages
            if remaining_capacity == 0:
                groups.append(current_group)
                current_group = []
                current_pages = 0
                remaining_capacity = max_pages
            chunk_end = min(bundle_end, bundle_start + remaining_capacity - 1)
            current_group.append((bundle_start, chunk_end))
            current_pages += chunk_end - bundle_start + 1
            bundle_start = chunk_end + 1
    if current_group:
        groups.append(current_group)
    if not groups:
        source.close()
        raise RuntimeError("Michaels output report did not contain any complete label page ranges.")

    generated: List[tuple[Path, str]] = []
    try:
        for part_index, group in enumerate(groups, start=1):
            part = fitz.open()
            try:
                for first_page, last_page in group:
                    part.insert_pdf(
                        source,
                        from_page=first_page - 1,
                        to_page=last_page - 1,
                    )
                if part.page_count > max_pages:
                    raise RuntimeError("A single Michaels label bundle exceeds the PDF page limit.")
                output_name = f"{sanitize_filename(base_filename)}_part_{part_index:03d}.pdf"
                output_path = output_dir / output_name
                part.save(output_path, garbage=4, deflate=True)
            finally:
                part.close()
            generated.append((output_path, output_name))
    finally:
        source.close()

    zip_path = temp_dir / f"{sanitize_filename(base_filename)}_parts.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for output_path, output_name in generated:
            archive.write(output_path, arcname=output_name)
    return zip_path, [name for _path, name in generated]


def append_michaels_pdf_boundary_page(
    document: fitz.Document,
    ending_pdf_name: str,
    starting_pdf_name: str,
    ending_pdf_number: int,
    starting_pdf_number: int,
    total_pdfs: int,
) -> None:
    """Append a high-visibility letter-size boundary page between source PDFs."""
    page = document.new_page(width=612, height=792)
    navy = (0.10, 0.15, 0.22)
    muted = (0.37, 0.43, 0.51)
    end_color = (0.73, 0.14, 0.16)
    start_color = (0.08, 0.48, 0.32)
    light_fill = (0.96, 0.97, 0.98)

    page.draw_rect(page.rect, color=navy, fill=(1, 1, 1), width=3)
    page.insert_textbox(
        fitz.Rect(48, 42, 564, 82),
        "PDF BOUNDARY",
        fontname="helv",
        fontsize=14,
        color=muted,
        align=fitz.TEXT_ALIGN_CENTER,
    )

    page.draw_rect(fitz.Rect(48, 105, 564, 330), color=end_color, fill=light_fill, width=3)
    page.insert_textbox(
        fitz.Rect(72, 132, 540, 174),
        f'PDF {ending_pdf_number} OF {total_pdfs} - END',
        fontname="hebo",
        fontsize=22,
        color=end_color,
        align=fitz.TEXT_ALIGN_CENTER,
    )
    page.insert_textbox(
        fitz.Rect(76, 190, 536, 292),
        f'PDF "{ending_pdf_name}" END',
        fontname="hebo",
        fontsize=20,
        color=navy,
        align=fitz.TEXT_ALIGN_CENTER,
    )

    page.insert_textbox(
        fitz.Rect(48, 365, 564, 427),
        "NEXT UPLOADED PDF BEGINS AFTER THIS PAGE",
        fontname="helv",
        fontsize=14,
        color=muted,
        align=fitz.TEXT_ALIGN_CENTER,
    )

    page.draw_rect(fitz.Rect(48, 462, 564, 687), color=start_color, fill=light_fill, width=3)
    page.insert_textbox(
        fitz.Rect(72, 489, 540, 531),
        f'PDF {starting_pdf_number} OF {total_pdfs} - START',
        fontname="hebo",
        fontsize=22,
        color=start_color,
        align=fitz.TEXT_ALIGN_CENTER,
    )
    page.insert_textbox(
        fitz.Rect(76, 547, 536, 649),
        f'PDF "{starting_pdf_name}" START',
        fontname="hebo",
        fontsize=20,
        color=navy,
        align=fitz.TEXT_ALIGN_CENTER,
    )


def sanitize_filename(name: str) -> str:
    keep = []
    for ch in name:
        if ch.isalnum() or ch in ("-", "_", ".", " "):
            keep.append(ch)
        else:
            keep.append("_")
    return "".join(keep)


def unique_upload_destination(
    directory: Path,
    filename: str,
    reserved_names: set[str],
) -> Path:
    safe_name = sanitize_filename(filename).strip(" .") or "upload"
    candidate = Path(safe_name)
    stem = candidate.stem or "upload"
    suffix = candidate.suffix
    occurrence = 1
    while candidate.name.lower() in reserved_names or (directory / candidate.name).exists():
        occurrence += 1
        candidate = Path(f"{stem}_{occurrence}{suffix}")
    reserved_names.add(candidate.name.lower())
    return directory / candidate.name


def normalize_kit(value: str) -> str:
    normalized = (value or "").strip().lower().replace("_", "-")
    aliases = {
        "michael": "michaels",
        "michaels-label-kit": "michaels",
        "michaels-labelkit": "michaels",
        "michaels-dts": "michaels",
        "kehe-label-kit": "kehe",
        "kehe-labelkit": "kehe",
        "kehe-gs1": "kehe",
    }
    return aliases.get(normalized, normalized)
