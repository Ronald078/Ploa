import os
import unittest
from unittest.mock import patch
from crm.account_authorization import authorize_search, NoRedirect


class AccountAuthorizationTest(unittest.TestCase):
    def test_standalone_does_not_request_authorization(self):
        with patch.dict(os.environ, {}, clear=True), patch('crm.account_authorization.build_opener') as opener:
            authorize_search()
            opener.assert_not_called()

    def test_other_host_and_invalid_lease_fail_before_network(self):
        for target, token in [('https://example.test/api/cloud/panel/agent-authorize', 'a' * 64), ('http://127.0.0.1:4313/api/cloud/panel/agent-authorize', 'wrong')]:
            with self.subTest(target=target), patch.dict(os.environ, {'PLOA_ACCOUNT_WORKER': '1', 'PLOA_ACCOUNT_AUTH_URL': target, 'PLOA_ACCOUNT_AUTH_TOKEN': token}, clear=True), patch('crm.account_authorization.build_opener') as opener:
                with self.assertRaises(PermissionError):
                    authorize_search()
                opener.assert_not_called()

    def test_redirect_is_never_followed(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 307, '', {}, 'https://example.test'))


if __name__ == '__main__':
    unittest.main()
