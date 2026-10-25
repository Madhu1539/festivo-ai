"""Storage-layer helpers that are hard to reach through the API.

The endpoints are covered in test_api.py; these are the small coercion
helpers whose edge cases only appear with data the API cannot produce, such
as a row written by an older schema version.
"""

from __future__ import annotations

from app.services.storage import _event_type, _event_type_label


def test_known_event_types_pass_through():
    for value in ("wedding", "birthday", "community"):
        assert _event_type(value) == value


def test_an_unknown_event_type_falls_back_to_community():
    assert _event_type("gala") == "community"
    assert _event_type("") == "community"


def test_the_label_always_agrees_with_the_coerced_type():
    """Regression: the type and its label were derived from different values.

    The type was coerced to the enum while the label fell back to
    `value.title()`, so a row could come back as type "community" labelled
    "Gala" — output that contradicts itself rather than degrading cleanly.
    """
    assert _event_type("gala") == "community"
    assert _event_type_label("gala") == "Community Event"


def test_known_types_get_their_proper_labels():
    assert _event_type_label("wedding") == "Wedding"
    assert _event_type_label("birthday") == "Birthday"
    assert _event_type_label("community") == "Community Event"
