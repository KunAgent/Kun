# Browser validation notes for generated HTML decks

Use this when validating a generated `index.html` deck in a browser automation environment.

## Query-parameter slide jumps

If adding `?slide=N` support for QA, do not call `go(0)` and then `setTimeout(() => go(N-1), ...)` when the template has a navigation lock. The second `go()` can be ignored because `lock=true` from the first navigation.

Prefer a single initial navigation:

```js
const params = new URLSearchParams(location.search);
const forcedSlide = parseInt(params.get('slide') || '', 10);
const initialSlide = (Number.isFinite(forcedSlide) && forcedSlide >= 1 && forcedSlide <= total) ? forcedSlide - 1 : 0;
go(initialSlide);
```

## Snapshot caveat

Accessibility snapshots may list text from all slides because all sections remain in the DOM and the deck moves with `transform: translateX(...)`. Do not treat snapshot text alone as proof that the intended page is visible.

Verify visible state with at least one of:

```js
JSON.stringify({
  transform: getComputedStyle(document.querySelector('#deck')).transform,
  inline: document.querySelector('#deck').style.transform,
  activeDot: [...document.querySelectorAll('#nav .dot')].findIndex(d => d.classList.contains('active')) + 1,
  centerText: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.innerText?.slice(0, 120)
})
```

## Overflow probe

After loading the deck, run a bounding-box probe over each slide instead of relying only on visual inspection:

```js
(() => {
  const deck = document.querySelector('#deck');
  const slides = [...document.querySelectorAll('.slide')];
  return slides.map((s, i) => {
    deck.style.transform = `translateX(${-i * 100}vw)`;
    const bad = [...s.querySelectorAll('h1,h2,h3,p,blockquote,.subtitle,.panel,.codebox,.route-table,.pipeline-section,.mag-title,.cmd-strip')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.bottom > innerHeight - 8 || r.top < 0 || r.right > innerWidth - 8 || r.left < 0;
      }).length;
    return { page: i + 1, bad };
  });
})()
```

Target result: every page has `bad: 0` or any exceptions are intentionally explained.

## Theme-count wording

The skill has 5 color palettes in `references/themes.md`. The practical "20 combinations" are best treated as 5 palettes × 4 page rhythm classes (`hero dark`, `hero light`, `light`, `dark`), not as 20 independent color palettes. Choose one palette for the whole deck, then vary page rhythm classes for pacing.
