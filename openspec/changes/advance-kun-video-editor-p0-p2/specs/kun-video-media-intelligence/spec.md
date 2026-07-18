## ADDED Requirements

### Requirement: Transcript adapters normalize local evidence
The media layer SHALL normalize imported timed text and supported local ASR into bounded sentence and word timestamps with language, confidence when available, adapter/model identity, source fingerprint, and local/cloud provenance.

#### Scenario: No local transcriber is installed
- **WHEN** local ASR is requested without an available negotiated adapter
- **THEN** the job SHALL return an actionable unavailable capability and SHALL NOT upload media, invent text, or block manual editing

### Requirement: Word and silence edits preserve source mapping
The domain SHALL plan filler-word, explicit-word, silence, and transcript-range removals against source time and map them through clip trims, speed, links, and sequence frames before one transactional commit.

#### Scenario: Repeated word removal changes indices
- **WHEN** one word-removal transaction succeeds
- **THEN** the receipt SHALL report removed source/frame ranges and instruct the caller to refresh word indices before another word-index mutation

### Requirement: Captions remain editable project content
Caption generation SHALL segment transcript evidence using timing, semantic punctuation, bounded word count, and rendered-width constraints, then create editable text/caption clips with word timing, style, position, and optional animation.

#### Scenario: Source clip is trimmed and sped up
- **WHEN** captions are generated for the visible portion of that clip
- **THEN** caption and word frames SHALL align with the transformed project timing and exclude trimmed source words

### Requirement: Derived media uses a quota-managed dependency graph
Waveforms, thumbnails, filmstrips, transcripts, analyses, embeddings, proxies, proofs, and previews SHALL be immutable derived records keyed by source identity, normalized parameters, and producer version, with ownership, dependencies, byte size, status, and invalidation.

#### Scenario: Source file identity changes
- **WHEN** a granted source is replaced or modified outside Kun
- **THEN** dependent derived records SHALL become invalid and SHALL NOT be reused until the source is reauthorized and recomputed

#### Scenario: Cache exceeds its workspace quota
- **WHEN** new derived output would exceed the configured byte budget
- **THEN** the broker SHALL evict least-recently-used unpinned records safely or fail with an actionable capacity result without deleting project state or exports

### Requirement: Timeline visuals are progressive and cancellable
Waveform and filmstrip generation SHALL publish bounded progressive results, deduplicate identical in-flight work, yield to export priority, support cancellation, and remain useful when only partial output is ready.

#### Scenario: User opens a long source during export
- **WHEN** filmstrip indexing is queued while an export consumes the media budget
- **THEN** export SHALL retain priority and the sidebar SHALL show partial/pending visuals without blocking timeline edits

### Requirement: Media search returns usable source ranges
The extension SHALL support bounded filename and spoken transcript search and MAY add local visual moment embeddings when a negotiated local model is installed. Results SHALL retain media ID, source range, evidence kind, index completeness, and uncalibrated ranking semantics.

#### Scenario: Spoken search matches a transcript segment
- **WHEN** the user or Agent searches for spoken content
- **THEN** the result SHALL be directly usable as a source range for preview or insertion without converting through display timecodes

### Requirement: Audio analysis is local, cached, and attributable
Negotiated analysis jobs SHALL support VAD/silence, speaker identity, beat/downbeat, denoise metadata, and audio synchronization with model/algorithm version, confidence, source fingerprint, and bounded output.

#### Scenario: Audio synchronization confidence is insufficient
- **WHEN** correlation or speaker evidence does not reach the declared threshold
- **THEN** the tool SHALL report an uncertain result and SHALL NOT move clips automatically

### Requirement: Multicam remains source-preserving and coverage-aware
Multicam groups SHALL preserve member identity, angle labels, sync offsets/confidence, source coverage, program fragments, and optional layouts. Switching an angle SHALL clamp or reject uncovered ranges and remain undoable.

#### Scenario: Requested angle was not recording for the full range
- **WHEN** a multicam switch targets a partly uncovered interval
- **THEN** the plan SHALL report the requested and applied ranges plus the limiting angle and SHALL not create out-of-bounds source references
