# Zhouyi Benyi data source

- Work: *周易本義 (四庫全書本)*
- Author: 朱熹
- Import date: 2026-07-16
- Source entry: https://zh.wikisource.org/wiki/周易本義_(四庫全書本)
- License: [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)

## Pinned pages

| Page | Revision | Revision URL |
| --- | ---: | --- |
| [卷1](https://zh.wikisource.org/wiki/周易本義_(四庫全書本)/卷1) | 528287 | https://zh.wikisource.org/w/index.php?title=周易本義_(四庫全書本)/卷1&oldid=528287 |
| [卷2](https://zh.wikisource.org/wiki/周易本義_(四庫全書本)/卷2) | 737053 | https://zh.wikisource.org/w/index.php?title=周易本義_(四庫全書本)/卷2&oldid=737053 |

The development-only importer requests these two pinned revisions through the MediaWiki `action=parse` API. The application uses only the generated JSON and makes no source-network request at runtime.

## Extraction and normalization

The importer removes `style` and `script` elements, converts `small` elements to temporary commentary markers, converts `br` elements to newlines, and reads the `.poem` text. It pairs each marker with only the text segment immediately before it, so line labels mentioned inside commentary cannot become primary lines. Primary labels are recognized only at a text boundary (the segment start or `○`), must occur in positions 1 through 6 in order, and use that pair's marker as commentary. Intervening 彖 and 象 pairs are ignored. An extra primary label before a later-section boundary such as `○文言曰` fails the import; references after that boundary are outside the six primary lines.

Whitespace, source angle marks `〈〉`, and a leading commentary separator `○` are removed from extracted fields. The generated artifact uses the canonical traditional 64-name list. Four source heading variants are recognized explicitly: ordinal 27 `頥` as `頤`, ordinal 29 `習坎` as `坎`, ordinal 32 `恒` as `恆`, and ordinal 34 `大壮` as `大壯`.

One source header glyph is corrected explicitly. The 蹇 block has source glyph `䷮` (U+4DEE, ordinal 47) with header note `艮下坎上`; the importer requires that exact combination at expected ordinal 39 and emits canonical glyph `䷦` (U+4DE6). The actual 困 block also uses `䷮` and is left unchanged. Every other source glyph must match its expected document ordinal or import fails.

The importer verifies the pinned revision IDs, page block counts (30 and 34), exact ordinal sequence 1 through 64, one documented header correction, and six nonempty line records per hexagram. Output is stable pretty-printed JSON with no generated timestamp. Apart from the listed name and glyph normalization, extracted source text is retained rather than reconstructed.
