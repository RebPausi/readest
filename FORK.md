# Readest — reading-aids fork

This fork adds two reading aids to Readest. Everything else is upstream Readest.

## Click to highlight a sentence

Click any word and its whole sentence (full stop to full stop, also `!` and `?`)
becomes a normal Readest highlight in your current highlight colour and style.

- Works in EPUB/MOBI/FB2/TXT and in PDFs that have a text layer (not scanned PDFs).
- Abbreviations such as *Dr.*, *Mr.*, *e.g.*, *i.e.* and initials don't end a sentence.
- Click an existing highlight to get Readest's usual popup (change colour, add a
  note, delete).
- Dragging still selects text as before; only a plain click highlights.
- Highlights are saved with the book and exported with **≡ menu → Export Annotations**
  (Markdown, plain text or JSON), so they can be analysed elsewhere.
- Setting: **Settings → Behavior → Reading Aids → Click to Highlight Sentence**
  (`Click`, `Alt + Click`, or `Off`). With `Alt + Click`, a plain click goes back to
  turning pages and showing the toolbars.

Limits: a sentence is searched within its paragraph (EPUB) or its page (PDF), so a
sentence that continues onto the next PDF page is highlighted only up to the page end.

## WaspLine line colours

The WaspLine/BeeLine pattern: line 1 fades into colour 1 at its end, line 2 starts
in colour 1, line 3 fades into colour 2, line 4 starts in colour 2, and so on,
restarting at every paragraph.

- Separate colour pairs for light and dark pages (defaults: blue/red and light
  blue/coral), and three strengths.
- EPUBs are coloured with the CSS Highlight API, so the book's text is never changed
  and highlights, search and positions keep working.
- PDFs get a blended colour strip over each line of the page image.
- Setting: **Settings → Behavior → Reading Aids → WaspLine Line Colours**.

## Where the code is

| File | What it does |
|---|---|
| `apps/readest-app/src/utils/sentenceRange.ts` | Finds the sentence under a point |
| `apps/readest-app/src/utils/waspLine.ts` | Line detection and colouring |
| `apps/readest-app/src/app/reader/hooks/useReadingAids.ts` | Wires both into each loaded page |
| `apps/readest-app/src/components/settings/ReadingAidsSettings.tsx` | Settings section |

Small hooks into upstream files: `types/book.ts` (`ReadingAidsConfig`),
`services/constants.ts` and `services/settingsService.ts` (defaults),
`FoliateViewer.tsx` (two calls) and `ControlPanel.tsx` (the settings section).
Keeping the hooks this small makes merging new upstream releases easy.

## Building

`.github/workflows/fork-windows-build.yml` builds an unsigned Windows installer on
every push to `main` (or from the Actions tab). The built app's updater points at
this fork's releases, so it never replaces itself with upstream Readest.

## Updating from upstream

```
git remote add upstream https://github.com/readest/readest.git   # once
git fetch upstream
git merge upstream/main
git submodule update --init --recursive
git push
```
