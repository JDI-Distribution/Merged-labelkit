"""Normalize separators only in address fields, preserving address line order."""
import re

ADDRESS_FIELDS = frozenset({
    'address', 'ship_from', 'ship_to', 'bill_to', 'supplier_info',
    'delivery_address', 'billing_address', 'shipping_address',
    'ship_from_address', 'ship_to_address', 'bill_to_address',
    'ship_from_name', 'ship_to_name', 'bill_to_name', 'delivery_from_name', 'billing_customer_name',
    *(f'{prefix}_street{i}' for prefix in ('billing', 'shipping') for i in (1, 2, 3)),
})


def normalize_address_text(value):
    text = str(value or '').replace('\r\n', '\n').replace('\r', '\n')
    return re.sub(r'[ \t]*\|[ \t]*', '\n', text).strip()


def normalize_address_fields(value):
    """Normalize nested document addresses in place; leave other fields intact."""
    if isinstance(value, dict):
        for key, item in value.items():
            field = re.sub(r'[\s-]+', '_', str(key).strip().lower())
            if field in ADDRESS_FIELDS and isinstance(item, str):
                value[key] = normalize_address_text(item)
            else:
                normalize_address_fields(item)
    elif isinstance(value, list):
        for item in value:
            normalize_address_fields(item)
    return value
