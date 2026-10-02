"""Digital-twin persistence in app/twin/twin.py.

Why this file exists: the twin tables held 0 rows after 34 real analyses, while
the UI showed no error at all. Two bugs stacked up, and the router swallows
update_twin() failures as "non-fatal", so neither surfaced:

  1. _load_twin() called resp.data on the None that maybe_single() returns when
     no row matches. A user with no twin crashed there -- so the twin was never
     created, so the next scan crashed too. Permanently self-blocking.

  2. The snapshot was inserted before the skin_twins row it references, so even
     with (1) fixed, the first scan died on foreign key 23503.

Both only fire on a user's FIRST scan, which is exactly the case no amount of
manual retesting on an already-seeded account would ever reveal.
"""
import pytest

from app.twin.twin import (
    ConditionScore, PredictResult, _load_twin, update_twin,
)


class _FakeTable:
    def __init__(self, db, name):
        self._db, self._name = db, name

    # -- read path
    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def maybe_single(self):
        self._db.maybe_single_used = True
        return self

    def execute(self):
        # The real client returns None, NOT an empty response, for a
        # maybe_single() that matched nothing. This is bug (1).
        return None if self._name == "skin_twins" and not self._db.twins else _Resp(
            self._db.twins[0] if self._db.twins else None
        )

    # -- write path
    def insert(self, row):
        if self._name == "skin_twin_snapshots":
            # Mirrors the real foreign key skin_twin_snapshots.twin_id ->
            # skin_twins.id. This is what caught bug (2).
            if not any(t["id"] == row["twin_id"] for t in self._db.twins):
                raise RuntimeError(
                    f"23503 foreign key violation: twin_id={row['twin_id']} "
                    "not present in skin_twins"
                )
            self._db.snapshots.append(row)
        return _Resp(row)

    def upsert(self, row, on_conflict=None):
        self._db.twins = [t for t in self._db.twins if t["id"] != row["id"]]
        self._db.twins.append(row)
        return _Resp(row)


class _Resp:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class _FakeDB:
    """Minimal Supabase stand-in that reproduces the two real behaviours."""

    def __init__(self):
        self.twins, self.snapshots = [], []
        self.maybe_single_used = False

    def table(self, name):
        return _FakeTable(self, name)


def _predict(condition="hormonal_acne", confidence=0.82):
    return PredictResult(
        image_id="img-1",
        analysis_result_id="ar-1",
        model_version="convnext_tiny",
        predictions=[ConditionScore(condition=condition, confidence=confidence)],
        primary_condition=condition,
        confidence_threshold_met=True,
        low_confidence_flag=False,
        face_geometry=None,
    )


def test_load_twin_tolerates_the_none_response():
    """Bug (1): maybe_single() returns None, and .data on it raises."""
    assert _load_twin(_FakeDB(), "user-1") is None


def test_first_ever_scan_creates_the_twin():
    """Bug (1) + (2) together: the case that produced 0 rows from 34 analyses."""
    db = _FakeDB()
    state = update_twin(db=db, user_id="user-1", predict_result=_predict(),
                        chat_feedback=None, fitzpatrick_skin_tone=None)
    assert len(db.twins) == 1, "no skin_twins row was written"
    assert len(db.snapshots) == 1, "no snapshot was written"
    assert state.scan_count == 1


def test_twin_row_is_written_before_its_snapshot():
    """Bug (2) stated directly: the parent must exist first.

    The fake raises 23503 on an orphaned snapshot exactly as Postgres does, so
    reverting the write order fails this test rather than silently regressing.
    """
    db = _FakeDB()
    update_twin(db=db, user_id="user-1", predict_result=_predict(),
                chat_feedback=None, fitzpatrick_skin_tone=None)
    assert db.snapshots[0]["twin_id"] == db.twins[0]["id"]


def test_second_scan_updates_rather_than_duplicates():
    db = _FakeDB()
    update_twin(db=db, user_id="user-1", predict_result=_predict(),
                chat_feedback=None, fitzpatrick_skin_tone=None)
    second = update_twin(db=db, user_id="user-1",
                         predict_result=_predict("xerosis", 0.70),
                         chat_feedback=None, fitzpatrick_skin_tone=None)
    assert len(db.twins) == 1, "upsert should not create a second twin"
    assert len(db.snapshots) == 2, "each scan should leave a snapshot"
    assert second.scan_count == 2
    assert second.dominant_condition == "xerosis"


def test_dryness_lowers_the_hydration_index():
    """The metric weights are keyed to the CURRENT taxonomy.

    They were previously keyed to the old class names, so every metric read as
    perfect skin regardless of the photo. A rename cannot be caught by types.
    """
    db = _FakeDB()
    first = update_twin(db=db, user_id="user-1", predict_result=_predict(),
                        chat_feedback=None, fitzpatrick_skin_tone=None)
    dry = update_twin(db=db, user_id="user-1",
                      predict_result=_predict("xerosis", 0.90),
                      chat_feedback=None, fitzpatrick_skin_tone=None)
    assert dry.hydration_index < first.hydration_index


def test_low_confidence_writes_nothing():
    """An abstained prediction must not pollute the longitudinal record."""
    db = _FakeDB()
    pr = _predict()
    pr.low_confidence_flag = True
    update_twin(db=db, user_id="user-1", predict_result=pr,
                chat_feedback=None, fitzpatrick_skin_tone=None)
    assert db.twins == [] and db.snapshots == []
