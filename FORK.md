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

Limits: a sentence is searched within its paragraph (EPUB) or its text block (PDF).
On a PDF page, footnotes, headers, page numbers and other columns count as separate
blocks, so a sentence that continues onto the next page is highlighted to the end of
its last line, never into the footnotes.

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

Shortcut: **W** switches WaspLine on and off.

## Line guide (speed reading)

**Settings → Behavior → Reading Aids → Line Guide**:

- **Underline on Hover**: the line under the mouse is underlined.
- **Pacer**: press **G** to start. The underline grows from the start of the line
  to its end at the chosen words per minute, moves to the next line and turns the
  page at the bottom. It starts on the line under the mouse (or the first line on
  screen). **G** pauses and resumes, **[** and **]** change the speed by 25 wpm,
  **Esc** stops.
- In pacer mode a small control sits at the bottom-left of the page: play/pause,
  stop, − / + and the speed. Scroll the mouse wheel over it to change the speed, or
  hold **Alt** and scroll anywhere on the page.
- Page turns follow the reader's own record of what's on screen, so no lines are
  skipped in page view.
- Underline colour is configurable. Works in EPUBs and in PDFs with a text layer.

## PDF text boldness

**Settings → Behavior → Reading Aids → PDF Text Boldness** darkens the edges of the
glyphs on PDF pages (or brightens them on a dark theme), so thin text reads heavier.
PDF fonts themselves can't be changed: a PDF page is drawn as an image. For EPUBs,
use **Settings → Font** (turn on *Override Book Font* to pick a font and weight).

## Sync highlights to Obsidian

Turn on **Settings → Behavior → Reading Aids → Sync Highlights to Obsidian** and
pick a folder inside your vault (for example `Vault/Readest`). Each book gets one
note, `<Book title>.md`, rewritten a few seconds after any highlight or note changes.

- Front matter (`title`, `author`, `format`, `highlights`, `updated`, tag `readest`)
  works with Dataview and Bases.
- Highlights are grouped by chapter in reading order, each as a quote with page,
  colour, an **open** link back to the exact spot in Readest, and a block id
  `^rd-<id>`, so you can link or embed one highlight elsewhere:
  `![[Book title#^rd-abc123]]`.
- Your Readest notes appear under their highlight.
- Deleting a highlight in Readest removes it from the note.
- One-way: the note mirrors Readest, so write your own thoughts in a separate note
  that links to it (edits inside the synced note are overwritten).
- Desktop app only.

## Where the code is

| File | What it does |
|---|---|
| `apps/readest-app/src/utils/sentenceRange.ts` | Finds the sentence under a point |
| `apps/readest-app/src/utils/waspLine.ts` | Line detection and colouring |
| `apps/readest-app/src/app/reader/hooks/useReadingAids.ts` | Wires both into each loaded page |
| `apps/readest-app/src/utils/lineGuide.ts`, `app/reader/hooks/useLineGuide.ts` | Line guide and pacer |
| `apps/readest-app/src/utils/pdfBoldness.ts` | PDF text boldness |
| `apps/readest-app/src/utils/obsidianExport.ts` | Builds the Obsidian note |
| `apps/readest-app/src/app/reader/hooks/useObsidianSync.ts` | Writes it when highlights change |
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
