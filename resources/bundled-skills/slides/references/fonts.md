# Font system

## Selection principles

1. Language matching: when the user's query is in Chinese or a Chinese PPT deliverable is requested, both Chinese and English fonts need to be specified; otherwise, only English fonts need to be set
2. Selection approach: it is recommended to prioritize highly readable fonts for body text, and to use stylized fonts plus special treatments (all caps, widened letter spacing, bold, italics, etc.) in titles or special pages to strengthen the style
3. The font combination must support the overall visual style positioning
4. Name consistency: **make sure font names are exactly identical, including capitalization and spaces, so that the model can use them correctly**

## Font list

### English fonts

| Font name | Font type | Style and characteristics | Suitable scenarios | Stylized font |
|---|---|---|---|---|
| Liter | Sans-serif | Modern neo-grotesque style; low contrast, balanced proportions, optimized for screens; clean and rational | Tech, product | No |
| HedvigLettersSans | Sans-serif | A "non-designer perspective" design; slightly irregular with a distinctive personality and strong brand character | Creative design, branding | No |
| Oranienbaum | Serif | Modern high-contrast serif; strongly geometric with elegant lines and a classical temperament | Culture, art, fashion | No |
| QuattrocentoSans | Sans-serif | Classic, elegant sans-serif; gentle, highly readable, clear at small sizes | Academic, corporate, education | No |
| SortsMillGoudy | Serif | Revival of the classical print style of Goudy Old Style; soft serifs, pleasant to read | Literature, humanities | No |
| Unna | Serif | Neoclassical serif with a pronounced vertical rhythm; elegant yet forceful | Literature, publishing, academia | Yes |
| Coda | Sans-serif | Rounded and friendly; soft curves, high openness | Business, friendly brand tone | Yes |
| Jersey15 | Sans-serif (sports style) | Sports jersey style; squared structure with a noticeable grid feel (supports English + digits only) | Sports, tech showcase pages | Yes |
| Jersey20Charted | Pixel font (grid shading) | Sports-number style with a shaded grid that reinforces an athletic texture (supports English + digits only) | Sports, mechanical, decorative showcase pages | Yes |

### Chinese fonts

| Font name | Font type | Style and characteristics | Suitable scenarios | Usage restriction |
|---|---|---|---|---|
| MiSans | Sans-serif (heiti) | Xiaomi system font; clean and modern, variable weights, excellent on-screen rendering (multilingual support) | Tech, corporate, product | No |
| Noto Sans SC | Sans-serif (heiti) | A branch of Source Han Sans; well-regulated structure, neutral style, extremely broad coverage. **Because it is so widely used, use it as little as possible** | Report-style | No |
| 思源宋体 | Serif (songti) | Source Han Serif; refined songti structure with stroke contrast; elegant reading experience (multilingual support) | Literature, design, formal presentations | No |
| 阿里妈妈刀隶体 | Calligraphy (clerical script) | Alimama DaoLi; clerical-script style with blade-like strokes; strength and archaic simplicity combined | China-chic, culture, art displays | No |
| 阿里妈妈东方大楷 | Calligraphy (regular script) | Alimama Dongfang Dakai; based on the Yan style of calligraphy; full and rounded, heavy and powerful | Culture, brand launches, guofeng (Chinese-style) themes | No |
| 阿里妈妈数黑体 | Sans-serif (heiti) | Alimama ShuHei; geometric heiti; uniform and regular with a strong commercial feel | Business, tech, e-commerce | No |
| 站酷文艺体 | Handwriting | Zcool WenYi; clean and fresh with a slight handwritten feel and a strong literary/artistic vibe | Light design, lifestyle | No |
| 飞波正点体 | Calligraphy (brush) | Feibo Zhengdian; brush-writing style with heavy strokes, full of power | Film posters, e-commerce, brand display | No |
| 得意黑 | Sans-serif (slanted heiti) | Smiley Sans; tall, slanted heiti combining humanist and geometric qualities with a strong modern feel. **Does not support a non-italic upright style** | Creative tech, brand display | No |
| 霞鹜新致宋 | Serif (songti) | LXGW XinZhiSong; based on IPAmj Mincho; bright, elegant, well-structured | Literature, classical style, print style | No |

### Mixed CJK–Latin fonts

| Font name | Font type | Style and characteristics | Suitable scenarios | Usage restriction |
|---|---|---|---|---|
| 精品点阵体 | Pixel font | Jingpin Dianzhen; 9×9 dot-matrix pixel style with an extremely retro electronic feel | Games, tech, pixel art | Yes |
| LXGW Bright | Serif (fangsong/kaiti) | LXGW WenKai family; combines fangsong and kaiti characteristics; gentle and clear letterforms | Literature, education, humanities | No |
| ZCOOL KuaiLe | Handwriting (rounded) | ZCOOL KuaiLe; lively, cute, playful and cartoonish; youthful energy | Anime, children, entertainment | No |

## Custom fonts (Google Fonts)

Use custom fonts to strengthen expressiveness or to fill font categories the built-in list does not cover (e.g. JetBrains Mono for monospace, Archivo Black for ultra-heavy sans-serif, EB Garamond for classical serif), brought in from Google Fonts via `customFonts`: declare `customFonts` in the `.pptd` entry file (see CustomFont in [pptd.md](pptd/format.md)); the `family` name must match Google Fonts exactly, and once declared it can be referenced in `fontFamily`.

Note: custom fonts follow the same "exactly identical names" requirement
