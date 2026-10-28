"""Shared examples must produce the same rules in the browser and PDF backend."""
import json
import subprocess
import unittest
from pathlib import Path

from labelkit.product_quality import gtin_check_digit_valid
from pipelines.kehe.tihi_layout import _mpl_build_tihi_entries

PROJECT = Path(__file__).resolve().parents[1]


class CrossRuntimeRules(unittest.TestCase):
    def test_backend_gtin_rules_and_browser_pallet_result_adapter(self):
        gtins = ['', 'ABC10850079841588', '10850079841588', '00850079841581',
                 '10850079841589', '1085-0079841588', '10850079841588!']
        item = dict(line=1, location_on_pallet='1', sku='A', qty_on_pallet='9',
                    length_in='12', width_in='10', height_in='5', unit_weight_lbs='1')
        scenarios = [dict(items=[item], _tihi_constraints=constraints) for constraints in
                     ({}, {'cases_per_layer': 4}, {'cases_per_layer': 4, 'max_layers': 2},
                      {'max_height_in': 5, 'cases_per_layer': 4}, {'max_gross_lbs': 55})]
        scenarios.append(dict(items=[item, dict(item, sku='B', line=2, qty_on_pallet='3',
                                               length_in='16', height_in='8', unit_weight_lbs='3')]))
        plans = [_mpl_build_tihi_entries(mpl, mpl['items'])[0] for mpl in scenarios]
        source = r'''
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({}); ctx.window = ctx;
vm.runInContext(fs.readFileSync('frontend/dist/assets/js/mpl-tihi.js', 'utf8'), ctx);
const plans = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(plans.map(entries => entries.map(raw => {
  const entry = ctx.palletPlanView(raw);
  return [entry.ti, entry.hi, entry.shownCases, entry.overflowCases, entry.usedHeight, entry.grossWeightLbs];
}))));
'''
        result = subprocess.run(['node', '-e', source], input=json.dumps(plans),
                                cwd=PROJECT, text=True, capture_output=True, check=True)
        browser = json.loads(result.stdout)
        self.assertEqual([gtin_check_digit_valid(value) for value in gtins], [False, False, True, True, False, True, False])
        fields = ('ti', 'hi', 'shown_cases', 'overflow_cases', 'used_height', 'gross_weight_lbs')
        for index, mpl in enumerate(scenarios):
            with self.subTest(scenario=index):
                entries, _ = _mpl_build_tihi_entries(mpl, mpl['items'])
                self.assertEqual(browser[index], [[entry[field] for field in fields] for entry in entries])
