"""
Supabase Service — usage tracking per Cognito user
Tables: addon_users, addon_usage
"""
from datetime import datetime, timezone
from config import Config
from logger_config import setup_logger

logger = setup_logger(__name__)


def _first(res):
    """Return first row from a supabase response, or {}."""
    return res.data[0] if (res.data and len(res.data) > 0) else {}


class SupabaseService:
    def __init__(self):
        self.client = None
        self.available = False

        if not Config.SUPABASE_URL or not Config.SUPABASE_SERVICE_KEY:
            logger.warning('⚠️ Supabase not configured — usage tracking disabled')
            return

        try:
            from supabase import create_client
            self.client = create_client(Config.SUPABASE_URL, Config.SUPABASE_SERVICE_KEY)
            self.available = True
            logger.info('✅ Supabase connected')
        except Exception as e:
            logger.error(f'❌ Supabase connection failed: {e}')

    def _year_month(self):
        return datetime.now(timezone.utc).strftime('%Y-%m')

    def upsert_user(self, sub, email=None, group=None):
        """Create or update user record on every request."""
        if not self.available:
            return
        try:
            self.client.table('addon_users').upsert(
                {
                    'cognito_sub': sub,
                    'email': email,
                    'cognito_group': group,
                    'last_query_at': datetime.now(timezone.utc).isoformat(),
                },
                on_conflict='cognito_sub',
            ).execute()
        except Exception as e:
            logger.error(f'❌ Supabase upsert_user: {e}')

    def check_and_increment(self, sub):
        """
        Check monthly limit and increment counter.
        Returns dict: {allowed, count, limit, remaining}
        Fails open on any Supabase error.
        """
        if not self.available:
            return {'allowed': True, 'count': 0, 'limit': 0, 'remaining': 9999}

        try:
            ym = self._year_month()

            # Get user limit and active status
            user = _first(
                self.client.table('addon_users')
                .select('monthly_limit, is_active')
                .eq('cognito_sub', sub)
                .execute()
            )
            if not user.get('is_active', True):
                return {'allowed': False, 'count': 0, 'limit': 0, 'remaining': 0}

            monthly_limit = user.get('monthly_limit') or 100

            # Get current month count
            usage = _first(
                self.client.table('addon_usage')
                .select('query_count')
                .eq('cognito_sub', sub)
                .eq('year_month', ym)
                .execute()
            )
            current = usage.get('query_count', 0)

            if current >= monthly_limit:
                return {
                    'allowed': False,
                    'count': current,
                    'limit': monthly_limit,
                    'remaining': 0,
                }

            new_count = current + 1
            self.client.table('addon_usage').upsert(
                {
                    'cognito_sub': sub,
                    'year_month': ym,
                    'query_count': new_count,
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                },
                on_conflict='cognito_sub,year_month',
            ).execute()

            logger.info(f'📊 Usage {sub[:8]}… {new_count}/{monthly_limit}')
            return {
                'allowed': True,
                'count': new_count,
                'limit': monthly_limit,
                'remaining': monthly_limit - new_count,
            }

        except Exception as e:
            logger.error(f'❌ Supabase check_and_increment: {e}')
            return {'allowed': True, 'count': 0, 'limit': 0, 'remaining': 9999}

    def log_search(self, sub, query=None, upc=None):
        """Insert one row per search into addon_searches."""
        if not self.available:
            return
        try:
            ym = self._year_month()
            self.client.table('addon_searches').insert({
                'cognito_sub': sub,
                'query': query or None,
                'upc': upc or None,
                'year_month': ym,
                'searched_at': datetime.now(timezone.utc).isoformat(),
            }).execute()
        except Exception as e:
            logger.error(f'❌ Supabase log_search: {e}')

    def get_usage(self, sub):
        """Return current month usage for a user."""
        if not self.available:
            return {'count': 0, 'limit': 0, 'remaining': 9999}

        try:
            ym = self._year_month()

            user = _first(
                self.client.table('addon_users')
                .select('monthly_limit')
                .eq('cognito_sub', sub)
                .execute()
            )
            monthly_limit = user.get('monthly_limit') or 100

            usage = _first(
                self.client.table('addon_usage')
                .select('query_count')
                .eq('cognito_sub', sub)
                .eq('year_month', ym)
                .execute()
            )
            count = usage.get('query_count', 0)

            return {
                'count': count,
                'limit': monthly_limit,
                'remaining': max(0, monthly_limit - count),
            }

        except Exception as e:
            logger.error(f'❌ Supabase get_usage: {e}')
            return {'count': 0, 'limit': 0, 'remaining': 9999}
