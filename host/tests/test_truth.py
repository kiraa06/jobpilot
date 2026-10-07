import copy
import unittest

from jobpilot.truth import pin_basics, truth_check

ORIGINAL = {
    "basics": {"firstName": "Asha", "lastName": "Verma", "email": "asha@example.com", "phone": "+91 98765 43210",
               "headline": "DevOps Engineer", "summary": "Old summary", "location": "Bengaluru"},
    "experience": [
        {"company": "Acme Corp", "title": "Senior DevOps Engineer", "start": "Jan 2021", "end": "Present",
         "location": "", "bullets": ["Ran Kubernetes"]},
        {"company": "Beta Ltd", "title": "SRE", "start": "2018", "end": "2020", "location": "", "bullets": []},
    ],
    "education": [{"institution": "NIT Calicut", "degree": "B.Tech", "field": "CSE", "start": "", "end": "2016", "grade": ""}],
    "skills": [{"group": "Cloud", "items": ["AWS", "Kubernetes"]}],
    "projects": [{"name": "kube-cost", "description": "Cost dashboards", "bullets": ["Saved 30%"], "link": ""}],
    "certifications": [{"name": "CKA", "issuer": "CNCF", "date": "2022"}],
}


class TruthTest(unittest.TestCase):
    def test_reworded_and_reordered_passes(self):
        t = copy.deepcopy(ORIGINAL)
        t["experience"][0]["bullets"] = ["Operated 40-service Kubernetes platform"]
        t["experience"].reverse()
        t["experience"][1]["company"] = "acme  corp"  # case/space differences are fine
        t["skills"][0]["items"] = ["Kubernetes", "AWS"]
        self.assertEqual(truth_check(ORIGINAL, t), {"blocking": [], "warnings": []})

    def test_dropping_entries_is_allowed(self):
        t = copy.deepcopy(ORIGINAL)
        t["experience"] = t["experience"][:1]
        t["certifications"] = []
        self.assertEqual(truth_check(ORIGINAL, t)["blocking"], [])

    def test_invented_role_blocks(self):
        t = copy.deepcopy(ORIGINAL)
        t["experience"].append({"company": "Google", "title": "Staff SRE", "start": "2015", "end": "2017",
                                "location": "", "bullets": []})
        blocking = truth_check(ORIGINAL, t)["blocking"]
        self.assertEqual(len(blocking), 1)
        self.assertIn("Google", blocking[0])

    def test_changed_dates_block(self):
        t = copy.deepcopy(ORIGINAL)
        t["experience"][1]["start"] = "2016"
        self.assertEqual(len(truth_check(ORIGINAL, t)["blocking"]), 1)

    def test_invented_degree_and_cert_block(self):
        t = copy.deepcopy(ORIGINAL)
        t["education"][0]["degree"] = "M.Tech"
        t["certifications"].append({"name": "AWS SA Pro", "issuer": "AWS", "date": "2023"})
        self.assertEqual(len(truth_check(ORIGINAL, t)["blocking"]), 2)

    def test_invented_project_blocks(self):
        t = copy.deepcopy(ORIGINAL)
        t["projects"][0]["description"] = "Kubernetes cost dashboards for 40 teams"  # rewording is fine
        t["projects"].append({"name": "Terraform Operator", "description": "", "bullets": [], "link": ""})
        blocking = truth_check(ORIGINAL, t)["blocking"]
        self.assertEqual(len(blocking), 1)
        self.assertIn("Project", blocking[0])
        self.assertIn("Terraform Operator", blocking[0])

    def test_changed_education_end_year_blocks(self):
        t = copy.deepcopy(ORIGINAL)
        t["education"][0]["end"] = "2015"
        self.assertEqual(len(truth_check(ORIGINAL, t)["blocking"]), 1)

    def test_changed_education_field_blocks(self):
        t = copy.deepcopy(ORIGINAL)
        t["education"][0]["field"] = "Data Science"
        self.assertEqual(len(truth_check(ORIGINAL, t)["blocking"]), 1)

    def test_changed_certification_date_blocks(self):
        t = copy.deepcopy(ORIGINAL)
        t["certifications"][0]["date"] = "2019"
        self.assertEqual(len(truth_check(ORIGINAL, t)["blocking"]), 1)

    def test_changed_certification_issuer_blocks(self):
        t = copy.deepcopy(ORIGINAL)
        t["certifications"][0]["issuer"] = "Linux Foundation"
        self.assertEqual(len(truth_check(ORIGINAL, t)["blocking"]), 1)

    def test_new_skill_warns_once(self):
        t = copy.deepcopy(ORIGINAL)
        t["skills"] = [{"group": "Cloud", "items": ["AWS", "Terraform"]}, {"group": "IaC", "items": ["terraform"]}]
        self.assertEqual(truth_check(ORIGINAL, t), {"blocking": [], "warnings": ["New skill: Terraform"]})

    def test_pins_basics_except_headline_summary(self):
        t = copy.deepcopy(ORIGINAL)
        t["basics"].update({"email": "fake@x.com", "phone": "000", "headline": "Platform Engineer", "summary": "New"})
        pinned = pin_basics(ORIGINAL, t)
        self.assertEqual(pinned["basics"]["email"], "asha@example.com")
        self.assertEqual(pinned["basics"]["phone"], "+91 98765 43210")
        self.assertEqual(pinned["basics"]["headline"], "Platform Engineer")
        self.assertEqual(pinned["basics"]["summary"], "New")
        self.assertEqual(t["basics"]["email"], "fake@x.com", "input must not be mutated")


if __name__ == "__main__":
    unittest.main()
