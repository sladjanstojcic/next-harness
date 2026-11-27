# Design rules

Read this before any interface work. Every line is a decision, so follow it as written. These rules cover the
application's own interface. They do not cover user content such as the ads on the canvas, or the art of a landing
page.

## Never

- No gradients, no glow.
- No icons in rounded boxes.
- No all caps, no eyebrow labels.
- No nested cards, no decorative pills.
- No bold. Regular and medium only.
- No numbered lists such as 01, 02, 03 unless the content is a real sequence.
- No coloured bar on the left of a selected row.
- No green check in a circle for every status.
- No fake logos made of a letter in a rounded square.
- No avatar stacks that fan out on hover.

## Always

- Sentence case everywhere.
- Semantic tokens, never a hex value: background, card, foreground, muted-foreground, border, primary, accent and
  the rest of the theme. Surfaces stay neutral; the accent shows only on what is active or selected.
- One type scale and two weights.
- Shadows only on things that float: menus, popovers, dialogs, toasts, dragged items.
- Motion under 300 ms, no bounce. Exits are faster than entries. A pressed button scales to 0.97. Keyboard
  highlights move at once; only the mouse gets a glide.
- Start from an existing component, block or screen, never from a blank page.
- Check 390 px, dark mode and keyboard. Before calling interface work done, take screenshots in light and dark
  mode and at phone width, and check them against this file.
- Cut last: a subtitle that repeats the heading, a badge nobody asked for, a second shadow, an icon beside every
  label.

Source: Elia Kuratli, "Unslop your UI: how I design with AI without it looking like AI", 2026-11-23,
<https://x.com/eliakuratli/status/2124850779639181567>.
