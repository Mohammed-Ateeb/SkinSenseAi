"""
Supabase JWT verification for FastAPI.

Install: pip install pyjwt

Add to your .env:
SUPABASE_JWT_SECRET=your-jwt-secret   # Supabase project settings > API > JWT Settings
"""

import os
from functools import lru_cache
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt import PyJWKClient

SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else None

bearer_scheme = HTTPBearer()


@lru_cache(maxsize=1)
def _jwk_client() -> PyJWKClient:
    return PyJWKClient(_JWKS_URL)


def _decode_token(token: str) -> dict:
    """Verify a Supabase access token.

    Modern Supabase projects sign with asymmetric keys (ES256/RS256) published
    via JWKS; older projects use the HS256 shared secret. Try JWKS first and
    fall back to HS256 so both styles work.
    """
    last_err: Exception | None = None
    if _JWKS_URL:
        try:
            signing_key = _jwk_client().get_signing_key_from_jwt(token).key
            return jwt.decode(
                token, signing_key, algorithms=["ES256", "RS256"], audience="authenticated"
            )
        except jwt.ExpiredSignatureError:
            raise
        except Exception as e:  # wrong alg/kid, or JWKS fetch failed -> try HS256
            last_err = e
    if SUPABASE_JWT_SECRET:
        return jwt.decode(
            token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated"
        )
    raise last_err or jwt.InvalidTokenError("No JWT verifier available")


class CurrentUser:
    def __init__(self, id: str, email: str | None):
        self.id = id
        self.email = email


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    """
    Use as a dependency on any route that needs to know who's calling:

        @app.get("/history")
        def get_history(user: CurrentUser = Depends(get_current_user)):
            return db.query(...).filter(user_id=user.id).all()

    The frontend sends the Supabase access token like this:

        const { data: { session } } = await supabase.auth.getSession()
        fetch('/history', {
            headers: { Authorization: `Bearer ${session.access_token}` }
        })
    """
    token = credentials.credentials
    try:
        payload = _decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired, please log in again",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )

    user_id = payload.get("sub")
    email = payload.get("email")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user id",
        )

    return CurrentUser(id=user_id, email=email)
