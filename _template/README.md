# Tool Template

A starting point for new interactive tools. It runs as is, using a placeholder moving point.

**This folder is not published.** GitHub Pages builds this site with Jekyll, which skips folders whose names start with an underscore. Do not link to this folder from any page. Do not add a `.nojekyll` file to the repository, because that would publish this folder.

## Start a New Tool

1. Create a topic folder at the top level of the repository, such as `frames/`. Keep it one level deep, so that the `../` links still work.
2. Copy `tool-template.html` and one script into it, and rename both:
   - `tool-template-2d.js` for a tool drawn on a 2D canvas.
   - `tool-template-3d.js` for a tool drawn in 3D with Three.js.
3. In the HTML:
   - Remove the `robots` line.
   - Replace the title, description, tool name, and all placeholder text.
   - Keep one `<script>` line for your script, and delete the other.
4. In the script, replace the sections marked `REPLACE`.
5. Remove controls and panels the tool does not need. Add only what the user asked for.
6. Register the tool as described in `AGENTS.md` section 6.

To preview the template itself, open `tool-template.html` from a local file. To preview the 3D version, change which `<script>` line is active.

## What You Get

| File | Provides |
|---|---|
| `assets/tool-theme.css` | Navigation bar, one-screen layout, view box, labels, status box, panels, controls, and phone layout |
| `assets/tool-kit.js` | Canvas sizing, animation loop, button groups, and label placement |

Put a style or helper in these shared files only if more than one tool needs it.

## Layout

- **Large screens:** the view and controls stay on screen and fill the window height, with the panels beside them.
- **Tablets and phones:** everything stacks. On phones, the status box moves below the view.
- **Two side columns:** add a second `.col` inside `.tool-side`, then add this rule to the page's styles:

```css
@media (min-width: 1300px) and (min-height: 600px) {
    .tool-layout { --aside-w: 40rem; }
    .tool-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

## Rules That Prevent Known Problems

- **Size canvases with `ToolKit.observeSize`.** It reports the area inside the border. Measuring the outer box stretches and blurs the drawing.
- **Draw inside the resize callback.** Resizing clears a canvas, so waiting for the next frame shows a blank frame.
- **Keep the top of the 3D scene in view.** Check that long axes and their arrows are not clipped. Move the camera target if needed.
- **Place labels with `ToolKit.LabelLayer`.** Pass it each overlay's box, including any inset views. Mark labels that can be dropped as `optional`.
- **Animate paths the way the motion happens.** When changing between two views, do not blend points in a straight line, because the path can detach from its object. For example, rotate each point about the spin axis, then confirm the result matches both end views.
- **Do not set a full-height minimum on each side column.** Stacked columns then add blank space. `.tool-side` already has the minimum height.
- **Keep text short.** These tools build intuition. Give the idea, and leave fine detail to the lesson. Shorten text rather than hiding it in tabs or a scrolling box.
- **Respect the page's fixed height.** Controls should stay compact, because each line they add takes height from the view.

## Before You Finish

- Test from a local file and from a server. Load local scripts as classic scripts, because browsers block external modules on pages opened from disk.
- Test at 1920x1080, 1536x730, 1366x768, 1366x650, 1100x800, 820x1180, 390x844, and 844x390.
- Use every control in every mode, and try restarting, zooming, and resizing while it plays.
- Check for console errors, sideways scrolling, cut-off text, and overlapping labels.
- Check displayed numbers against the calculations.
- Check that the page contains no identifying information, as required by `AGENTS.md` section 2.1.
