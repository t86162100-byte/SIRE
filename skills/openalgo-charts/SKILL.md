# OpenAlgo Charts agent skills

SIRE embeds the OpenAlgo Charts agent-skill contract used by the upstream project.

Source: https://github.com/marketcalls/openalgo-charts
Skill set:
- openalgo-charts
- openalgo-chart-setup
- openalgo-chart-indicator
- openalgo-chart-terminal
- openalgo-chart-plugin
- openalgo-chart-debug

The runtime agent exposes the same skill names to Gemini and GPT-OSS 20B and maps their chart operations to the installed SIRE OpenAlgo Charts 2.4.0 runtime.

Upstream installation command:
`npx skills add https://github.com/marketcalls/openalgo-charts`

The upstream hub covers the public chart API, tiers, data/time rules, feeds, indicators, transforms, drawings, replay, chart linking, settings, trading, profiles, React integration, bundling, widget behavior, interactions, host integration and pitfalls.

SIRE additionally supplies the live Deriv chart context and safe browser action bridge so the council can use the skills against the actual SIRE chart rather than treating them as documentation only.
