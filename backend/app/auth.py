"""
Supabase JWT verification for FastAPI.

Install: pip install pyjwt

Add to your .env:
SUPABASE_JWT_SECRET=your-jwt-secret   # Supabase project settings > API > JWT Settings
"""

import os
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

SUPABASE_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]

bearer_scheme = HTTPBearer()


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
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
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
