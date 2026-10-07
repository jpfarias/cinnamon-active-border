# Active Window Border

A small Cinnamon extension that draws a colored border around the **focused**
window, so the active window is easy to identify at a glance.

It works at the compositor level (a `St.Widget` around the window actor), which
means it frames **every** window — including client-side-decorated apps that a
Metacity window theme cannot touch (Nemo, xed, Chromium, Electron, Qt, Wine, …).

<!-- Add a screenshot here once you have one. -->

## Features

- Colored border on the focused window; optional subtle border on unfocused
  windows.
- Configurable color, thickness, and corner radius.
- Follows windows on move/resize, focus change, workspace switch,
  minimize/restore, and fullscreen.
- Stays visible on windows flush against a screen edge (snapped or maximized) by
  insetting the border on the affected sides instead of clipping it.
- Ignores non-window actors: the desktop, panels/docks, menus, and
  override-redirect windows get no border.
- No dependencies, no network access — a single self-contained `extension.js`.

## Requirements

- Cinnamon `6.6` or later (developed and tested on Cinnamon **6.6.9**,
  Muffin 6.6.3, X11).

## Installation

Clone straight into your Cinnamon extensions directory:

```bash
git clone https://github.com/jpfarias/cinnamon-active-border.git \
  ~/.local/share/cinnamon/extensions/active-window-border@local
```

The directory name **must** be the extension UUID, `active-window-border@local`.

Then enable it:

1. Open **System Settings → Extensions** (or run `cinnamon-settings extensions`).
2. Find **Active Window Border** and toggle it on.

No Cinnamon restart is required.

### Manual install

Copy `extension.js`, `metadata.json`, and `settings-schema.json` into
`~/.local/share/cinnamon/extensions/active-window-border@local/` and enable it as
above.

## Configuration

Configure it from **System Settings → Extensions → Active Window Border**
(the gear/settings button on the extension row). Changes apply instantly.

| Setting | Default | Description |
| --- | --- | --- |
| Border color | `#74c7ec` | Color of the focused window border |
| Border thickness | `3 px` | Stroke width (1–10 px) |
| Corner rounding | `12 px` | Border corner radius (0–30 px) |
| Inactive border | off | Also draw a border on unfocused windows |
| Inactive color | `#313244` | Border color for unfocused windows |
| Hide on maximized | off | Hide the border on maximized windows |

The defaults match the
[Catppuccin](https://github.com/catppuccin) Mocha Sapphire accent.

## Uninstall

1. Disable it in **System Settings → Extensions**.
2. Delete the extension directory:

```bash
rm -rf ~/.local/share/cinnamon/extensions/active-window-border@local
```

## How it works

For each managed window the extension creates an `St.Widget` styled with a
transparent background and a CSS `border`, then keeps it positioned just above
that window's actor (so the window's drop shadow doesn't dim the stroke, while
higher windows still paint over it). Window signals keep the geometry and
stacking in sync.

## License

No license has been specified yet.
