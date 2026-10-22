# ds-base installer

Installs ds-base design-system tools into your project. The package is encrypted; you need the **install password** from whoever gave you access.

| # | Product (`--products` id) | What you get |
|---|---|---|
| 1 | **DS Designer** (`ds`) | design-system-designer agent: tokens, components, motion, accessibility decisions |
| 2 | **UX Designer** (`ux`) | ux-designer agent + Dev Controls / ScreenTransition: flows, states, screens, review |
| 3 | **Brand Designer** (`brand`) | brand-designer agent: references → brand kit + theme settings |
| 4 | **DS base kit** (`kit`) | tokens, themes, components, patterns, contrast + lint checks (needs Tailwind CSS v4) |

## Install with Claude Code
In your project, tell Claude: *"Install ds-base from https://github.com/Akatori-Design/ds-base-dist"*. Claude asks for the password, then which products to install.

## Install by hand
From your project's root (the folder with `package.json`). It asks for the password (hidden), then for the products.
```bash
curl -fsSL https://raw.githubusercontent.com/Akatori-Design/ds-base-dist/main/init.mjs -o /tmp/ds-base-init.mjs && node /tmp/ds-base-init.mjs
```
Useful flags: `--products ds,ux,brand,kit` · `--all` · `--dry-run` (show changes, write nothing) · `--force` (overwrite files that differ) · `--dir src`. Rerun the same command to update.

**Safety:** existing files are never overwritten without `--force`. `CLAUDE.md` changes stay between `<!-- ds-base:start/end -->` markers. `.ds-base.json` records what was installed. The password is never stored.

## For Claude: installing ds-base
When asked to install ds-base, or given this repo's link, inside a project, follow these steps in order:
1. **Password first, on its own.** Ask for the install password and nothing else in that message.
   - Offer an alternative: the user can type it themselves (hidden) by running the by-hand command above in their own terminal. That keeps it out of the chat.
   - Never write the password to a file, commit it, echo it or put it in a URL. Pass it only as `DS_BASE_PASSWORD` in the environment of the install command.
2. **Then ask which products, offering all four** as one multi-select question (e.g. AskUserQuestion with `multiSelect: true`):
   - DS Designer (`ds`)
   - UX Designer (`ux`)
   - Brand Designer (`brand`)
   - DS base kit (`kit`)
   - Never reduce this to fewer choices, preset combinations, or yes/no buttons.
   - Mention the recommendation: 1 + 4 for a new project, 1 alone for a project with its own design system.
3. **Run from the project root:**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Akatori-Design/ds-base-dist/main/init.mjs -o /tmp/ds-base-init.mjs && DS_BASE_PASSWORD='<password>' node /tmp/ds-base-init.mjs --products <ds,ux,brand,kit> --yes
   ```
   - The kit needs a `package.json` and Tailwind CSS v4. Set those up first if missing, after confirming with the user.
   - Run `--dry-run` first if the project already has files that may conflict.
   - "Wrong password" → ask again.
   - `--yes` installs missing npm packages for the kit; drop it to ask the user instead.
4. **Report** the installer's summary and its "Next" steps, then delete `/tmp/ds-base-init.mjs`.
