import unittest
from pathlib import Path

from labelkit.customer_workflows import detect_customer_id, load_customer_workflows


class CustomerWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.workflows = load_customer_workflows(root / "data" / "customer_workflows.json")

    def test_registry_contains_supported_partner_customers(self):
        self.assertEqual(
            [workflow["id"] for workflow in self.workflows],
            ["decopac", "dutch_bros", "fancy"],
        )

    def test_customer_is_detected_from_email_text(self):
        cases = {
            "orders@decopac.com": "decopac",
            "shipping-dutchbrothers@example.com": "dutch_bros",
            "fancy.sprinkles+orders@example.com": "fancy",
            "unrelated@example.com": "",
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(detect_customer_id(value, self.workflows), expected)


if __name__ == "__main__":
    unittest.main()
