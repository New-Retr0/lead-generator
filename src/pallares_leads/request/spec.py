from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CorridorFilter(BaseModel):
    road_ref: str
    buffer_m: int = 800


class BudgetCap(BaseModel):
    max_firecrawl_credits: int = 200
    max_usd: float = 10.0


class LeadRequestSpec(BaseModel):
    target_kind: Literal["property", "vendor"] = "property"
    count: int = Field(ge=1, le=500)
    categories: list[str] = Field(default_factory=list)
    market_keys: list[str] = Field(default_factory=list)
    corridor: CorridorFilter | None = None
    require_decision_maker: bool = True
    recurring_only: bool = False
    min_lead_score: int = Field(default=40, ge=0, le=100)
    budget: BudgetCap = Field(default_factory=BudgetCap)
    needs_confirmation: list[str] = Field(default_factory=list)
    raw_prompt: str = ""

    def summary_lines(self) -> list[str]:
        lines = [
            f"Target: {self.target_kind}, count={self.count}",
            f"Markets: {', '.join(self.market_keys) or '(none)'}",
            f"Categories: {', '.join(self.categories) or '(none)'}",
            f"Min lead score: {self.min_lead_score}",
            f"Budget: {self.budget.max_firecrawl_credits} Firecrawl credits, "
            f"${self.budget.max_usd:.2f} USD cap",
        ]
        if self.corridor:
            lines.append(f"Corridor: {self.corridor.road_ref} (±{self.corridor.buffer_m}m)")
        if self.require_decision_maker:
            lines.append("Require decision-maker contact")
        if self.recurring_only:
            lines.append("Recurring-program properties only")
        if self.needs_confirmation:
            lines.append("Needs confirmation:")
            lines.extend(f"  - {item}" for item in self.needs_confirmation)
        return lines
