"""Drive the focused Review editor through public controls, never by seeding decisions."""
from playwright.sync_api import expect


def focus_marker(page, item):
    page.locator('[data-act="rw-filter"][data-arg="all"]').click()
    row = page.locator('.rw-markers [data-act="cr-jump"][data-arg="' + item + '"]')
    expect(row).to_be_visible()
    row.click()
    card = page.locator('.rw-decision [data-cr-item="' + item + '"]')
    expect(card).to_be_visible()
    return card


def expect_decided(page, item):
    # Choice keeps the editor open and focus stable until explicit Continue.
    expect(page.locator('.rw-decision')).to_have_attribute('data-key', 'editor-' + item)
    expect(page.locator('.rw-continue')).to_be_visible()


def resolve_decisions(page, limit=100):
    for _ in range(limit):
        next_open = page.locator('.cr-save [data-act="cr-next"]')
        if not next_open.is_enabled():
            return
        next_open.click()
        panel = page.locator('.rw-decision')
        item = panel.get_attribute('data-key').removeprefix('editor-')
        choices = panel.locator('.cr-options [data-act="cr-pick"]')
        expect(choices.first).to_be_visible()
        choices.first.click()
        expect_decided(page, item)
    raise AssertionError('Unresolved decisions after explicit navigation limit')
