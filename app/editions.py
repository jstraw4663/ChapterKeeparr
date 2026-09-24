"""Read-only edition discovery for human review; selection never implies verification."""
import math
import re
from urllib.parse import urlencode
from .covers import cover_url
from . import engine

REGIONS = ('us', 'uk', 'ca', 'au', 'de', 'es', 'fr', 'in', 'it', 'jp')


def people(value):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [{'name': str(v.get('name', '') if isinstance(v, dict) else v)[:300]}
            for v in value[:30] if isinstance(v, (str, dict))]


def search(query, region='us'):
    query = query.strip()
    region = region.lower()
    if not 2 <= len(query) <= 200 or region not in REGIONS:
        raise ValueError('Enter 2–200 characters and a supported region')
    direct = bool(re.fullmatch(r'(?:B[0-9][A-Z0-9]{8}|[0-9]{9}[0-9X])', query.upper()))
    try:
        if direct:
            books = [engine.get_json('https://api.audnex.us/books/' + query.upper() + '?' + urlencode({'region': region}))]
        else:
            books = engine.search_books(query, region)
    except ValueError as exc:
        raise engine.NeedsReview('Metadata provider returned unreadable data. Please retry later.') from exc
    if not isinstance(books, list) or any(not isinstance(b, dict) for b in books):
        raise engine.NeedsReview('Unrecognized metadata search response. Please retry later.')
    result, seen = [], set()
    for book in books[:20]:
        asin = str(book.get('asin', '')).upper()
        if not re.fullmatch(r'[A-Z0-9]{10}', asin) or asin in seen:
            continue
        if direct and asin != query.upper():
            raise engine.NeedsReview('Provider returned a different ASIN than requested.')
        seen.add(asin)
        try:
            runtime = float(book.get('runtimeLengthMin') or book.get('lengthMinutes') or 0)
            if not math.isfinite(runtime) or runtime < 0: runtime = 0
        except (ValueError, TypeError): runtime = 0
        result.append(dict(asin=asin, title=str(book.get('title') or '')[:1000],
                           subtitle=str(book.get('subtitle') or '')[:1000],
                           authors=people(book.get('authors')), narrators=people(book.get('narrators')),
                           runtime_length_min=runtime, language=str(book.get('language') or ''),
                           publisher_name=str(book.get('publisherName') or book.get('publisher') or ''),
                           cover_url=cover_url(book), format=str(book.get('formatType') or book.get('bookFormat') or ''), region=region))
    if direct and not result:
        raise engine.NeedsReview('This provider has no usable metadata for that ASIN in this region.')
    return result
