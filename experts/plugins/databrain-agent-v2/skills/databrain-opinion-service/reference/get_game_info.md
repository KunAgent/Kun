# get_game_info / get_game_information

Resolve game IDs and game metadata from game names for opinion workflows.

## Signature

```text
game_names: List[str]                # REQUIRED
reference_type: str = "KeyOpinions"  # optional page type for reference links
```

## Notes

- Runtime tool name is `get_game_information` (preferred).
- `get_game_info` is used in code-level helper logic and historical references.
- Returns game IDs, release dates, and other essential game metadata for downstream opinion tools.

## Best For

- Before opinion queries, resolve canonical game IDs and names
- Multi-game tasks: pass all game names in one call

## Rules

- **Supports BATCH processing** — you can query **MULTIPLE games in a single call** for better efficiency. When comparing games or analyzing multiple games, always pass ALL game names in one call instead of making separate calls.
  - Example: `game_names=["PUBGM", "Nikke", "GTA5"]` — queries all games at once.
- Always call this tool **before** other opinion tools to ensure game IDs are resolved.
