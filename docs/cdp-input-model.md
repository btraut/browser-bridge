# CDP Input Model

Browser Bridge drive actions now prefer Chrome DevTools Protocol (CDP) input dispatch over synthetic DOM events.

## CDP-first actions

- `drive.click` -> `Input.dispatchMouseEvent` (deferred for dialog safety)
- `drive.hover` -> `Input.dispatchMouseEvent` (`mouseMoved`)
- `drive.drag` -> `Input.dispatchMouseEvent` (`mouseMoved` + press/release)
- `drive.key` / `drive.key_press` -> `Input.dispatchKeyEvent`
- `drive.type` -> `Input.insertText` (with CDP focus click and Enter submit)

## High-level helper behavior

- `drive.select` and `drive.fill_form` are CDP-first where possible.
- Because CDP has no direct "select option by value/text/index" primitive, select-like operations use explicit content-script fallback after CDP focus.
- `drive.fill_form` routes text/contentEditable fields through CDP typing and falls back for complex controls (select/checkbox/radio edge cases).

## Smoke verification

Run:

```bash
scripts/cli-full-tool-smoke.sh
```

The smoke script now includes assertions for:

- Focus and value updates after `drive.type`
- Role-target click side effects
- `fill_form` field updates (text/select/checkbox/contentEditable)
- `select` value/text/index flows
- Drag/drop completion text on the smoke fixture page
