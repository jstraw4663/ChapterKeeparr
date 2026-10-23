"""Settled-state accessibility checks for disposable browser fixtures only."""
import json
from pathlib import Path


# The app's reduced-motion selectors use !important and still fade for 200 ms.
# A plain * rule loses to them. This specificity overrides that timing only.
SETTLED_CSS = ''':root:root:root *,:root:root:root *::before,:root:root:root *::after{
  animation-duration:0s!important;animation-delay:0s!important;
  transition-duration:0s!important;transition-delay:0s!important}'''


def audit_accessibility(page, axe_path, output, label):
    """Audit final CSS states once; retain every WCAG rule and failure detail.

    A reduced-motion preference still allows short fades. networkidle and the
    route-transition flag do not mean resize/element fades have finished. Freeze
    time only during this static scan; live-motion/timer tests keep normal CSS.
    """
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    page.evaluate('document.fonts.ready')
    page.wait_for_function('!document.documentElement.dataset.vt')
    if not page.evaluate("typeof axe !== 'undefined'"):
        page.add_script_tag(path=axe_path)
    style = page.add_style_tag(content=SETTLED_CSS)
    try:
        # Flush style/layout and paint before axe samples effective contrast.
        page.evaluate('''() => new Promise(resolve => {
          document.documentElement.getBoundingClientRect();
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })''')
        result = page.evaluate('''async () => {
          const r = await axe.run(document, {runOnly:{type:'tag',
            values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});
          return {url:location.href, viewport:{width:innerWidth,height:innerHeight},
            theme:document.documentElement.dataset.theme || 'system',
            testEngine:r.testEngine, violations:r.violations,
            passedRules:r.passes.map(p=>p.id)};
        }''')
        report = output / (label + '-axe.json')
        report.write_text(json.dumps(result, indent=2))
        if result['violations']:
            page.screenshot(path=str(output / (label + '-axe-failure.png')), animations='disabled')
            summary = [{'id': v['id'], 'nodes': [n['target'] for n in v['nodes']]} for v in result['violations']]
            raise AssertionError(f'{label}: {summary}; details: {report}')
        return result
    finally:
        style.evaluate('el=>el.remove()')
