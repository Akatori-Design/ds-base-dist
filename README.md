# ds-base installer

Installs ds-base design-system tools into your project. You need a course-site account with a plan that includes ds-base. There is no install password: you approve each computer with a short code.

| # | Product (`--products` id) | What you get | Included in |
|---|---|---|---|
| 1 | **DS Designer** (`ds`) | design-system-designer agent: tokens, components, motion, accessibility decisions | Full access, All agents |
| 2 | **UX Designer** (`ux`) | ux-designer agent + Dev Controls / ScreenTransition: flows, states, screens, review | Full access, All agents |
| 3 | **Brand Designer** (`brand`) | brand-designer agent: references → brand kit + theme settings | Full access, All agents |
| 4 | **DS base kit** (`kit`) | tokens, themes, components, patterns, contrast + lint checks (needs Tailwind CSS v4) | Full access, UI library |

## Install with Claude Code
In your project, tell Claude: *"Install ds-base from https://github.com/Akatori-Design/ds-base-dist"*. Claude shows a link and a code. Approve the code on the course site, tell Claude you're done, then choose your products.

## Install by hand
From your project's root (the folder with `package.json`):
```bash
curl -fsSL https://raw.githubusercontent.com/Akatori-Design/ds-base-dist/main/init.mjs -o /tmp/ds-base-init.mjs && node /tmp/ds-base-init.mjs
```
It shows a link and a code, waits for your approval, then asks for the products. Already installed products are kept and updated. Useful flags: `--products ds,ux,brand,kit` (adds to what's installed) · `--all` (everything in your plan) · `--check` · `--sign-out` · `--dry-run` · `--force` · `--dir src`. Rerun the same command to update.

**One computer at a time:** approving a new computer disconnects the previous one. Your account can connect 4 times in any 30 days: your first computer plus three switches. See or disconnect your computer on the course site's install page. All projects on one computer share its connection. The install key is kept in `~/.config/ds-base/install.json`, readable only by you, and never goes into your project.

**Safety:** nothing you changed is overwritten or deleted, and a file you deleted stays deleted. On update, your edits and ds-base's changes merge. A file that can't be merged is left untouched, with the new version saved beside it as `<file>.ds-base-update` (merge it, then delete that file). **Your token values never change:** updates only add new tokens, and stock value changes are listed in `.ds-base/token-changes.json` for you to take with `--use-stock-tokens <name>` (or `all`). Kit components are only updated when you say yes (or pass `--update-kit`). `--force` overwrites, but saves your version as `<file>.ds-base-backup`. Commit `.ds-base/` so merges work for your whole team. Stock rules live in `docs/ds-base/` and are replaced on update. Your own rules go in `docs/rules/` (L-###), which updates never touch. `CLAUDE.md` changes stay between `<!-- ds-base:start/end -->` markers, and your edits there merge too. `.ds-base.json` records what was installed.

## For Claude: installing ds-base
When asked to install ds-base, or given this repo's link, inside a project, follow these steps in order. **Never ask for a password, and never read, print or copy `~/.config/ds-base/install.json`.**
1. **Connect this computer.** From the project root, run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Akatori-Design/ds-base-dist/main/init.mjs -o /tmp/ds-base-init.mjs && node /tmp/ds-base-init.mjs --check
   ```
   - **Exit code 10:** give the user the link and code exactly as printed, and stop until they say they've approved it. Then run `node /tmp/ds-base-init.mjs --check` again. It resumes the same code.
   - **Exit code 0:** it prints `Products you can install: …`.
   - If it says another computer was approved, tell the user that approving this one will disconnect the other and use one of their connections.
   - If key storage is blocked, ask the user to run the by-hand command in their own terminal.
2. **Then ask which products, as checkboxes plus "Install all":**
   - **Offer only products from `--check`.** Read `.ds-base.json` if it exists (`products`; older files have `mode: "all"` = ds + kit, and `uxAgent: true` = ux) and leave out what's installed. Installed ones are always kept and updated.
   - **Everything available installed** → don't ask. Say so and rerun the installer without `--products` to update.
   - **The question:** a multi-select (e.g. AskUserQuestion with `multiSelect: true`) with one checkbox per remaining product, plus a last option **Install all**.
   - **All four remaining** (more options than a question allows): ask two questions in the same call:
     - "Install everything?" with **Install all** / **Choose products**;
     - "Which products?" with the four checkboxes, used only if they choose.
   - **DS base kit already installed:** ask separately, "Update the DS base kit's components too?" (token values never change either way), with **No** as the default. Add `--update-kit` only on an explicit yes.
   - Mention the recommendation when both are available: DS Designer + DS base kit for a new project, DS Designer alone for a project with its own design system.
3. **Run from the project root:**
   ```bash
   node /tmp/ds-base-init.mjs --products <chosen ids, e.g. ds,kit> --yes
   ```
   - The kit needs a `package.json` and Tailwind CSS v4. Set those up first if missing, after confirming with the user.
   - Run `--dry-run` first if the project already has files that may conflict.
   - `--yes` installs missing npm packages for the kit; drop it to ask the user instead.
4. **Report** the installer's summary and its "Next" steps, then delete `/tmp/ds-base-init.mjs`.
