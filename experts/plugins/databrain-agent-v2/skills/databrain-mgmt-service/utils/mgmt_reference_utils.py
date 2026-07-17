from __future__ import annotations

from loguru import logger
from run_context_wrapper import RunContextWrapper

from utils.context import GameContext, ReferenceItem


MGMT_REFERENCE_URL_BY_MODULE: dict[str, str] = {
    "business": "/v2/strategic/home",
    "all_studio": "/v2/strategic/home?tab=studio&subtitle=portfolio",
    "studio": "/v2/strategic/home?tab=studio&subtitle=studio",
    "publishing": "/v2/strategic/home?tab=publishing&subtitle=overview",
}

# # Previous per-module titles (unified below for display)
# MGMT_REFERENCE_TITLE_BY_MODULE: dict[str, str] = {
#     "business": "Management Dashboard Business Overview",
#     "all_studio": "Management Dashboard Studio Management",
#     "studio": "Management Dashboard Studio Management",
#     "publishing": "Publishing Management",
# }

MGMT_REFERENCE_DEFAULT_URL = "/v2/strategic/home"
MGMT_REFERENCE_TITLE = "Management Dashboard"


def _is_mgmt_strategic_reference_url(url: str) -> bool:
    """True for any /v2/strategic/home link (with or without query), i.e. MGMT dashboard refs."""
    u = (url or "").strip()
    if not u:
        return False
    base = u.split("?", 1)[0].rstrip("/")
    return base == "/v2/strategic/home"


def append_mgmt_reference_for_module(context: RunContextWrapper[GameContext], module: str) -> None:
    """
    Ensure exactly one Management Dashboard reference on `context.context.references`.

    - URL comes from `MGMT_REFERENCE_URL_BY_MODULE` for this call's `module` (same as before).
    - If this call would introduce more than one distinct MGMT strategic-home URL together with
      any already present MGMT links, use `MGMT_REFERENCE_DEFAULT_URL` (business) only.
    - Title is always MGMT_REFERENCE_TITLE.
    - Preserves non-MGMT references.
    """
    try:
        m = (module or "").strip().lower()
        candidate_url = MGMT_REFERENCE_URL_BY_MODULE.get(m, MGMT_REFERENCE_DEFAULT_URL)
        title = MGMT_REFERENCE_TITLE

        # Normalize references container: it should be a flat list[dict|ReferenceItem]
        refs = getattr(context.context, "references", None)
        if refs is None:
            context.context.references = []
            refs = context.context.references

        if isinstance(refs, list) and refs and isinstance(refs[0], list):
            flat: list = []
            for item in refs:
                if isinstance(item, list):
                    flat.extend(item)
                else:
                    flat.append(item)
            context.context.references = flat
            refs = flat

        if not isinstance(refs, list):
            context.context.references = []
            refs = context.context.references

        def _get_url(x) -> str:
            if isinstance(x, dict):
                return str(x.get("url", "") or "")
            return str(getattr(x, "url", "") or "")

        non_mgmt: list = []
        existing_mgmt_urls: set[str] = set()
        for x in refs:
            u = _get_url(x)
            if _is_mgmt_strategic_reference_url(u):
                existing_mgmt_urls.add(u)
            else:
                non_mgmt.append(x)

        unique_mgmt_urls = existing_mgmt_urls | {candidate_url}
        if len(unique_mgmt_urls) > 1:
            final_url = MGMT_REFERENCE_DEFAULT_URL
        else:
            final_url = next(iter(unique_mgmt_urls))

        refs.clear()
        refs.extend(non_mgmt)

        ref = ReferenceItem(
            type="databrain",
            url=final_url,
            title=title,
            name=title,
            favicon="",
            image_url="",
            mobile_url="",
        ).to_dict()
        refs.append(ref)
    except Exception as e:
        logger.warning(f"(append_mgmt_reference_for_module) failed: {e}")
