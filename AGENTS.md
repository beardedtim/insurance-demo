<!-- intent-skills:start -->

## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:

- Run `pnpm exec intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm exec intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Coding Standards

- **ALWAYS** have an empty line above and below any multi-line statement
- **ALWAYS** use brackets and a new line for `if`/`else` statements
- Prefer functional code over OOP
- Prefer code that is easy to replace/remove vs code that is "complete"

## Styling (Chakra UI v3)

- **ALWAYS** style with [Chakra UI v3](https://chakra-ui.com/). Tailwind CSS, CSS modules, plain `.css` files, inline `style={{}}`, and other styling libraries are **NOT** allowed. Do not add `className` utility strings.
- **NEVER** hardcode values. Use Chakra tokens for colors (`bg="bg.muted"`, `color="fg.muted"`, `colorPalette="blue"`), spacing (`p="4"`, `gap="2"`), sizes, radii, shadows, font sizes/weights, z-index, breakpoints, and durations. No raw hex/rgb/hsl, `px`/`rem` literals, or magic numbers.
- Prefer semantic tokens (`bg.subtle`, `fg.muted`, `border.emphasized`) over raw scale tokens so light/dark mode works.
- Prefer Chakra components and style props (`Box`, `Flex`, `Stack`, `Text`, `Heading`, ...) and `textStyle`/`layerStyle` over bespoke CSS. Use recipes/slot recipes for reusable variants.
- If a needed value has no token, add it to the theme in `src/theme/system.ts` (`tokens` / `semanticTokens`) and reference it by name. Do not inline it at the call site.
- Use the Chakra MCP server (`chakra-ui`, configured in `.mcp.json`) to look up components, props, tokens, and theming APIs before writing Chakra code. Do not guess from memory.
