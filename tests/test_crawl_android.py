import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from crawl_android import url_to_slug, is_target_url


def test_url_to_slug_basic():
    url = "https://developer.android.com/design/ui/mobile/some/page"
    assert url_to_slug(url) == "some__page"


def test_url_to_slug_root():
    url = "https://developer.android.com/design/ui/mobile"
    assert url_to_slug(url) == "index"


def test_url_to_slug_trailing_slash():
    url = "https://developer.android.com/design/ui/mobile/buttons/"
    assert url_to_slug(url) == "buttons"


def test_is_target_url_valid():
    assert is_target_url("https://developer.android.com/design/ui/mobile/buttons") is True


def test_is_target_url_wrong_domain():
    assert is_target_url("https://example.com/design/ui/mobile/buttons") is False


def test_is_target_url_wrong_path():
    assert is_target_url("https://developer.android.com/other/path") is False
