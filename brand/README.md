# Callback brand kit

Everything you need to put Callback on a reel, a slide, a thumbnail or a sticker. The colours and fonts are the ones the app uses (`frontend/src/styles/index.scss`), so what you make will match the product on screen.

## The logo

A "C" that loops back on itself and ends in an arrow, around a pink dot. It is the habit Callback teaches: **hang up, and call back** on the number you know. The dot is the person at the centre, the family member you're protecting.

| File | Use it for |
| --- | --- |
| `logo/callback-app-icon.svg`, `-1024.png`, `-512.png` | App icon, profile pictures, anywhere the logo stands alone |
| `logo/callback-mark.svg`, `-1024.png` | The mark on light backgrounds (indigo C, pink dot, no background) |
| `logo/callback-mark-white.svg`, `-white-1024.png` | The mark on dark backgrounds and on video |
| `logo/callback-lockup-on-light.png` | Mark and wordmark on light backgrounds |
| `logo/callback-lockup-on-dark.png` | Mark and wordmark on dark backgrounds and on video |

**Clear space:** keep at least the width of the pink dot empty on every side of the mark.
**Minimum size:** 24 px tall for the mark on screen, 120 px wide for the lockup.

**Do**
- Use the white mark on dark or busy video, the indigo mark on light.
- Use the SVGs when you can; they stay sharp at any size.

**Don't**
- Recolour the dot, rotate or flip the mark (the arrow must point back towards the opening), stretch it, add shadows or outlines.
- Put the indigo mark on dark backgrounds or on photos.
- Retype the wordmark in another font.

## Colours

Red means a scam signal and green means the safe action. Nothing else uses them.

| Name | Hex | Use |
| --- | --- | --- |
| ink | `#352A7C` | Text, headings, the logo on light |
| deep | `#1D1647` | Call screens, dark sections, video backgrounds |
| deep-2 | `#2A2163` | Raised surfaces on deep |
| accent | `#735AC8` | Links, focus, active states |
| accent-fill | `#917AE5` | Fills, progress, highlights |
| lavender | `#D8CEFF` | Soft backgrounds, tags |
| pink | `#F2A9FA` | The dot; the one bright accent, use sparingly |
| cyan | `#CBFBF9` | Calm highlight |
| bg | `#EDF0FF` | Page background |
| panel | `#E3F0FF` | Panels, the page gradient |
| muted | `#586986` | Secondary text |
| on-deep | `#F1EEFF` | Text on deep |
| on-deep-muted | `#B9B2E0` | Secondary text on deep |
| good | `#138653` | The safe action only |
| good-ink | `#0F6E44` | Safe green as text on light |
| warning | `#F5B94D` | Caution, the yellow light |
| danger | `#E0475E` | Scam signals only |
| danger-ink | `#B0283F` | Danger as text on light |

App icon gradient: `#352A7C` at the top to `#1D1647` at the bottom.

Developer versions: `tokens/colors.css` (CSS variables with notes) and `tokens/tokens.json`. A swatch sheet to share: `tokens/palette.png`.

## Fonts

- **Space Grotesk**, weight 700, tight letter-spacing: headings and the wordmark. Free: https://fonts.google.com/specimen/Space+Grotesk
- **Inter**, weights 400 to 700: everything people read. Free: https://fonts.google.com/specimen/Inter

## Voice

- Calm and plain. Say what happens and what to do, in short sentences.
- Never scare people into buying. The threat is real; say it once, then show the habit.
- Never mock people who were scammed. It works on smart people; that is why we practise.
- Always say that everyone agrees to practice calls first, and that every call says it was practice before it ends.
- The line to repeat everywhere: **Hang up. Call back.**

## Social and video

| File | Use it for |
| --- | --- |
| `social/instagram-profile-1080.png` | Instagram (and TikTok) profile picture; safe inside the circle crop |
| `social/reel-end-card-1080x1920.png` | Last 2 to 3 seconds of every reel; text sits above the reel buttons |
| `social/video-thumbnail-1920x1080.png` | YouTube and Devpost video thumbnail, title card |

## Where everything is

```
brand/
  README.md
  logo/     app icon, marks, lockups (SVG and PNG)
  social/   profile picture, reel end card, video thumbnail
  tokens/   colors.css, tokens.json, palette.png
```
