"""End-to-end smoke test against the running backend.

Not part of the pytest suite: this one deliberately calls the real Gemini API
and the real Supabase database, so it is run by hand.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from decimal import Decimal
from urllib import error, request

BASE = "http://127.0.0.1:8000/api"

EVENT = {
    "event_type": "wedding",
    "event_name": "Smoke Test Wedding",
    "event_date": (date.today() + timedelta(days=100)).isoformat(),
    "budget": 800000,
    "guest_count": 250,
    "location": "Bhopal, Madhya Pradesh",
    "theme": "Elegant marigold",
    "preferences": ["Budget-friendly", "Photo corner"],
    "accessibility_needs": "Step-free access and seating for elders",
    "food_preference": "Pure vegetarian, no onion or garlic",
}

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    if not condition:
        failures.append(label)


def call(method: str, path: str, payload=None, timeout=240):
    body = json.dumps(payload).encode() if payload is not None else None
    req = request.Request(
        f"{BASE}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except error.HTTPError as exc:
        raw = exc.read()
        return exc.code, (json.loads(raw) if raw else None)


print("\n1. Health")
status, health = call("GET", "/health")
check("health returns 200", status == 200)
check("gemini configured", health["ai"]["configured"] is True)
check("database reachable", health["database"]["persistence_enabled"] is True)
check("api key never echoed", "AIza" not in json.dumps(health))

print("\n2. Generate a plan (live Gemini call)")
status, plan = call("POST", "/events/generate-plan", EVENT)
if status != 200:
    print(f"  FAIL  generation returned {status}: {plan}")
    sys.exit(1)

check("returns 200", status == 200)
b = plan["budget"]
print(
    f"        B={b['total_budget']:,.2f}  P={b['planned_expenditure']:,.2f}  "
    f"R={b['emergency_reserve']:,.2f}  U={b['unallocated']:,.2f}"
)

print("\n3. The four required outputs (§2.3)")
check("budget breakdown", len(b["categories"]) >= 5, f"{len(b['categories'])} categories")
check("timeline", len(plan["timeline"]) >= 1, f"{len(plan['timeline'])} items")
check(
    "vendor checklist",
    len(plan["vendor_checklist"]) >= 1,
    f"{len(plan['vendor_checklist'])} items",
)
check(
    "personalized ideas",
    len(plan["personalized_ideas"]) >= 1,
    f"{len(plan['personalized_ideas'])} ideas",
)

print("\n4. Budget arithmetic (§9.3)")
B = Decimal(str(b["total_budget"]))
P = Decimal(str(b["planned_expenditure"]))
R = Decimal(str(b["emergency_reserve"]))
U = Decimal(str(b["unallocated"]))
allocated = Decimal(str(b["total_allocated"]))

check("B is exactly what was submitted", B == Decimal("800000"))
check("P + R == total_allocated", abs(P + R - allocated) <= Decimal("0.01"))
check("U == B - P - R", abs(U - (B - P - R)) <= Decimal("0.01"))
check("P + R <= B", allocated <= B)
check("is_valid agrees", b["is_valid"] is (allocated <= B))

category_sum = sum(Decimal(str(c["estimated_amount"])) for c in b["categories"])
check(
    "categories sum to P + R",
    abs(category_sum - allocated) <= Decimal("0.50"),
    f"{category_sum:,.2f} vs {allocated:,.2f}",
)
reserves = [c for c in b["categories"] if c["is_reserve"]]
check("exactly one reserve category", len(reserves) == 1)

print("\n5. Timeline dates (§10.3)")
today = date.today()
event_day = date.fromisoformat(EVENT["event_date"])
bad_dates = [
    i["title"]
    for i in plan["timeline"]
    if not i["is_follow_up"]
    and not (today <= date.fromisoformat(i["due_date"]) <= event_day)
]
check("no task falls outside the planning window", not bad_dates, str(bad_dates[:2]))
dates = [date.fromisoformat(i["due_date"]) for i in plan["timeline"] if not i["is_follow_up"]]
check("tasks are in chronological order", dates == sorted(dates))

print("\n6. Safety rules (§5.3, §19)")
check(
    "estimate disclaimer present",
    "estimate" in plan["estimate_disclaimer"].lower(),
)
text = json.dumps(plan).lower()
check("no phone numbers invented", "+91" not in text and "phone:" not in text)
check(
    "nothing claimed as booked",
    "has been booked" not in text and "we booked" not in text,
)

print("\n7. User requirements echoed back (§15.3)")
check(
    "accessibility need preserved",
    plan["event_summary"]["accessibility_needs"] == EVENT["accessibility_needs"],
)
check(
    "food preference preserved",
    plan["event_summary"]["food_preference"] == EVENT["food_preference"],
)

print("\n8. Save, reload, tick, delete (§15.4-15.6)")
status, created = call("POST", "/events", {"event": EVENT, "plan": plan})
check("save returns 201", status == 201)
event_id = created["id"]

try:
    status, reloaded = call("GET", f"/events/{event_id}")
    check("reload returns 200", status == 200)
    rb = reloaded["plan"]["budget"]
    check(
        "saved figures match generated ones",
        all(
            rb[field] == b[field]
            for field in (
                "total_budget",
                "planned_expenditure",
                "emergency_reserve",
                "unallocated",
                "total_allocated",
            )
        ),
    )
    check(
        "optional requirements survived the round trip",
        reloaded["plan"]["event_summary"]["accessibility_needs"]
        == EVENT["accessibility_needs"],
    )

    item_id = plan["vendor_checklist"][0]["id"]
    status, patched = call(
        "PATCH", f"/events/{event_id}/checklist/{item_id}", {"is_completed": True}
    )
    check("checklist tick returns 200", status == 200)

    status, after = call("GET", f"/events/{event_id}")
    check("progress reflects the tick", after["plan"]["checklist_progress"]["completed"] == 1)

    status, listing = call("GET", "/events")
    check("event appears in the list", any(e["id"] == event_id for e in listing))

    status, overview = call("GET", "/events/overview")
    check("overview counts real data", overview["total_events"] >= 1)
finally:
    status, _ = call("DELETE", f"/events/{event_id}")
    check("delete returns 204", status == 204)
    status, _ = call("GET", f"/events/{event_id}")
    check("deleted event is gone", status == 404)

print("\n9. Validation and error envelope (§15.7)")
status, err = call("POST", "/events/generate-plan", {**EVENT, "budget": -5})
check("negative budget rejected", status == 422)
check("error uses the envelope", "error" in (err or {}) and "code" in err["error"])

status, err = call(
    "POST", "/events/generate-plan", {**EVENT, "event_date": "2020-01-01"}
)
check("past date rejected", status == 422)

status, err = call("GET", "/events/does-not-exist")
check("unknown event is a 404 envelope", status == 404 and "error" in (err or {}))

status, err = call("GET", "/no-such-route")
check(
    "unknown route uses the same envelope",
    status == 404 and "error" in (err or {}),
)

print("\n10. Rate limiting (§19.5)")
codes = []
for _ in range(12):
    code, _body = call("POST", "/events/generate-plan", {"event_type": "bad"}, timeout=30)
    codes.append(code)
check(
    "generation endpoint is rate limited",
    429 in codes,
    f"saw {codes.count(429)} of 12 blocked",
)

print(f"\n{'=' * 52}")
if failures:
    print(f"{len(failures)} CHECK(S) FAILED:")
    for item in failures:
        print(f"  - {item}")
    sys.exit(1)
print("All smoke checks passed.")
