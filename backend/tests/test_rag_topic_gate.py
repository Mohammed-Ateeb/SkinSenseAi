"""The knowledge gate in app/rag/retriever.py.

Why this file exists: the seeded knowledge base (migration 005) was written for
the OLD six-condition taxonomy. After the move to 12 hormonal/seasonal classes,
retrieval was measured against the live database and 8 of 12 classes came back
with the WRONG condition -- "seborrhea" retrieved seborrheic keratoses (a benign
tumour), "melasma" and "sunburn" retrieved rosacea, "chapped_lips" retrieved
eczema wet-wrap protocols. Raising the similarity threshold filtered none of it,
because all dermatology prose scores alike under cosine distance.

Nothing failed loudly. The LLM just received confident, well-written text about
a different disease and grounded its advice in it. These tests exist so that
regression cannot happen silently again.
"""
import pytest

from app.ml.model_loader import CLASS_NAMES
from app.rag.retriever import _ALLOWED_TOPICS, KnowledgeContext, RagRetriever


# Every condition value present in migration 005's seed.
SEEDED_TOPICS = {
    "acne", "eczema", "psoriasis", "rosacea",
    "seborrheic_keratoses", "tinea", "general",
}


def _k(condition: str) -> KnowledgeContext:
    return KnowledgeContext(
        chunk_id="x", content="...", condition=condition,
        source="test", similarity=0.9,
    )


class _FakeSupabase:
    """Returns every seeded topic as a hit, highest-similarity first.

    This is the worst case for similarity-based filtering: the off-topic chunks
    outrank the correct one. Only a gate on the condition column can save it.
    """

    def __init__(self, rows):
        self._rows = rows

    def rpc(self, name, params):
        rows = [] if name == "match_products" else self._rows[: params["match_count"]]
        return _FakeResp(rows)


class _FakeResp:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


def _retriever() -> RagRetriever:
    # Deliberately adversarial order: the right answer is never first.
    rows = [
        {"id": t, "content": f"text about {t}", "condition": t,
         "source": "seed", "similarity": 0.9 - i * 0.01}
        for i, t in enumerate(
            ["rosacea", "seborrheic_keratoses", "psoriasis",
             "acne", "eczema", "tinea", "general"]
        )
    ]
    return RagRetriever(_FakeSupabase(rows))


def test_every_class_is_gated():
    """A class missing from the map is ungated, so the map must be exhaustive."""
    assert set(_ALLOWED_TOPICS) == set(CLASS_NAMES)


def test_allowed_topics_exist_in_the_seed():
    """A typo'd topic name would silently gate everything away."""
    for cls, topics in _ALLOWED_TOPICS.items():
        unknown = topics - SEEDED_TOPICS
        assert not unknown, f"{cls} allows topics not in the seed: {unknown}"


def test_general_is_always_allowed():
    """Barrier science and phototypes hold for any condition, so never gate them out."""
    for cls, topics in _ALLOWED_TOPICS.items():
        assert "general" in topics, f"{cls} would reject the general knowledge"


@pytest.mark.parametrize("cls", CLASS_NAMES)
def test_no_class_retrieves_a_wrong_condition(cls):
    """The regression itself: off-topic chunks must not survive, even ranked first."""
    knowledge = _retriever().retrieve(cls).knowledge
    assert knowledge, f"{cls} retrieved nothing at all"
    for chunk in knowledge:
        assert chunk.condition in _ALLOWED_TOPICS[cls], (
            f"{cls} retrieved {chunk.condition!r} -- the exact bug this gate fixes"
        )


def test_seborrhea_never_retrieves_seborrheic_keratoses():
    """Named explicitly: the two words are near-identical but one is a tumour.

    This pair is why the gate cannot be built from string similarity either.
    """
    topics = {k.condition for k in _retriever().retrieve("seborrhea").knowledge}
    assert "seborrheic_keratoses" not in topics


def test_uncovered_classes_get_general_only():
    """Honest emptiness beats confident wrongness: no specific topic is better
    than the wrong specific topic, because the LLM falls back on its own
    knowledge -- the behaviour that predates RAG entirely."""
    for cls in ("melasma", "hirsutism", "miliaria", "chapped_lips"):
        assert _ALLOWED_TOPICS[cls] == {"general"}


def test_unknown_class_is_not_filtered():
    """A condition outside the taxonomy must degrade to plain similarity search,
    not to an empty context."""
    assert _retriever().retrieve("some_future_class").knowledge
