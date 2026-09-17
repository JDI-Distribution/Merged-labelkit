import unittest

from labelkit.product_quality import analyze_product_master_rows, gtin_check_digit_valid


class ProductQualityTests(unittest.TestCase):
    def test_gtin_check_digit_validation(self):
        self.assertTrue(gtin_check_digit_valid("10850068684998"))
        self.assertFalse(gtin_check_digit_valid("10850068684999"))
        self.assertFalse(gtin_check_digit_valid("12345"))

    def test_complete_each_and_case_configuration_scores_ready(self):
        rows = [
            {
                "storefront": "Example",
                "config_id": "CFG-1",
                "sku": "SKU-1",
                "description": "Example product",
                "packaging_level": "Each",
                "gtin": "10850068684998",
                "case_qty": "1",
                "gross_weight_lbs": "0.375",
                "verification_status": "VERIFIED",
            },
            {
                "storefront": "Example",
                "config_id": "CFG-1",
                "sku": "SKU-1",
                "description": "Example product",
                "packaging_level": "Case",
                "gtin": "10850068684998",
                "case_qty": "12",
                "length_in": "12",
                "width_in": "8",
                "height_in": "6",
                "gross_weight_lbs": "4.5",
                "label_enabled": True,
                "label_template_id": "GENERIC_CASE_4X6",
                "verification_status": "VERIFIED",
            },
        ]

        quality = analyze_product_master_rows(rows)

        self.assertEqual(quality["summary"]["configurations"], 1)
        self.assertEqual(quality["summary"]["ready_configurations"], 1)
        self.assertEqual(quality["summary"]["average_score"], 100)
        self.assertTrue(all(row["status"] == "ready" for row in quality["rows"]))

    def test_duplicate_invalid_unit_and_hierarchy_conflicts_are_reported(self):
        case_row = {
            "storefront": "Example",
            "config_id": "CFG-2",
            "sku": "SKU-2",
            "description": "Needs review",
            "packaging_level": "Case",
            "gtin": "10850068684998",
            "case_qty": "12",
            "length_in": "twelve inches",
            "width_in": "8",
            "height_in": "6",
            "gross_weight_lbs": "4",
            "verification_status": "NEEDS_REVIEW",
        }
        rows = [
            {
                "storefront": "Example", "config_id": "CFG-2", "sku": "SKU-2",
                "packaging_level": "Each", "gtin": "10850068684998", "case_qty": "1",
            },
            {
                "storefront": "Example", "config_id": "CFG-2", "sku": "SKU-2",
                "packaging_level": "Inner Pack", "gtin": "10850068684998", "case_qty": "5",
            },
            case_row,
            dict(case_row),
        ]

        quality = analyze_product_master_rows(rows)
        issue_codes = {issue["code"] for row in quality["rows"] for issue in row["issues"]}

        self.assertIn("duplicate_row", issue_codes)
        self.assertIn("duplicate_level", issue_codes)
        self.assertIn("invalid_dimensions", issue_codes)
        self.assertIn("hierarchy_conflict", issue_codes)
        self.assertGreater(quality["summary"]["invalid_rows"], 0)


if __name__ == "__main__":
    unittest.main()
