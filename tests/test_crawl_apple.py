import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from crawl_apple import url_to_slug, is_hig_url


def test_url_to_slug_basic():
    url = "https://developer.apple.com/design/human-interface-guidelines/buttons"
    assert url_to_slug(url) == "buttons"


def test_url_to_slug_nested():
    url = "https://developer.apple.com/design/human-interface-guidelines/some/nested"
    assert url_to_slug(url) == "some__nested"


def test_url_to_slug_root():
    url = "https://developer.apple.com/design/human-interface-guidelines/"
    assert url_to_slug(url) == "index"


def test_is_hig_url_valid():
    assert is_hig_url("https://developer.apple.com/design/human-interface-guidelines/buttons") is True


def test_is_hig_url_wrong_domain():
    assert is_hig_url("https://example.com/design/human-interface-guidelines/buttons") is False


def test_is_hig_url_wrong_path():
    assert is_hig_url("https://developer.apple.com/other/path") is False
