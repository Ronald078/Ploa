"""No real provider requests: deterministic Overpass responses, time and waits."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import requests
from crm.search_overpass import (OverpassClient, OverpassEmEspera, ConsultaPesada,
                                 HTTP_TIMEOUT, QUERY_SECONDS, query_overpass,
                                 retry_cities, split_bbox)

BBOX = (0, 0, 2, 2)
FILTERS = [[("shop", "clothes")], [("amenity", "marketplace")]]


def response(data=None, status=200, headers=None):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps(data if data is not None else {"elements": []}).encode()
    result._content_consumed = True
    result.headers.update(headers or {})
    return result


def element(number, kind="node"):
    return {"type": kind, "id": number, "tags": {"name": "Fictício"}}


class Fixture:
    def __init__(self, answers, urls=("fixture://one",)):
        self.answers = iter(answers)
        self.calls, self.waits, self.logs = [], [], []
        self.clock = 0
        self.client = OverpassClient(urls, self, lambda fn, *a, **kw: fn(*a, **kw),
                                    lambda: None, self.wait, self.logs.append, lambda: self.clock)

    def wait(self, seconds):
        self.waits.append(seconds)
        self.clock += seconds

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        answer = next(self.answers)
        if isinstance(answer, BaseException):
            raise answer
        return answer


class OverpassTests(unittest.TestCase):
    def test_timeout_margin_filters_and_single_query(self):
        fixture = Fixture([response({"elements": [element(1), element(1), element(1, "way")]})])
        result = fixture.client.search(BBOX, FILTERS)
        self.assertEqual(len(result), 2)
        self.assertEqual(fixture.calls[0][1]["timeout"], (10, 90))
        self.assertGreater(HTTP_TIMEOUT[1], QUERY_SECONDS + 15)
        self.assertIn('[timeout:60]', fixture.calls[0][1]["data"]["data"])
        self.assertIn('["amenity"="marketplace"]', fixture.calls[0][1]["data"]["data"])

    def test_heavy_query_splits_entire_area_and_deduplicates_boundaries(self):
        fixture = Fixture([response({"elements": [], "remark": "runtime error: Query timed out"})] +
                          [response({"elements": [element(10), element(i)]}) for i in range(4)])
        progress, saved = {}, []
        result = fixture.client.search(BBOX, FILTERS, progress, lambda: saved.append(len(progress.get("parts", {}))))
        self.assertEqual(len(fixture.calls), 5)
        self.assertEqual(len(result), 5)
        self.assertEqual(saved, [0, 1, 2, 3, 4])
        self.assertEqual(split_bbox(BBOX), [(0, 0, 1, 1), (0, 1, 1, 2), (1, 0, 2, 1), (1, 1, 2, 2)])
        for request, box in zip(fixture.calls[1:], split_bbox(BBOX)):
            self.assertEqual(request[1]["data"]["data"], query_overpass(box, FILTERS))
        self.assertEqual(fixture.waits, [1] * 4)

    def test_read_timeout_uses_smaller_parts_on_available_instance(self):
        fixture = Fixture([requests.ReadTimeout("fixture")] + [response() for _ in range(4)],
                          urls=("fixture://one", "fixture://two"))
        self.assertEqual(fixture.client.search(BBOX, FILTERS), [])
        self.assertEqual([request[0] for request in fixture.calls], ["fixture://one"] + ["fixture://two"] * 4)

    def test_502_does_not_multiply_queries_and_cooldown_is_respected(self):
        fixture = Fixture([response(status=502), response(status=502), response()],
                          urls=("fixture://one", "fixture://two"))
        progress = {}
        with self.assertRaises(OverpassEmEspera):
            fixture.client.search(BBOX, FILTERS, progress)
        self.assertEqual(progress, {})
        with self.assertRaises(OverpassEmEspera):
            fixture.client.search(BBOX, FILTERS)
        self.assertEqual(len(fixture.calls), 2)
        fixture.clock += 20
        self.assertEqual(fixture.client.search(BBOX, FILTERS), [])

    def test_rate_limit_honors_retry_after_without_subdivision(self):
        fixture = Fixture([response(status=429, headers={"Retry-After": "120"}), response(), response()],
                          urls=("fixture://one", "fixture://two"))
        self.assertEqual(fixture.client.search(BBOX, FILTERS), [])
        self.assertEqual(fixture.client.state["fixture://one"]["retry_at"], 120)
        self.assertEqual(fixture.client.search(BBOX, FILTERS), [])
        self.assertEqual([item[0] for item in fixture.calls], ["fixture://one", "fixture://two", "fixture://two"])

    def test_incomplete_response_is_never_a_success(self):
        for payload in [{"remark": "Incomplete response", "elements": [element(1)]}, {}, {"elements": [{}]}]:
            fixture = Fixture([response(payload)])
            with self.assertRaises(OverpassEmEspera):
                fixture.client.search(BBOX, FILTERS)

    def test_failed_tile_is_pending_and_successful_tiles_survive_restart(self):
        fixture = Fixture([response({"remark": "Query timed out", "elements": []}),
                           response({"elements": [element(1)]}), response(status=502)])
        progress = {}
        with self.assertRaises(OverpassEmEspera):
            fixture.client.search(BBOX, FILTERS, progress)
        self.assertEqual(list(progress["parts"]), ["0"])
        checkpoint = json.loads(json.dumps(progress))
        resumed = Fixture([response({"elements": [element(i)]}) for i in (2, 3, 4)])
        result = resumed.client.search(BBOX, FILTERS, checkpoint)
        self.assertEqual([item["id"] for item in result], [1, 2, 3, 4])
        self.assertEqual(len(resumed.calls), 3)
        self.assertEqual(resumed.calls[0][1]["data"]["data"], query_overpass(split_bbox(BBOX)[1], FILTERS))

    def test_child_failure_cannot_recursively_expand_forever(self):
        fixture = Fixture([response({"remark": "Query timed out", "elements": []})] * 2)
        progress = {}
        with self.assertRaises(ConsultaPesada):
            fixture.client.search(BBOX, FILTERS, progress)
        self.assertEqual(len(fixture.calls), 2)
        self.assertEqual(progress["parts"], {})

    def test_changed_area_invalidates_subdivision_cache(self):
        fixture = Fixture([response()])
        progress = {"bbox": [-1, -1, 0, 0], "parts": {"0": [element(99)]}}
        self.assertEqual(fixture.client.search(BBOX, FILTERS, progress), [])
        self.assertEqual(progress, {})

    def test_bad_request_is_not_retried_on_every_instance(self):
        fixture = Fixture([response(status=400)], urls=("fixture://one", "fixture://two"))
        with self.assertRaises(requests.HTTPError):
            fixture.client.search(BBOX, FILTERS)
        self.assertEqual(len(fixture.calls), 1)

    def test_stop_propagates_before_any_request(self):
        fixture = Fixture([])
        def stop():
            raise SystemExit(0)
        fixture.client.check_stop = stop
        with self.assertRaises(SystemExit):
            fixture.client.search(BBOX, FILTERS)
        self.assertEqual(fixture.calls, [])

    def test_retry_passes_are_bounded_and_skip_completed_cities(self):
        completed, waited, visits = set(), [], []
        for _, city in retry_cities(["A", "B"], completed, waited.append, log=lambda _: None):
            visits.append(city)
            if city == "A":
                completed.add(city)
        self.assertEqual(visits, ["A", "B", "B", "B"])
        self.assertEqual(waited, [20, 60])


if __name__ == "__main__":
    unittest.main(verbosity=2)
