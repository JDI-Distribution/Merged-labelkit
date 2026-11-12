"""Order-number intake feeding shared field review and document generation."""
import re

from labelkit.order_workbook_io import SCHEMA
from labelkit.order_workbook_match import analytics_lines


def parse_order_numbers(value):
    if not isinstance(value, str) or len(value) > 10000:
        raise ValueError('Enter up to 100 order numbers, separated by commas, spaces or new lines.')
    orders = [order for order in dict.fromkeys(re.split(r'[,;\s]+', value.strip())) if order]
    if not orders or len(orders) > 100 or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', order) for order in orders):
        raise ValueError('Enter 1 to 100 valid order numbers using letters, numbers, dots, hyphens or underscores.')
    return orders


def order_number_input(order, record, edits):
    actual = analytics_lines(record['rows']) if record else []
    seeds = [dict(sku=row['sku'], line_id=f'LINE-{index}') for index, row in enumerate(actual, 1)]
    added = edits.get('added_lines') or []
    if not isinstance(added, list) or len(added) > 1000 or any(not isinstance(line, str) or not re.fullmatch(r'MANUAL-[A-Za-z0-9-]{1,50}', line) for line in added):
        raise ValueError('Invalid manual item list. Reload this batch review.')
    if len(set(added)) != len(added):
        raise ValueError('Manual item IDs must be unique.')
    if not seeds and not added:
        added = ['MANUAL-1']
    seeds += [dict(sku='', line_id=line) for line in added]
    if len(seeds) > 5000:
        raise ValueError('Use at most 5,000 items per batch.')
    excluded = edits.get('excluded_lines') or []
    if not isinstance(excluded, list) or any(not isinstance(line, str) or line not in {row['line_id'] for row in seeds} for line in excluded):
        raise ValueError('An excluded item is no longer available. Review the selected order record.')
    lines = [{**{col[0]: '' for col in SCHEMA['sheets']['Order Lines']}, **seed, 'order_number': order} for seed in seeds]
    items = [dict(line_id=line['line_id'], sku=line['sku'], excluded=line['line_id'] in excluded) for line in lines]
    return dict(header=dict(order_number=order), lines=lines, labels=[]), items
