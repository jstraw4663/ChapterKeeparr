"""Accept only public provider artwork locations, never arbitrary media URLs."""
from urllib.parse import urlsplit

HOSTS = {'m.media-amazon.com', 'images-na.ssl-images-amazon.com',
         'images-eu.ssl-images-amazon.com', 'images-fe.ssl-images-amazon.com',
         'm.media-amazon.co.uk'}


def cover_url(book):
    value = book.get('imageUrl') or book.get('image') or book.get('cover_url')
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        url = urlsplit(value)
        if (url.scheme != 'https' or url.hostname not in HOSTS or url.username or
                url.password or url.port not in (None, 443)):
            return None
    except ValueError:
        return None
    return value
