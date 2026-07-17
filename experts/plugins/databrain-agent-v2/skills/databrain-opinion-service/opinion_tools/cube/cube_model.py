from typing import Literal, Optional, Union, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Filter(BaseModel):
    member: str = Field(..., description="The field to filter on, e.g. 'Orders.status'")
    operator: str = Field(
        ...,
        description="The filter operator, e.g. 'equals','notEquals','in','contains','gt','gte','lt','lte','inDateRange'",
    )
    values: Optional[list[str]] = Field(None, description="The values to filter by.")

    model_config = ConfigDict(extra="forbid")


class FilterGroup(BaseModel):
    """Filter group for logical OR/AND combinations"""

    or_: Optional[list[Filter]] = Field(
        None,
        alias="or",
        description="List of filters combined with OR logic. At least one of 'or' or 'and' must be provided.",
    )
    and_: Optional[list[Filter]] = Field(
        None,
        alias="and",
        description="List of filters combined with AND logic. At least one of 'or' or 'and' must be provided.",
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def validate_at_least_one(cls, values: Any) -> Any:
        """Validate that at least one of 'or' or 'and' is provided"""
        if isinstance(values, dict):
            if not values.get("or") and not values.get("and"):
                raise ValueError(
                    "At least one of 'or' or 'and' must be provided in FilterGroup"
                )
        return values


class TimeDimension(BaseModel):
    dimension: str = Field(..., description="Name of the time dimension")
    granularity: Optional[
        Literal["second", "minute", "hour", "day", "week", "month", "quarter", "year"]
    ] = Field(None, description="Time granularity")
    dateRange: Union[list[str], str] = Field(
        ...,
        description="Pair of dates ISO dates representing the start and end of the range. Alternatively, a string representing a relative date range of the form: 'last N days', 'today', 'yesterday', 'last year', etc.",
    )

    model_config = ConfigDict(extra="forbid")


class Query(BaseModel):
    measures: list[str] = Field([], description="Numeric metrics to aggregate.Use only fields from the measures list. Do not put dimension here.")
    dimensions: list[str] = Field(
        [],
        description="Categorical fields for grouping data. Use only fields from the dimensions list. Avoid using measures here. Do not include date field here (use timeDimensions). Must include the field in dimensions list.",
    )
    timeDimensions: list[TimeDimension] = Field(
        [], description="Time dimensions to group by"
    )
    filters: list[Filter] = Field([], description="Filter conditions. Use only fields from the dimensions list. Do not include time fields (use timeDimensions). MANDATORY: if user specifies a platform (e.g. TikTok, YouTube) add channel_code filter; if user specifies a region or country (e.g. SEA, 东南亚, Japan) add region_code country_code or language_code filter.")
    limit: Optional[int] = Field(
        1000, description="Maximum number of rows to return. Defaults to 1000"
    )
    offset: Optional[int] = Field(
        0, description="Number of rows to skip. Defaults to 0"
    )
    order: Optional[dict[str, Literal["asc", "desc"]]] = Field(
        {},
        description='Ordering of the results. MUST be a JSON object (NOT an array). e.g. {"feeds.date": "asc"} or {"hotness.engagement": "desc"}. Multiple fields: {"hotness.engagement": "desc", "hotness.date": "asc"}.',
    )

    @field_validator("order", mode="before")
    @classmethod
    def normalize_order(cls, v: Any) -> Any:
        """Normalize order field: convert list-of-dicts format to a single dict.

        LLMs occasionally generate order as a list e.g. [{"field": "desc"}] instead
        of the correct dict format {"field": "desc"}.  This validator merges any
        such list into a single dict so Pydantic validation succeeds.
        """
        if isinstance(v, list):
            merged: dict = {}
            for item in v:
                if isinstance(item, dict):
                    merged.update(item)
            return merged
        return v

    legends: Optional[str] = Field(
        None,
        description="One dimension field to split results into multiple series for direct comparison. Only select one dimension field (e.g., 'game_name' to compare different games, or 'language' to compare different languages)."
    )
    ungrouped: bool = Field(
        False,
        description="Return results without grouping by dimensions. Instead, return all rows. This can be useful for fetching details, such as top videos, news etc.",
    )

    model_config = ConfigDict(extra="forbid")

class ExtendQuery(Query):
    filters: list[Union[Filter, FilterGroup]] = Field(
        [],
        description="Filter conditions. Use only fields from the dimensions list. Do not include time fields (use timeDimensions). MANDATORY: if user specifies a platform (e.g. TikTok, YouTube) add channel_code filter; if user specifies a region or country (e.g. SEA, 东南亚, Japan) add region_code country_code or language_code filter.",
    )

    model_config = ConfigDict(extra="forbid")