# youtube_url_analysis_tool

Analyze specific YouTube video URLs (comments or video transcript).

## Signature

```text
urls: List[str]              # REQUIRED — YouTube video URLs
analysis: str = "comments"   # "comments" | "video"
top_n: int = 100             # max comments to retrieve (for analysis="comments")
```

## Supported URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`

## NOT Supported

- Channel links (`/channel/`, `/@`, `/c/`)
- Playlist links (`/playlist?list=`)
- User profile links

## Rules

- `analysis="comments"` — returns top N popular comments as a **sample**, not the entire dataset.
- `analysis="video"` — returns video transcript/subtitle text. Only returns text when the video **has subtitles**; otherwise result may be empty.
- Only supports YouTube **video** URLs; non-video URLs are rejected.
